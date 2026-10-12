/**
 * Leave management. The office sets up leave types with a yearly allowance; an employee applies for a type and a
 * date range; the office approves or rejects. Sundays and holidays on the calendar are not counted as leave days.
 * The allowance is counted per calendar year, by the year the leave starts in. A type with no allowance has no limit.
 */
import { env } from '../config/env.js';
import { q } from '../db/pool.js';
import { audit } from '../db/audit.js';
import { HttpError } from '../middleware/error.js';
import { addDays, isISO, parseISO, toISO } from '../utils/dates.js';
import { queueEmail, tenantInfo } from './notifications.service.js';

const STANDARD_TYPES = [['Casual leave', 12], ['Sick leave', 10], ['Earned leave', 15], ['Leave without pay', null]];
const MAX_BACKDATE_DAYS = 60;

const str = (v, max, label, required = false) => {
  const s = typeof v === 'string' ? v.trim() : '';
  if (required && !s) throw new HttpError(400, `${label} is required.`);
  if (s.length > max) throw new HttpError(400, `${label} is too long (${max} characters at most).`);
  return s;
};
const today = () => toISO(new Date());
const round1 = (n) => Math.round(n * 10) / 10;

/* ---------------- leave types ---------------- */

const TYPE_SELECT = `select t.id, t.name, t.days_per_year::float8 as "daysPerYear", t.active,
  (select count(*) from leave_requests r where r.leave_type_id = t.id)::int as uses from leave_types t`;

export async function listTypes({ activeOnly = false } = {}) {
  const { rows } = await q(`${TYPE_SELECT} ${activeOnly ? 'where t.active' : ''} order by t.active desc, lower(t.name)`);
  return rows;
}

function cleanType(b = {}) {
  const name = str(b.name, 60, 'Name', true);
  let days = b.daysPerYear;
  if (days === '' || days === null || days === undefined) days = null;
  else {
    days = Number(days);
    if (!Number.isFinite(days) || days < 0 || days > 366) throw new HttpError(400, 'Days per year must be a number from 0 to 366, or empty for no limit.');
    days = round1(days);
  }
  return { name, days, active: b.active !== false };
}

export async function createType(body, admin) {
  const t = cleanType(body);
  try {
    const { rows: [r] } = await q('insert into leave_types (name, days_per_year, active) values ($1, $2, $3) returning id', [t.name, t.days, t.active]);
    await audit(admin, 'leave.type.create', 'leave_type', r.id, { name: t.name });
    return (await q(`${TYPE_SELECT} where t.id = $1`, [r.id])).rows[0];
  } catch (err) {
    if (err.code === '23505') throw new HttpError(409, 'There is already a leave type with this name.');
    throw err;
  }
}

export async function updateType(id, body, admin) {
  const t = cleanType(body);
  try {
    const { rowCount } = await q('update leave_types set name = $2, days_per_year = $3, active = $4 where id = $1', [id, t.name, t.days, t.active]);
    if (!rowCount) throw new HttpError(404, 'Leave type not found.');
  } catch (err) {
    if (err.code === '23505') throw new HttpError(409, 'There is already a leave type with this name.');
    throw err;
  }
  await audit(admin, 'leave.type.update', 'leave_type', id, { name: t.name });
  return (await q(`${TYPE_SELECT} where t.id = $1`, [id])).rows[0];
}

export async function removeType(id, admin) {
  const { rows: [t] } = await q(`${TYPE_SELECT} where t.id = $1`, [id]);
  if (!t) throw new HttpError(404, 'Leave type not found.');
  if (t.uses > 0) throw new HttpError(409, `${t.uses} leave request${t.uses === 1 ? ' uses' : 's use'} "${t.name}". Switch it off instead of deleting it.`);
  await q('delete from leave_types where id = $1', [id]);
  await audit(admin, 'leave.type.delete', 'leave_type', id, { name: t.name });
}

export async function addStandardTypes(admin) {
  let added = 0;
  for (const [name, days] of STANDARD_TYPES) {
    const { rowCount } = await q('insert into leave_types (name, days_per_year) values ($1, $2) on conflict do nothing', [name, days]);
    added += rowCount;
  }
  await audit(admin, 'leave.type.defaults', 'leave_type', null, { added });
  return { added, types: await listTypes() };
}

/* ---------------- counting days and balances ---------------- */

/** Days between two dates (both included) that are not Sundays or calendar holidays. May be 0. */
export async function workingDays(from, to) {
  const { rows: holidays } = await q(
    "select start_date::text as s, end_date::text as e from events where type = 'holiday' and start_date <= $2 and end_date >= $1", [from, to],
  );
  const off = (iso) => holidays.some((h) => h.s <= iso && iso <= h.e);
  let n = 0;
  for (let d = parseISO(from); toISO(d) <= to; d = addDays(d, 1)) {
    const iso = toISO(d);
    if (d.getDay() !== 0 && !off(iso)) n += 1;
  }
  return n;
}

/** Leave days between two dates: Sundays and calendar holidays are not counted. A half day is 0.5. */
export async function countDays(from, to, half = false) {
  const n = await workingDays(from, to);
  if (n === 0) throw new HttpError(400, 'These dates are all Sundays or holidays, so no leave is needed.');
  return half ? 0.5 : n;
}

/** Allowance, days taken (approved), days waiting (pending) and days left for each active type in a year. */
export async function balances(employeeId, year) {
  const { rows } = await q(
    `select t.id as "typeId", t.name, t.days_per_year::float8 as allowance,
            coalesce(sum(r.days) filter (where r.status = 'approved'), 0)::float8 as used,
            coalesce(sum(r.days) filter (where r.status = 'pending'), 0)::float8 as pending
     from leave_types t
     left join leave_requests r on r.leave_type_id = t.id and r.employee_id = $1 and extract(year from r.from_date) = $2
     where t.active group by t.id order by lower(t.name)`, [employeeId, year],
  );
  return rows.map((b) => ({ ...b, left: b.allowance === null ? null : round1(b.allowance - b.used - b.pending) }));
}

const REQUEST_SELECT = `
  select r.id, r.leave_type_id as "typeId", t.name as "typeName", r.from_date::text as "fromDate", r.to_date::text as "toDate",
         r.half_day as "halfDay", r.days::float8 as days, r.reason, r.status, r.remark, r.created_at as "appliedAt", r.decided_at as "decidedAt",
         r.employee_id as "employeeId", e.name as "employeeName", e.emp_code as "employeeCode", d.name as department,
         (r.applied_by is not null and r.applied_by <> coalesce(eu.id, r.applied_by)) as "byOffice"
  from leave_requests r
  join leave_types t on t.id = r.leave_type_id
  join employees e on e.id = r.employee_id
  left join departments d on d.id = e.department_id
  left join users eu on eu.employee_id = e.id`;

async function leaveAllowed(employeeId, type, year, days, excludeId = null) {
  if (type.daysPerYear === null) return;
  const { rows: [u] } = await q(
    `select coalesce(sum(days), 0)::float8 as n from leave_requests
     where employee_id = $1 and leave_type_id = $2 and extract(year from from_date) = $3 and status in ('pending', 'approved') and ($4::uuid is null or id <> $4)`,
    [employeeId, type.id, year, excludeId],
  );
  const left = round1(type.daysPerYear - u.n);
  if (days > left) throw new HttpError(409, `${type.name}: ${days} day${days === 1 ? '' : 's'} asked, but only ${Math.max(left, 0)} left for ${year}.`);
}

/** Apply for leave. `byOffice` records it as already approved (the employee asked by phone or in person). */
export async function apply(employeeId, body = {}, actor, { byOffice = false } = {}) {
  const { rows: [emp] } = await q('select id from employees where id = $1 for update', [employeeId]); // one request at a time per person
  if (!emp) throw new HttpError(404, 'Employee not found.');
  const { rows: [type] } = await q('select id, name, days_per_year::float8 as "daysPerYear", active from leave_types where id = $1', [body.typeId]);
  if (!type || !type.active) throw new HttpError(400, 'Choose a leave type.');
  const { fromDate, toDate = fromDate } = body;
  if (!isISO(fromDate) || !isISO(toDate)) throw new HttpError(400, 'Enter valid dates.');
  if (toDate < fromDate) throw new HttpError(400, 'The last day cannot be before the first day.');
  if (fromDate < toISO(addDays(new Date(), -MAX_BACKDATE_DAYS))) throw new HttpError(400, `Leave can be applied for up to ${MAX_BACKDATE_DAYS} days after it started.`);
  if (fromDate > toISO(addDays(new Date(), 366))) throw new HttpError(400, 'That date is too far ahead.');
  const half = body.halfDay === true;
  if (half && fromDate !== toDate) throw new HttpError(400, 'A half day must be a single date.');
  const reason = str(body.reason, 500, 'Reason', !byOffice);

  const { rowCount: clash } = await q(
    "select 1 from leave_requests where employee_id = $1 and status in ('pending', 'approved') and from_date <= $3 and to_date >= $2", [employeeId, fromDate, toDate],
  );
  if (clash) throw new HttpError(409, 'You already have leave requested or approved for some of these dates.');
  const days = await countDays(fromDate, toDate, half);
  await leaveAllowed(employeeId, type, Number(fromDate.slice(0, 4)), days);

  const { rows: [r] } = await q(
    `insert into leave_requests (employee_id, leave_type_id, from_date, to_date, half_day, days, reason, status, applied_by, decided_by, decided_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning id`,
    [employeeId, type.id, fromDate, toDate, half, days, reason, byOffice ? 'approved' : 'pending', actor.id, byOffice ? actor.id : null, byOffice ? new Date() : null],
  );
  await audit(actor, byOffice ? 'leave.record' : 'leave.apply', 'leave', r.id, { type: type.name, fromDate, toDate, days });
  return (await q(`${REQUEST_SELECT} where r.id = $1`, [r.id])).rows[0];
}

/* ---------------- employee ---------------- */

export async function listMine(employeeId, year = new Date().getFullYear()) {
  const { rows } = await q(`${REQUEST_SELECT} where r.employee_id = $1 order by r.from_date desc, r.created_at desc limit 200`, [employeeId]);
  return { year, balances: await balances(employeeId, year), types: await listTypes({ activeOnly: true }), requests: rows };
}

export async function cancel(employeeId, id, actor) {
  const { rows: [r] } = await q('select id, status, from_date::text as "fromDate" from leave_requests where id = $1 and employee_id = $2 for update', [id, employeeId]);
  if (!r) throw new HttpError(404, 'Leave request not found.');
  if (r.status === 'approved' && r.fromDate < today()) throw new HttpError(409, 'This leave has already started. Ask the office to change it.');
  if (!['pending', 'approved'].includes(r.status)) throw new HttpError(409, `This request is already ${r.status}.`);
  await q("update leave_requests set status = 'cancelled' where id = $1", [id]);
  await audit(actor, 'leave.cancel', 'leave', id);
  return (await q(`${REQUEST_SELECT} where r.id = $1`, [id])).rows[0];
}

/* ---------------- office ---------------- */

export async function listForAdmin({ status, search } = {}) {
  const { rows } = await q(`${REQUEST_SELECT} order by (r.status = 'pending') desc, r.from_date desc, r.created_at desc limit 500`);
  const s = String(search || '').toLowerCase();
  const filtered = rows.filter((r) => (!status || r.status === status)
    && (!s || r.employeeName.toLowerCase().includes(s) || r.employeeCode.toLowerCase().includes(s)));
  const counts = rows.reduce((a, r) => ({ ...a, [r.status]: (a[r.status] || 0) + 1 }), {});
  return { requests: filtered, counts, types: await listTypes() };
}

async function tell(id, decision) {
  const { rows: [r] } = await q(
    `select r.from_date::text as "fromDate", r.to_date::text as "toDate", r.days::float8 as days, r.remark, t.name as "typeName", e.name, e.email
     from leave_requests r join leave_types t on t.id = r.leave_type_id join employees e on e.id = r.employee_id where r.id = $1`, [id],
  );
  if (!r?.email) return;
  const info = await tenantInfo();
  await queueEmail(r.email, 'leaveUpdate', { institute: info.name, name: r.name, typeName: r.typeName, fromDate: r.fromDate, toDate: r.toDate, days: r.days, decision, remark: r.remark, url: `${env.APP_URL}/login` });
}

/** body: { decision: 'approve' | 'reject', remark } */
export async function decide(id, body = {}, admin) {
  const { rows: [r] } = await q(
    `select r.*, r.from_date::text as "fromDate", t.id as tid, t.name as "typeName", t.days_per_year::float8 as "daysPerYear"
     from leave_requests r join leave_types t on t.id = r.leave_type_id where r.id = $1 for update of r`, [id],
  );
  if (!r) throw new HttpError(404, 'Leave request not found.');
  if (r.status !== 'pending') throw new HttpError(409, `This request is already ${r.status}.`);
  const remark = str(body.remark, 300, 'Reason', body.decision === 'reject');
  if (body.decision === 'approve') {
    await leaveAllowed(r.employee_id, { id: r.tid, name: r.typeName, daysPerYear: r.daysPerYear }, Number(r.fromDate.slice(0, 4)), Number(r.days), id);
    await q("update leave_requests set status = 'approved', remark = $2, decided_by = $3, decided_at = now() where id = $1", [id, remark, admin.id]);
    await audit(admin, 'leave.approve', 'leave', id);
  } else if (body.decision === 'reject') {
    await q("update leave_requests set status = 'rejected', remark = $2, decided_by = $3, decided_at = now() where id = $1", [id, remark, admin.id]);
    await audit(admin, 'leave.reject', 'leave', id);
  } else {
    throw new HttpError(400, 'Decision must be approve or reject.');
  }
  await tell(id, body.decision === 'approve' ? 'approved' : 'rejected');
  return (await q(`${REQUEST_SELECT} where r.id = $1`, [id])).rows[0];
}

/** Employees with approved leave on a date (default today). */
export async function onLeave(date = today()) {
  const { rows } = await q(
    `select e.id as "employeeId", e.name, d.name as department, t.name as "typeName", r.to_date::text as "toDate"
     from leave_requests r join employees e on e.id = r.employee_id join leave_types t on t.id = r.leave_type_id
     left join departments d on d.id = e.department_id
     where r.status = 'approved' and r.from_date <= $1 and r.to_date >= $1 order by e.name`, [date],
  );
  return rows;
}

export async function pendingCount() {
  return (await q("select count(*)::int as n from leave_requests where status = 'pending'")).rows[0].n;
}

/** Every employee against every active type for a year: days taken, and the allowance. */
export async function balancesAll(year = new Date().getFullYear()) {
  const types = await listTypes({ activeOnly: true });
  const { rows } = await q(
    `select e.id as "employeeId", e.name, e.emp_code as code, d.name as department, r.leave_type_id as "typeId",
            coalesce(sum(r.days) filter (where r.status = 'approved'), 0)::float8 as used
     from employees e left join departments d on d.id = e.department_id
     left join leave_requests r on r.employee_id = e.id and extract(year from r.from_date) = $1
     group by e.id, d.name, r.leave_type_id order by e.name`, [year],
  );
  const byEmp = new Map();
  for (const r of rows) {
    if (!byEmp.has(r.employeeId)) byEmp.set(r.employeeId, { employeeId: r.employeeId, name: r.name, code: r.code, department: r.department, used: {} });
    if (r.typeId) byEmp.get(r.employeeId).used[r.typeId] = r.used;
  }
  return { year, types, employees: [...byEmp.values()] };
}

/** The office records leave for someone (already approved). */
export const recordForEmployee = (body, admin) => apply(body.employeeId, body, admin, { byOffice: true });

/**
 * Payroll. Each employee has a monthly salary (basic, HRA, allowances, PF as a percent of basic, other fixed deductions).
 * A monthly run makes one payslip per employee who has a salary. Approved leave without pay in that month is deducted
 * at gross / days in the month. A run stays a draft (it can be made again) until it is finalised; only then can employees
 * open their payslips. A payslip keeps the amounts as they were at run time.
 */
import { env } from '../config/env.js';
import { isUuid, q } from '../db/pool.js';
import { audit } from '../db/audit.js';
import { HttpError } from '../middleware/error.js';
import { toISO } from '../utils/dates.js';
import { queueEmail, tenantInfo } from './notifications.service.js';
import { workingDays } from './leave.service.js';

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

const amount = (v, label, { required = false } = {}) => {
  if ((v === '' || v === undefined || v === null)) { if (required) throw new HttpError(400, `${label} is required.`); return 0; }
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 100_000_000) throw new HttpError(400, `${label} must be a valid amount.`);
  return r2(n);
};

/* ---------------- salaries ---------------- */

const gross = (s) => r2(s.basic + s.hra + s.allowances);

export async function listSalaries({ search } = {}) {
  const { rows } = await q(
    `select e.id as "employeeId", e.emp_code as "empCode", e.name, d.name as department, g.name as designation,
            s.basic::float8 as basic, s.hra::float8 as hra, s.allowances::float8 as allowances,
            s.pf_percent::float8 as "pfPercent", s.other_deductions::float8 as "otherDeductions", (s.employee_id is not null) as "hasSalary"
     from employees e
     join departments d on d.id = e.department_id join designations g on g.id = e.designation_id
     left join employee_salaries s on s.employee_id = e.id order by lower(e.name)`,
  );
  const needle = String(search || '').toLowerCase();
  return rows.filter((r) => !needle || r.name.toLowerCase().includes(needle) || r.empCode.toLowerCase().includes(needle))
    .map((r) => ({ ...r, gross: r.hasSalary ? gross(r) : null }));
}

export async function setSalary(employeeId, body = {}, admin) {
  if (!isUuid(employeeId) || !(await q('select 1 from employees where id = $1', [employeeId])).rowCount) throw new HttpError(404, 'Employee not found.');
  const s = {
    basic: amount(body.basic, 'Basic pay', { required: true }), hra: amount(body.hra, 'HRA'), allowances: amount(body.allowances, 'Allowances'),
    pf: body.pfPercent === '' || body.pfPercent == null ? 12 : Number(body.pfPercent), other: amount(body.otherDeductions, 'Other deductions'),
  };
  if (!Number.isFinite(s.pf) || s.pf < 0 || s.pf > 100) throw new HttpError(400, 'PF percent must be between 0 and 100.');
  const g = r2(s.basic + s.hra + s.allowances);
  if (g <= 0) throw new HttpError(400, 'The salary must be more than zero.');
  if (r2(s.basic * s.pf / 100) + s.other > g) throw new HttpError(400, 'The deductions are more than the gross salary.');
  await q(
    `insert into employee_salaries (employee_id, basic, hra, allowances, pf_percent, other_deductions) values ($1, $2, $3, $4, $5, $6)
     on conflict (tenant_id, employee_id) do update set basic = $2, hra = $3, allowances = $4, pf_percent = $5, other_deductions = $6, updated_at = now()`,
    [employeeId, s.basic, s.hra, s.allowances, s.pf, s.other],
  );
  await audit(admin, 'payroll.salary.set', 'employee', employeeId);
  return (await listSalaries()).find((r) => r.employeeId === employeeId);
}

export async function removeSalary(employeeId, admin) {
  const { rowCount } = await q('delete from employee_salaries where employee_id = $1', [employeeId]);
  if (!rowCount) throw new HttpError(404, 'This employee has no salary set.');
  await audit(admin, 'payroll.salary.remove', 'employee', employeeId);
}

/* ---------------- runs ---------------- */

const monthEnd = (month) => { const [y, m] = month.split('-').map(Number); return toISO(new Date(y, m, 0)); };
const daysIn = (month) => Number(monthEnd(month).slice(8));

/** Days of approved leave without pay that fall inside the month (Sundays and holidays are not counted). */
async function unpaidDaysIn(employeeId, month) {
  const first = `${month}-01`; const last = monthEnd(month);
  const { rows } = await q(
    `select r.from_date::text as f, r.to_date::text as t, r.half_day as half from leave_requests r join leave_types t on t.id = r.leave_type_id
     where r.employee_id = $1 and r.status = 'approved' and t.days_per_year is null and r.from_date <= $3 and r.to_date >= $2`, [employeeId, first, last],
  );
  let total = 0;
  for (const r of rows) {
    if (r.half) { total += 0.5; continue; }
    total += await workingDays(r.f < first ? first : r.f, r.t > last ? last : r.t);
  }
  return total;
}

const RUN_SELECT = `
  select p.id, p.month, p.status, p.finalised_at as "finalisedAt", p.created_at as "createdAt",
         (select count(*) from payslips s where s.run_id = p.id)::int as payslips,
         coalesce((select sum(s.gross) from payslips s where s.run_id = p.id), 0)::float8 as gross,
         coalesce((select sum(s.net) from payslips s where s.run_id = p.id), 0)::float8 as net
  from payroll_runs p`;

export async function listRuns() {
  const { rows } = await q(`${RUN_SELECT} order by p.month desc`);
  return rows;
}

const SLIP_SELECT = `
  select s.id, s.run_id as "runId", p.month, s.employee_id as "employeeId", e.name, e.emp_code as "empCode", d.name as department, g.name as designation,
         s.basic::float8 as basic, s.hra::float8 as hra, s.allowances::float8 as allowances, s.gross::float8 as gross, s.pf::float8 as pf,
         s.other_deductions::float8 as "otherDeductions", s.unpaid_days::float8 as "unpaidDays", s.unpaid_amount::float8 as "unpaidAmount",
         s.total_deductions::float8 as "totalDeductions", s.net::float8 as net
  from payslips s join payroll_runs p on p.id = s.run_id join employees e on e.id = s.employee_id
  join departments d on d.id = e.department_id join designations g on g.id = e.designation_id`;

export async function getRun(id) {
  const { rows: [run] } = await q(`${RUN_SELECT} where p.id = $1`, [id]);
  if (!run) throw new HttpError(404, 'Payroll run not found.');
  const { rows } = await q(`${SLIP_SELECT} where s.run_id = $1 order by lower(e.name)`, [id]);
  return { run, payslips: rows };
}

/** Makes (or, for a draft, re-makes) the payslips of a month. */
export async function createRun(body = {}, admin) {
  const month = typeof body.month === 'string' ? body.month : '';
  if (!MONTH_RE.test(month)) throw new HttpError(400, 'Choose a month.');
  if (month > toISO(new Date()).slice(0, 7)) throw new HttpError(400, 'Payroll cannot be run for a month that has not started.');
  let { rows: [run] } = await q('select id, status from payroll_runs where month = $1 for update', [month]);
  if (run?.status === 'finalised') throw new HttpError(409, 'This month is already finalised.');
  if (run) await q('delete from payslips where run_id = $1', [run.id]);
  else ({ rows: [run] } = await q('insert into payroll_runs (month, created_by) values ($1, $2) returning id, status', [month, admin.id]));

  const { rows: staff } = await q(
    `select s.employee_id as id, s.basic::float8 as basic, s.hra::float8 as hra, s.allowances::float8 as allowances, s.pf_percent::float8 as pf, s.other_deductions::float8 as other
     from employee_salaries s join employees e on e.id = s.employee_id where e.join_date <= $1`, [monthEnd(month)],
  );
  if (!staff.length) throw new HttpError(409, 'No employee has a salary set for this month yet.');
  for (const s of staff) {
    const g = r2(s.basic + s.hra + s.allowances);
    const unpaidDays = await unpaidDaysIn(s.id, month);
    const unpaid = Math.min(g, r2(g / daysIn(month) * unpaidDays));
    const pf = r2(s.basic * s.pf / 100);
    const total = r2(pf + s.other + unpaid);
    await q(
      `insert into payslips (run_id, employee_id, basic, hra, allowances, gross, pf, other_deductions, unpaid_days, unpaid_amount, total_deductions, net)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [run.id, s.id, s.basic, s.hra, s.allowances, g, pf, s.other, unpaidDays, unpaid, total, Math.max(0, r2(g - total))],
    );
  }
  await audit(admin, 'payroll.run', 'payroll_run', run.id, { month, payslips: staff.length });
  return getRun(run.id);
}

export async function finalise(id, admin) {
  const { rows: [run] } = await q("select id, month, status from payroll_runs where id = $1 for update", [id]);
  if (!run) throw new HttpError(404, 'Payroll run not found.');
  if (run.status === 'finalised') throw new HttpError(409, 'This month is already finalised.');
  const { rows: slips } = await q(
    'select e.name, e.email from payslips s join employees e on e.id = s.employee_id where s.run_id = $1', [id],
  );
  if (!slips.length) throw new HttpError(409, 'There are no payslips to finalise.');
  await q("update payroll_runs set status = 'finalised', finalised_at = now() where id = $1", [id]);
  const info = await tenantInfo();
  for (const e of slips) {
    if (e.email) await queueEmail(e.email, 'payslipReady', { institute: info.name, name: e.name, month: monthLabel(run.month), url: `${env.APP_URL}/login` });
  }
  await audit(admin, 'payroll.finalise', 'payroll_run', id, { month: run.month });
  return getRun(id);
}

export async function removeRun(id, admin) {
  const { rows: [run] } = await q('select month, status from payroll_runs where id = $1', [id]);
  if (!run) throw new HttpError(404, 'Payroll run not found.');
  if (run.status === 'finalised') throw new HttpError(409, 'A finalised month cannot be deleted.');
  await q('delete from payroll_runs where id = $1', [id]);
  await audit(admin, 'payroll.run.delete', 'payroll_run', id, { month: run.month });
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const monthLabel = (month) => `${MONTHS[Number(month.slice(5)) - 1]} ${month.slice(0, 4)}`;

/* ---------------- what an employee sees ---------------- */

export async function myPayslips(employeeId) {
  const { rows } = await q(`${SLIP_SELECT} where s.employee_id = $1 and p.status = 'finalised' order by p.month desc`, [employeeId]);
  return { payslips: rows };
}

/** One payslip for the PDF. An employee only gets their own, and only once the month is finalised. */
export async function slipForPdf(id, { employeeId } = {}) {
  const { rows: [s] } = await q(`${SLIP_SELECT.replace('select s.id,', "select p.status as \"runStatus\", s.id,")} where s.id = $1`, [id]);
  if (!s || (employeeId && (s.employeeId !== employeeId || s.runStatus !== 'finalised'))) throw new HttpError(404, 'Payslip not found.');
  return { ...s, monthDays: daysIn(s.month) };
}

export const draftCount = async () => (await q("select count(*)::int as n from payroll_runs where status = 'draft'")).rows[0].n;

/**
 * Visitor management. The gate logs every visitor: expected ones are pre-registered (by the office, or by the staff
 * member they are meeting); walk-ins are registered and checked in on the spot. Each visit has a pass number, a host and
 * a purpose, and is checked in and out. The host is emailed when their visitor arrives.
 */
import { env } from '../config/env.js';
import { isUuid, q } from '../db/pool.js';
import { audit } from '../db/audit.js';
import { nextNumber } from '../db/series.js';
import { HttpError } from '../middleware/error.js';
import { isISO, toISO } from '../utils/dates.js';
import { queueEmail, tenantInfo } from './notifications.service.js';
import { notifyEmployee } from './inbox.service.js';

export const PURPOSES = ['Meeting', 'Admission enquiry', 'Parent visit', 'Interview', 'Delivery', 'Maintenance or vendor', 'Event', 'Other'];
export const ID_TYPES = ['Aadhaar', 'Driving licence', 'Voter ID', 'Passport', 'Company ID', 'Other'];
const OVERSTAY_HOURS = 8;

const str = (v, max, label, required = false) => {
  const s = typeof v === 'string' ? v.trim() : '';
  if (required && !s) throw new HttpError(400, `${label} is required.`);
  if (s.length > max) throw new HttpError(400, `${label} is too long (${max} characters at most).`);
  return s;
};

const SELECT = `
  select v.id, v.pass_no as "passNo", v.visitor_name as "visitorName", v.phone, v.email, v.organisation, v.purpose, v.host_id as "hostId",
         e.name as "hostName", v.host_note as "hostNote", v.people, v.vehicle_no as "vehicleNo", v.id_shown as "idShown", v.notes,
         v.expected_on as "expectedOn", v.status, v.check_in_at as "checkInAt", v.check_out_at as "checkOutAt", v.created_at as "createdAt",
         (v.status = 'checked_in' and v.check_in_at < now() - interval '${OVERSTAY_HOURS} hours') as overstay
  from visitor_visits v left join employees e on e.id = v.host_id`;

function clean(b = {}) {
  const purpose = b.purpose;
  if (!PURPOSES.includes(purpose)) throw new HttpError(400, 'Choose the purpose of the visit.');
  const idShown = b.idShown || '';
  if (idShown && !ID_TYPES.includes(idShown)) throw new HttpError(400, 'Choose a valid ID type.');
  const people = Number(b.people ?? 1);
  if (!Number.isInteger(people) || people < 1 || people > 50) throw new HttpError(400, 'Number of people must be from 1 to 50.');
  const expectedOn = b.expectedOn || null;
  if (expectedOn && !isISO(expectedOn)) throw new HttpError(400, 'Enter a valid date for the visit.');
  const email = str(b.email, 120, 'Email');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Enter a valid email address.');
  return {
    visitorName: str(b.visitorName, 120, 'Visitor name', true), phone: str(b.phone, 30, 'Phone'), email, organisation: str(b.organisation, 120, 'Organisation'),
    purpose, hostNote: str(b.hostNote, 120, 'Whom they are meeting'), people, vehicleNo: str(b.vehicleNo, 20, 'Vehicle number').toUpperCase(),
    idShown, notes: str(b.notes, 500, 'Notes'), expectedOn,
  };
}

async function hostOrThrow(hostId) {
  if (!hostId) return null;
  if (!isUuid(hostId) || !(await q("select 1 from employees where id = $1", [hostId])).rowCount) throw new HttpError(400, 'Choose a valid host.');
  return hostId;
}

async function notifyHost(visit) {
  if (!visit.hostId) return;
  await notifyEmployee(visit.hostId, { kind: 'visitor', title: `${visit.visitorName} has arrived to meet you`, body: `${visit.purpose}${visit.organisation ? `, ${visit.organisation}` : ''}. Pass ${visit.passNo}.`, link: '/employee/visitors' });
  const { rows: [h] } = await q('select name, email from employees where id = $1', [visit.hostId]);
  if (!h?.email) return;
  const info = await tenantInfo();
  await queueEmail(h.email, 'visitorArrived', { institute: info.name, name: h.name, visitor: visit.visitorName, organisation: visit.organisation, purpose: visit.purpose, passNo: visit.passNo, url: `${env.APP_URL}/login` });
}

/** The office registers an expected visitor or a walk-in (`checkIn: true`); staff register visitors they are expecting. */
export async function register(actor, body = {}) {
  const c = clean(body);
  const staff = actor.role === 'employee';
  const hostId = await hostOrThrow(staff ? actor.employeeId : body.hostId);
  if (!hostId && !c.hostNote && !staff) { /* the gate may log a visit with no named host */ }
  const walkIn = !staff && body.checkIn === true;
  const today = toISO(new Date());
  const expectedOn = walkIn ? today : (c.expectedOn || today);
  if (!walkIn && expectedOn < today) throw new HttpError(400, 'The visit date cannot be in the past.');
  const passNo = await nextNumber('visitor', { prefix: 'VIS', padding: 5 });
  const { rows: [r] } = await q(
    `insert into visitor_visits (pass_no, visitor_name, phone, email, organisation, purpose, host_id, host_note, people, vehicle_no, id_shown, notes,
                                 expected_on, status, check_in_at, created_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, case when $14 = 'checked_in' then now() end, $15) returning id`,
    [passNo, c.visitorName, c.phone, c.email, c.organisation, c.purpose, hostId, c.hostNote, c.people, c.vehicleNo, c.idShown, c.notes, expectedOn,
      walkIn ? 'checked_in' : 'expected', actor.id],
  );
  await audit(actor, walkIn ? 'visitor.walkin' : 'visitor.register', 'visitor_visit', r.id, { passNo });
  const v = await one(r.id);
  if (walkIn) await notifyHost(v);
  return v;
}

async function one(id) {
  if (!isUuid(id)) throw new HttpError(404, 'Visit not found.');
  const { rows: [v] } = await q(`${SELECT} where v.id = $1`, [id]);
  if (!v) throw new HttpError(404, 'Visit not found.');
  return v;
}

export async function list(actor, { status, date, search, scope } = {}) {
  const own = actor.role === 'employee';
  const params = [own ? actor.employeeId : null, status || null, date && isISO(date) ? date : null, search ? `%${String(search).trim().toLowerCase()}%` : null];
  const { rows } = await q(
    `${SELECT}
     where ($1::uuid is null or v.host_id = $1)
       and ($2::text is null or v.status = $2)
       and ($3::date is null or v.expected_on = $3 or v.check_in_at::date = $3)
       and ($4::text is null or lower(v.visitor_name) like $4 or lower(v.organisation) like $4 or lower(v.pass_no) like $4 or lower(v.phone) like $4)
       and ($5::text is distinct from 'open' or v.status in ('expected', 'checked_in'))
     order by case v.status when 'checked_in' then 0 when 'expected' then 1 else 2 end, coalesce(v.check_in_at, v.expected_on::timestamptz) desc limit 300`,
    [...params, scope || null],
  );
  return rows;
}

export async function summary() {
  const { rows: [t] } = await q(
    `select count(*) filter (where status = 'checked_in')::int as "inCampus",
            count(*) filter (where status = 'expected' and expected_on = current_date)::int as "expectedToday",
            count(*) filter (where check_in_at::date = current_date)::int as "arrivedToday",
            count(*) filter (where check_out_at::date = current_date)::int as "leftToday",
            count(*) filter (where status = 'checked_in' and check_in_at < now() - interval '${OVERSTAY_HOURS} hours')::int as overstaying
     from visitor_visits`,
  );
  return t;
}

async function lock(id) {
  if (!isUuid(id)) throw new HttpError(404, 'Visit not found.');
  const { rows: [v] } = await q('select id, status, host_id as "hostId", pass_no as "passNo", visitor_name as "visitorName", organisation, purpose from visitor_visits where id = $1 for update', [id]);
  if (!v) throw new HttpError(404, 'Visit not found.');
  return v;
}

export async function checkIn(actor, id, body = {}) {
  const v = await lock(id);
  if (v.status !== 'expected') throw new HttpError(409, v.status === 'checked_in' ? 'This visitor is already inside.' : `This visit is ${v.status.replace('_', ' ')}.`);
  const idShown = body.idShown || '';
  if (idShown && !ID_TYPES.includes(idShown)) throw new HttpError(400, 'Choose a valid ID type.');
  await q("update visitor_visits set status = 'checked_in', check_in_at = now(), id_shown = case when $2 <> '' then $2 else id_shown end, vehicle_no = case when $3 <> '' then $3 else vehicle_no end where id = $1",
    [id, idShown, str(body.vehicleNo, 20, 'Vehicle number').toUpperCase()]);
  await audit(actor, 'visitor.checkin', 'visitor_visit', id, { passNo: v.passNo });
  await notifyHost(v);
  return one(id);
}

export async function checkOut(actor, id) {
  const v = await lock(id);
  if (v.status !== 'checked_in') throw new HttpError(409, v.status === 'checked_out' ? 'This visitor has already left.' : 'This visitor has not checked in.');
  await q("update visitor_visits set status = 'checked_out', check_out_at = now() where id = $1", [id]);
  await audit(actor, 'visitor.checkout', 'visitor_visit', id, { passNo: v.passNo });
  return one(id);
}

export async function cancel(actor, id) {
  const v = await lock(id);
  if (actor.role === 'employee' && v.hostId !== actor.employeeId) throw new HttpError(403, 'You can only cancel visits you are hosting.');
  if (v.status !== 'expected') throw new HttpError(409, 'Only an expected visit can be cancelled.');
  await q("update visitor_visits set status = 'cancelled' where id = $1", [id]);
  await audit(actor, 'visitor.cancel', 'visitor_visit', id, { passNo: v.passNo });
  return one(id);
}

/** People list for the host picker (active staff). */
export async function hosts() {
  const { rows } = await q("select id, name, emp_code as code from employees order by name");
  return rows;
}

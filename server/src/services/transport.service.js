/**
 * Transport. The office sets up bus routes (vehicle, driver, ordered stops, monthly charge) and puts students on a
 * stop of a route. A student has at most one current ride; ending or changing it keeps the earlier ride as history.
 */
import { isUuid, q } from '../db/pool.js';
import { audit } from '../db/audit.js';
import { HttpError } from '../middleware/error.js';
import { isISO, toISO } from '../utils/dates.js';

const MAX_STOPS = 60;
const TIME_RE = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

const str = (v, max, label, required = false) => {
  const s = typeof v === 'string' ? v.trim() : '';
  if (required && !s) throw new HttpError(400, `${label} is required.`);
  if (s.length > max) throw new HttpError(400, `${label} is too long (${max} characters at most).`);
  return s;
};
const dup = (err, msg) => { if (err.code === '23505') throw new HttpError(409, msg); throw err; };

const ROUTE_SELECT = `
  select r.id, r.name, r.vehicle_no as "vehicleNo", r.driver_name as "driverName", r.driver_phone as "driverPhone", r.seats,
         r.monthly_fee::float8 as "monthlyFee", r.active,
         (select count(*) from transport_rides x where x.route_id = r.id and x.status = 'active')::int as riders,
         coalesce((select json_agg(json_build_object('id', s.id, 'name', s.name, 'pickupTime', s.pickup_time, 'position', s.position,
                    'riders', (select count(*) from transport_rides x where x.stop_id = s.id and x.status = 'active')::int) order by s.position)
                   from transport_stops s where s.route_id = r.id), '[]'::json) as stops
  from transport_routes r`;

export async function listRoutes() {
  const { rows } = await q(`${ROUTE_SELECT} order by r.active desc, lower(r.name)`);
  return rows;
}

function cleanRoute(b = {}) {
  const seats = Number(b.seats ?? 40);
  if (!Number.isInteger(seats) || seats < 1 || seats > 200) throw new HttpError(400, 'Seats must be a whole number from 1 to 200.');
  const fee = b.monthlyFee === '' || b.monthlyFee == null ? 0 : Number(b.monthlyFee);
  if (!Number.isFinite(fee) || fee < 0 || fee > 10_000_000) throw new HttpError(400, 'Monthly charge must be a valid amount.');
  return {
    name: str(b.name, 80, 'Route name', true), vehicleNo: str(b.vehicleNo, 30, 'Vehicle number'), driverName: str(b.driverName, 80, 'Driver name'),
    driverPhone: str(b.driverPhone, 30, 'Driver phone'), seats, fee: Math.round(fee * 100) / 100, active: b.active !== false,
  };
}

function cleanStops(list) {
  if (!Array.isArray(list)) throw new HttpError(400, 'Send the stops as a list.');
  if (list.length > MAX_STOPS) throw new HttpError(400, `A route can have up to ${MAX_STOPS} stops.`);
  const seen = new Set();
  return list.map((s, i) => {
    const name = str(s?.name, 80, `Stop ${i + 1} name`, true);
    const time = typeof s.pickupTime === 'string' ? s.pickupTime.trim() : '';
    if (time && !TIME_RE.test(time)) throw new HttpError(400, `Stop "${name}": enter the pickup time as HH:MM.`);
    if (seen.has(name.toLowerCase())) throw new HttpError(400, `Stop "${name}" is listed twice.`);
    seen.add(name.toLowerCase());
    return { id: isUuid(s.id) ? s.id : null, name, time };
  });
}

/** Replaces a route's stops in the order given. Stops that riders use are kept (renamed or re-timed), not recreated. */
async function saveStops(routeId, list) {
  const stops = cleanStops(list);
  const { rows: existing } = await q('select id from transport_stops where route_id = $1', [routeId]);
  const have = new Set(existing.map((e) => e.id));
  const keep = new Set(stops.filter((s) => s.id && have.has(s.id)).map((s) => s.id));
  for (const e of existing) {
    if (keep.has(e.id)) continue;
    const { rows: [{ n }] } = await q('select count(*)::int as n from transport_rides where stop_id = $1', [e.id]);
    if (n) throw new HttpError(409, 'A stop that students ride from cannot be removed. End their rides or move them first.');
    await q('delete from transport_stops where id = $1', [e.id]);
  }
  for (const [i, s] of stops.entries()) {
    if (s.id && have.has(s.id)) await q('update transport_stops set name = $2, position = $3, pickup_time = $4 where id = $1', [s.id, s.name, i + 1, s.time]);
    else await q('insert into transport_stops (route_id, name, position, pickup_time) values ($1, $2, $3, $4)', [routeId, s.name, i + 1, s.time]);
  }
}

export async function createRoute(body, admin) {
  const r = cleanRoute(body);
  try {
    const { rows: [row] } = await q(
      'insert into transport_routes (name, vehicle_no, driver_name, driver_phone, seats, monthly_fee, active) values ($1, $2, $3, $4, $5, $6, $7) returning id',
      [r.name, r.vehicleNo, r.driverName, r.driverPhone, r.seats, r.fee, r.active],
    );
    if (body.stops) await saveStops(row.id, body.stops);
    await audit(admin, 'transport.route.create', 'transport_route', row.id, { name: r.name });
    return (await q(`${ROUTE_SELECT} where r.id = $1`, [row.id])).rows[0];
  } catch (err) { return dup(err, 'There is already a route with this name.'); }
}

export async function updateRoute(id, body, admin) {
  const r = cleanRoute(body);
  const { rows: [cur] } = await q(`${ROUTE_SELECT} where r.id = $1`, [id]);
  if (!cur) throw new HttpError(404, 'Route not found.');
  if (r.seats < cur.riders) throw new HttpError(409, `${cur.riders} student${cur.riders === 1 ? ' rides' : 's ride'} this route. Seats cannot be fewer than that.`);
  try {
    await q('update transport_routes set name = $2, vehicle_no = $3, driver_name = $4, driver_phone = $5, seats = $6, monthly_fee = $7, active = $8 where id = $1',
      [id, r.name, r.vehicleNo, r.driverName, r.driverPhone, r.seats, r.fee, r.active]);
  } catch (err) { dup(err, 'There is already a route with this name.'); }
  if (body.stops) await saveStops(id, body.stops);
  await audit(admin, 'transport.route.update', 'transport_route', id, { name: r.name });
  return (await q(`${ROUTE_SELECT} where r.id = $1`, [id])).rows[0];
}

export async function removeRoute(id, admin) {
  const { rows: [r] } = await q('select name from transport_routes where id = $1', [id]);
  if (!r) throw new HttpError(404, 'Route not found.');
  if ((await q('select 1 from transport_rides where route_id = $1', [id])).rowCount) throw new HttpError(409, `"${r.name}" has ride records. Mark it inactive instead of deleting it.`);
  await q('delete from transport_routes where id = $1', [id]);
  await audit(admin, 'transport.route.delete', 'transport_route', id, { name: r.name });
}

/* ---------------- rides ---------------- */

const RIDE_SELECT = `
  select x.id, x.status, x.from_date as "from", x.to_date as "to",
         st.id as "studentId", st.name, st.student_code as "studentCode", c.name as course,
         r.id as "routeId", r.name as route, r.vehicle_no as "vehicleNo", r.driver_name as "driverName", r.driver_phone as "driverPhone",
         r.monthly_fee::float8 as "monthlyFee", s.id as "stopId", s.name as stop, s.pickup_time as "pickupTime"
  from transport_rides x
  join students st on st.id = x.student_id
  join transport_routes r on r.id = x.route_id
  join transport_stops s on s.id = x.stop_id
  left join courses c on c.id = st.course_id`;

export async function listRides({ routeId, status = 'active', search } = {}) {
  const where = []; const args = [];
  if (routeId) { args.push(routeId); where.push(`r.id = $${args.length}`); }
  if (status === 'active' || status === 'ended') { args.push(status); where.push(`x.status = $${args.length}`); }
  if (search) { args.push(`%${String(search).toLowerCase()}%`); where.push(`(lower(st.name) like $${args.length} or lower(st.student_code) like $${args.length})`); }
  const { rows } = await q(`${RIDE_SELECT} ${where.length ? `where ${where.join(' and ')}` : ''} order by r.name, s.position, st.name limit 500`, args);
  return rows;
}

export async function assign(body = {}, admin) {
  if (!isUuid(body.studentId) || !isUuid(body.stopId)) throw new HttpError(400, 'Choose a student and a stop.');
  const { rows: [st] } = await q('select id, name, status from students where id = $1', [body.studentId]);
  if (!st) throw new HttpError(404, 'Student not found.');
  if (st.status !== 'Active') throw new HttpError(409, 'Only active students can be put on a route.');
  const { rows: [stop] } = await q(
    `select s.id, s.route_id, r.seats, r.active, (select count(*) from transport_rides x where x.route_id = r.id and x.status = 'active')::int as riders
     from transport_stops s join transport_routes r on r.id = s.route_id where s.id = $1 for update of r`, [body.stopId],
  );
  if (!stop) throw new HttpError(404, 'Stop not found.');
  if (!stop.active) throw new HttpError(409, 'This route is not running.');
  if (stop.riders >= stop.seats) throw new HttpError(409, 'This route is full.');
  const fromDate = body.fromDate || toISO(new Date());
  if (!isISO(fromDate)) throw new HttpError(400, 'Enter a valid date.');
  try {
    const { rows: [r] } = await q('insert into transport_rides (route_id, stop_id, student_id, from_date, created_by) values ($1, $2, $3, $4, $5) returning id',
      [stop.route_id, stop.id, st.id, fromDate, admin.id]);
    await audit(admin, 'transport.assign', 'student', st.id, { stop: stop.id });
    return (await q(`${RIDE_SELECT} where x.id = $1`, [r.id])).rows[0];
  } catch (err) { return dup(err, `${st.name} is already on a route. End that ride or change it instead.`); }
}

export async function endRide(id, body = {}, admin) {
  const { rows: [x] } = await q("select id, student_id, from_date::text as f from transport_rides where id = $1 and status = 'active' for update", [id]);
  if (!x) throw new HttpError(404, 'This student is not on a route.');
  const to = body.toDate || toISO(new Date());
  if (!isISO(to)) throw new HttpError(400, 'Enter a valid date.');
  await q("update transport_rides set status = 'ended', to_date = $2 where id = $1", [id, to < x.f ? x.f : to]);
  await audit(admin, 'transport.end', 'student', x.student_id);
  return (await q(`${RIDE_SELECT} where x.id = $1`, [id])).rows[0];
}

/** Moves a student to another stop (of any route): the old ride ends and a new one starts. */
export async function change(id, body = {}, admin) {
  const { rows: [x] } = await q("select student_id from transport_rides where id = $1 and status = 'active'", [id]);
  if (!x) throw new HttpError(404, 'This student is not on a route.');
  await endRide(id, {}, admin);
  return assign({ studentId: x.student_id, stopId: body.stopId }, admin);
}

export async function myRide(studentId) {
  const { rows } = await q(`${RIDE_SELECT} where x.student_id = $1 order by x.from_date desc, x.created_at desc`, [studentId]);
  return { current: rows.find((r) => r.status === 'active') || null, history: rows.filter((r) => r.status !== 'active') };
}

export async function summary() {
  const { rows: [r] } = await q(
    `select (select count(*) from transport_routes where active)::int as routes, (select count(*) from transport_rides where status = 'active')::int as riders`,
  );
  return r;
}

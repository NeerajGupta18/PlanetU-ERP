/**
 * Hostel. The office lists hostels and their rooms (bed count and monthly charge) and allots students to rooms.
 * A student has at most one current stay; leaving or moving keeps the earlier stay as history.
 */
import { isUuid, q } from '../db/pool.js';
import { audit } from '../db/audit.js';
import { HttpError } from '../middleware/error.js';
import { isISO, toISO } from '../utils/dates.js';

const KINDS = ['boys', 'girls', 'mixed'];
const MAX_ROOMS_AT_ONCE = 200;

const str = (v, max, label, required = false) => {
  const s = typeof v === 'string' ? v.trim() : '';
  if (required && !s) throw new HttpError(400, `${label} is required.`);
  if (s.length > max) throw new HttpError(400, `${label} is too long (${max} characters at most).`);
  return s;
};
const money = (v, label) => {
  const n = v === '' || v === undefined || v === null ? 0 : Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 10_000_000) throw new HttpError(400, `${label} must be a valid amount.`);
  return Math.round(n * 100) / 100;
};
const int = (v, min, max, label) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, `${label} must be a whole number from ${min} to ${max}.`);
  return n;
};
const dup = (err, msg) => { if (err.code === '23505') throw new HttpError(409, msg); throw err; };

/* ---------------- hostels ---------------- */

const HOSTEL_SELECT = `
  select h.id, h.name, h.kind, h.phone, h.notes, h.active, h.warden_id as "wardenId", w.name as warden,
         (select count(*) from hostel_rooms r where r.hostel_id = h.id and r.active)::int as rooms,
         coalesce((select sum(r.beds) from hostel_rooms r where r.hostel_id = h.id and r.active), 0)::int as beds,
         (select count(*) from hostel_stays s join hostel_rooms r on r.id = s.room_id where r.hostel_id = h.id and s.status = 'active')::int as occupied
  from hostels h left join employees w on w.id = h.warden_id`;

export async function listHostels() {
  const { rows } = await q(`${HOSTEL_SELECT} order by h.active desc, lower(h.name)`);
  return rows;
}

async function cleanHostel(b = {}) {
  const kind = b.kind ?? 'mixed';
  if (!KINDS.includes(kind)) throw new HttpError(400, 'Choose boys, girls or mixed.');
  const wardenId = b.wardenId || null;
  if (wardenId) {
    if (!isUuid(wardenId) || !(await q('select 1 from employees where id = $1', [wardenId])).rowCount) throw new HttpError(400, 'Choose a valid warden.');
  }
  return { name: str(b.name, 80, 'Name', true), kind, wardenId, phone: str(b.phone, 30, 'Phone'), notes: str(b.notes, 500, 'Notes'), active: b.active !== false };
}

export async function createHostel(body, admin) {
  const h = await cleanHostel(body);
  try {
    const { rows: [r] } = await q(
      'insert into hostels (name, kind, warden_id, phone, notes, active) values ($1, $2, $3, $4, $5, $6) returning id', [h.name, h.kind, h.wardenId, h.phone, h.notes, h.active],
    );
    await audit(admin, 'hostel.create', 'hostel', r.id, { name: h.name });
    return (await q(`${HOSTEL_SELECT} where h.id = $1`, [r.id])).rows[0];
  } catch (err) { return dup(err, 'There is already a hostel with this name.'); }
}

export async function updateHostel(id, body, admin) {
  const h = await cleanHostel(body);
  try {
    const { rowCount } = await q(
      'update hostels set name = $2, kind = $3, warden_id = $4, phone = $5, notes = $6, active = $7 where id = $1', [id, h.name, h.kind, h.wardenId, h.phone, h.notes, h.active],
    );
    if (!rowCount) throw new HttpError(404, 'Hostel not found.');
  } catch (err) { if (!(err instanceof HttpError)) dup(err, 'There is already a hostel with this name.'); throw err; }
  await audit(admin, 'hostel.update', 'hostel', id, { name: h.name });
  return (await q(`${HOSTEL_SELECT} where h.id = $1`, [id])).rows[0];
}

export async function removeHostel(id, admin) {
  const { rows: [h] } = await q('select name from hostels where id = $1', [id]);
  if (!h) throw new HttpError(404, 'Hostel not found.');
  const { rows: [{ n }] } = await q('select count(*)::int as n from hostel_rooms where hostel_id = $1', [id]);
  if (n) throw new HttpError(409, `"${h.name}" still has ${n} room${n === 1 ? '' : 's'}. Remove the rooms first, or mark the hostel inactive instead.`);
  await q('delete from hostels where id = $1', [id]);
  await audit(admin, 'hostel.delete', 'hostel', id, { name: h.name });
}

/* ---------------- rooms ---------------- */

const ROOM_SELECT = `
  select r.id, r.hostel_id as "hostelId", r.room_no as "roomNo", r.floor, r.beds, r.monthly_fee::float8 as "monthlyFee", r.active,
         (select count(*) from hostel_stays s where s.room_id = r.id and s.status = 'active')::int as occupied,
         coalesce((select json_agg(json_build_object('stayId', s.id, 'studentId', st.id, 'name', st.name, 'studentCode', st.student_code, 'from', s.from_date) order by st.name)
                   from hostel_stays s join students st on st.id = s.student_id where s.room_id = r.id and s.status = 'active'), '[]'::json) as occupants
  from hostel_rooms r`;

export async function listRooms(hostelId) {
  const { rowCount } = await q('select 1 from hostels where id = $1', [hostelId]);
  if (!rowCount) throw new HttpError(404, 'Hostel not found.');
  const { rows } = await q(`${ROOM_SELECT} where r.hostel_id = $1 order by r.floor, lower(r.room_no)`, [hostelId]);
  return rows;
}

/** "101, 102, 110-115" -> ['101', '102', '110', ..., '115'] */
export function parseRoomNumbers(text) {
  const out = [];
  for (const tok of String(text || '').split(/[,\n]/).map((t) => t.trim()).filter(Boolean)) {
    const m = /^(\d{1,5})\s*-\s*(\d{1,5})$/.exec(tok);
    if (m) {
      const [a, b] = [Number(m[1]), Number(m[2])];
      if (b < a || b - a >= MAX_ROOMS_AT_ONCE) throw new HttpError(400, `"${tok}" is not a valid range (up to ${MAX_ROOMS_AT_ONCE} rooms at once).`);
      for (let n = a; n <= b; n += 1) out.push(String(n));
    } else {
      if (tok.length > 20) throw new HttpError(400, `Room number "${tok.slice(0, 20)}..." is too long.`);
      out.push(tok);
    }
  }
  if (!out.length) throw new HttpError(400, 'Enter at least one room number.');
  if (out.length > MAX_ROOMS_AT_ONCE) throw new HttpError(400, `Add up to ${MAX_ROOMS_AT_ONCE} rooms at once.`);
  return [...new Set(out)];
}

export async function createRooms(hostelId, body = {}, admin) {
  const { rowCount } = await q('select 1 from hostels where id = $1', [hostelId]);
  if (!rowCount) throw new HttpError(404, 'Hostel not found.');
  const numbers = parseRoomNumbers(body.roomNos ?? body.roomNo);
  const beds = int(body.beds ?? 2, 1, 20, 'Beds');
  const floor = int(body.floor ?? 0, 0, 50, 'Floor');
  const fee = money(body.monthlyFee, 'Monthly charge');
  const clash = (await q('select room_no from hostel_rooms where hostel_id = $1 and lower(room_no) = any($2)', [hostelId, numbers.map((n) => n.toLowerCase())])).rows;
  if (clash.length) throw new HttpError(409, `Room ${clash.map((c) => c.room_no).join(', ')} already exists in this hostel.`);
  for (const n of numbers) await q('insert into hostel_rooms (hostel_id, room_no, floor, beds, monthly_fee) values ($1, $2, $3, $4, $5)', [hostelId, n, floor, beds, fee]);
  await audit(admin, 'hostel.rooms.create', 'hostel', hostelId, { count: numbers.length });
  return { created: numbers.length };
}

export async function updateRoom(id, body = {}, admin) {
  const { rows: [cur] } = await q(`${ROOM_SELECT} where r.id = $1`, [id]);
  if (!cur) throw new HttpError(404, 'Room not found.');
  const beds = int(body.beds ?? cur.beds, 1, 20, 'Beds');
  if (beds < cur.occupied) throw new HttpError(409, `${cur.occupied} student${cur.occupied === 1 ? ' is' : 's are'} staying here. Move them before reducing the beds.`);
  const active = body.active !== false;
  if (!active && cur.occupied) throw new HttpError(409, 'Students are staying in this room. Move them before marking it unavailable.');
  try {
    await q('update hostel_rooms set room_no = $2, floor = $3, beds = $4, monthly_fee = $5, active = $6 where id = $1',
      [id, str(body.roomNo ?? cur.roomNo, 20, 'Room number', true), int(body.floor ?? cur.floor, 0, 50, 'Floor'), beds, money(body.monthlyFee ?? cur.monthlyFee, 'Monthly charge'), active]);
  } catch (err) { dup(err, 'This hostel already has a room with this number.'); }
  await audit(admin, 'hostel.room.update', 'hostel_room', id);
  return (await q(`${ROOM_SELECT} where r.id = $1`, [id])).rows[0];
}

export async function removeRoom(id, admin) {
  const { rowCount: has } = await q('select 1 from hostel_stays where room_id = $1', [id]);
  if (has) throw new HttpError(409, 'This room has stay records. Mark it unavailable instead of deleting it.');
  const { rowCount } = await q('delete from hostel_rooms where id = $1', [id]);
  if (!rowCount) throw new HttpError(404, 'Room not found.');
  await audit(admin, 'hostel.room.delete', 'hostel_room', id);
}

/* ---------------- stays ---------------- */

const STAY_SELECT = `
  select s.id, s.status, s.from_date as "from", s.to_date as "to", s.remark,
         st.id as "studentId", st.name, st.student_code as "studentCode", c.name as course,
         r.id as "roomId", r.room_no as "roomNo", r.floor, r.monthly_fee::float8 as "monthlyFee",
         h.id as "hostelId", h.name as hostel, h.kind
  from hostel_stays s
  join students st on st.id = s.student_id
  join hostel_rooms r on r.id = s.room_id
  join hostels h on h.id = r.hostel_id
  left join courses c on c.id = st.course_id`;

export async function listStays({ hostelId, status = 'active', search } = {}) {
  const where = []; const args = [];
  if (hostelId) { args.push(hostelId); where.push(`h.id = $${args.length}`); }
  if (status === 'active' || status === 'vacated') { args.push(status); where.push(`s.status = $${args.length}`); }
  if (search) { args.push(`%${String(search).toLowerCase()}%`); where.push(`(lower(st.name) like $${args.length} or lower(st.student_code) like $${args.length} or lower(r.room_no) like $${args.length})`); }
  const { rows } = await q(`${STAY_SELECT} ${where.length ? `where ${where.join(' and ')}` : ''} order by h.name, r.room_no, st.name limit 500`, args);
  return rows;
}

async function checkRoomFor(student, roomId) {
  const { rows: [room] } = await q(
    `select r.id, r.beds, r.active, h.kind, h.active as "hostelActive",
            (select count(*) from hostel_stays s where s.room_id = r.id and s.status = 'active')::int as occupied
     from hostel_rooms r join hostels h on h.id = r.hostel_id where r.id = $1 for update of r`, [roomId],
  );
  if (!room) throw new HttpError(404, 'Room not found.');
  if (!room.active || !room.hostelActive) throw new HttpError(409, 'This room is not available.');
  if (room.occupied >= room.beds) throw new HttpError(409, 'This room is full.');
  const g = String(student.gender || '').trim().toLowerCase();
  if (room.kind === 'boys' && g && !g.startsWith('m')) throw new HttpError(409, 'This is a boys hostel.');
  if (room.kind === 'girls' && g && !g.startsWith('f')) throw new HttpError(409, 'This is a girls hostel.');
}

export async function allot(body = {}, admin) {
  if (!isUuid(body.studentId) || !isUuid(body.roomId)) throw new HttpError(400, 'Choose a student and a room.');
  const { rows: [st] } = await q('select id, name, status, gender from students where id = $1', [body.studentId]);
  if (!st) throw new HttpError(404, 'Student not found.');
  if (st.status !== 'Active') throw new HttpError(409, 'Only active students can be allotted a room.');
  const fromDate = body.fromDate || toISO(new Date());
  if (!isISO(fromDate)) throw new HttpError(400, 'Enter a valid date.');
  await checkRoomFor(st, body.roomId);
  try {
    const { rows: [r] } = await q('insert into hostel_stays (room_id, student_id, from_date, remark, created_by) values ($1, $2, $3, $4, $5) returning id',
      [body.roomId, st.id, fromDate, str(body.remark, 300, 'Remark'), admin.id]);
    await audit(admin, 'hostel.allot', 'student', st.id, { room: body.roomId });
    return (await q(`${STAY_SELECT} where s.id = $1`, [r.id])).rows[0];
  } catch (err) { return dup(err, `${st.name} already has a room. Vacate or move them first.`); }
}

export async function vacate(stayId, body = {}, admin) {
  const { rows: [s] } = await q("select id, student_id, from_date::text as f from hostel_stays where id = $1 and status = 'active' for update", [stayId]);
  if (!s) throw new HttpError(404, 'This student does not have a current stay.');
  const to = body.toDate || toISO(new Date());
  if (!isISO(to)) throw new HttpError(400, 'Enter a valid date.');
  const end = to < s.f ? s.f : to;
  await q("update hostel_stays set status = 'vacated', to_date = $2, remark = case when $3 = '' then remark else $3 end where id = $1", [stayId, end, str(body.remark, 300, 'Remark')]);
  await audit(admin, 'hostel.vacate', 'student', s.student_id);
  return (await q(`${STAY_SELECT} where s.id = $1`, [stayId])).rows[0];
}

/** Moves a student to another room: the old stay ends and a new one starts in one step. */
export async function transfer(stayId, body = {}, admin) {
  const { rows: [s] } = await q("select student_id from hostel_stays where id = $1 and status = 'active'", [stayId]);
  if (!s) throw new HttpError(404, 'This student does not have a current stay.');
  await vacate(stayId, { remark: body.remark }, admin);
  return allot({ studentId: s.student_id, roomId: body.roomId, remark: body.remark }, admin);
}

/** What a student (or their parent) sees: the current room, hostel and warden, and earlier stays. */
export async function myStay(studentId) {
  const { rows } = await q(`${STAY_SELECT} where s.student_id = $1 order by s.from_date desc, s.created_at desc`, [studentId]);
  const current = rows.find((r) => r.status === 'active') || null;
  let hostel = null;
  if (current) {
    hostel = (await q(`${HOSTEL_SELECT} where h.id = $1`, [current.hostelId])).rows[0];
    const { rows: [w] } = await q('select e.name, e.email from hostels h join employees e on e.id = h.warden_id where h.id = $1', [current.hostelId]);
    hostel = { name: hostel.name, kind: hostel.kind, phone: hostel.phone, warden: w?.name || null, wardenEmail: w?.email || null };
  }
  return { current, hostel, history: rows.filter((r) => r.status !== 'active') };
}

export async function summary() {
  const { rows: [r] } = await q(
    `select coalesce((select sum(beds) from hostel_rooms where active), 0)::int as beds,
            (select count(*) from hostel_stays where status = 'active')::int as occupied`,
  );
  return r;
}

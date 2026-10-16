/**
 * QR check-in for attendance (colleges and universities only). A teacher opens check-in for today's lecture and
 * shows a QR code on the projector. The QR holds a signed token (not a link, not a typed code) that is replaced every
 * 10 seconds, and only the scanner inside the app sends it to the server. A phone camera app just shows meaningless
 * text, and a photo of the screen goes stale in seconds. The teacher chooses how long check-in stays open (5, 10, ...
 * minutes); that is a separate thing from how often the QR picture changes.
 *
 * Token = PUCI1:<check-in id>:<10-second window>:<HMAC(secret, id:window)>. The secret never leaves the server. The
 * current and the previous window are accepted. Wrong tokens are counted per student. Optional safeguards: the room's
 * location, and one phone marking several students is flagged for the teacher. It proves a student scanned the
 * live screen; the teacher still reviews and submits the sheet.
 */
import crypto from 'node:crypto';
import { isUuid, q } from '../db/pool.js';
import { audit } from '../db/audit.js';
import { HttpError } from '../middleware/error.js';
import { parseISO, toISO } from '../utils/dates.js';
import { findLecture, hideFromOthers, permission, today } from './attendance.service.js';

export const WINDOW_SECONDS = 10;
export const ACCEPT_WINDOWS = 2; // the current 10 seconds and the one before, so a scan in flight still counts
const GEO_RADIUS_M = 150;
export const MAX_FAILS = 5;
const DEFAULT_MINUTES = 10;
const PREFIX = 'PUCI1';
const err = (status, message, code) => Object.assign(new HttpError(status, message), code ? { code } : {});

export const windowOf = (ms = Date.now()) => Math.floor(ms / 1000 / WINDOW_SECONDS);
export function tokenFor(secret, checkinId, window) {
  const sig = crypto.createHmac('sha256', secret).update(`${checkinId}:${window}`).digest('hex').slice(0, 24);
  return `${PREFIX}:${checkinId}:${window}:${sig}`;
}
export function parseToken(text) {
  const m = /^PUCI1:([0-9a-f-]{36}):(\d{1,12}):([0-9a-f]{24})$/.exec(String(text ?? '').trim());
  return m ? { checkinId: m[1], window: Number(m[2]), sig: m[3] } : null;
}
function distanceM(aLat, aLng, bLat, bLng) {
  const rad = (d) => (d * Math.PI) / 180;
  const h = Math.sin(rad(bLat - aLat) / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(rad(bLng - aLng) / 2) ** 2;
  return Math.round(2 * 6371000 * Math.asin(Math.sqrt(h)));
}
const validPoint = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

/** Check-in is for colleges and universities. A school's class teacher takes the daily register instead. */
async function assertEnabled() {
  const { rows: [t] } = await q('select type from tenants where id = app_tenant()');
  if (t?.type === 'school') throw err(403, 'QR check-in is not used in schools. The class teacher marks attendance.', 'CHECKIN_NOT_FOR_SCHOOLS');
}
const same = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

async function lectureOrThrow(slotId, actor) {
  if (!isUuid(slotId)) throw err(400, 'Choose a lecture.');
  const date = today();
  const lecture = await findLecture(slotId, date);
  if (!lecture) throw err(404, 'This lecture does not run today.');
  if (actor) hideFromOthers(actor, lecture);
  return { lecture, date };
}

/* ================================================================== teacher */

async function describe(row, lecture) {
  const now = Date.now();
  const open = row.status === 'open' && new Date(row.closes_at).getTime() > now;
  const base = { open, slotId: row.slot_id, date: row.on_date, lateAfterMinutes: row.late_after_minutes, closesAt: row.closes_at, openedAt: row.opened_at };
  const { rows: [c] } = await q(
    `select count(*)::int as n from attendance_records r join attendance_sessions s on s.id = r.session_id
     where s.slot_id = $1 and s.on_date = $2 and r.marked_via = 'qr'`, [row.slot_id, row.on_date],
  );
  const { rows: recent } = await q(
    `select st.name, r.status, r.updated_at as "at" from attendance_records r join attendance_sessions s on s.id = r.session_id
     join students st on st.id = r.student_id where s.slot_id = $1 and s.on_date = $2 and r.marked_via = 'qr' order by r.updated_at desc limit 8`, [row.slot_id, row.on_date],
  );
  const roster = (await q("select count(*)::int as n from students where course_id = $1 and status = 'Active'", [lecture.courseId])).rows[0].n;
  const { rows: flagged } = await q(
    `select st.name, f.flag from attendance_checkin_scans f join students st on st.id = f.student_id
     where f.checkin_id = $1 and f.flag is not null order by f.scanned_at`, [row.id],
  );
  const out = { ...base, checkedIn: c.n, roster, recent, flagged, locationRequired: row.geo_lat != null, radiusMetres: row.geo_radius_m };
  if (open) {
    const w = windowOf(now);
    out.token = tokenFor(row.secret, row.id, w);
    out.secondsLeft = Math.max(1, (w + 1) * WINDOW_SECONDS - Math.floor(now / 1000));
    out.windowSeconds = WINDOW_SECONDS;
  }
  return out;
}

export async function open(actor, slotId, body = {}) {
  await assertEnabled();
  const { lecture, date } = await lectureOrThrow(slotId, actor);
  const perm = permission(actor, lecture, date);
  if (!perm.ok) throw err(403, perm.reason);
  const { rows: [sess] } = await q('select status from attendance_sessions where slot_id = $1 and on_date = $2', [slotId, date]);
  if (sess?.status === 'submitted') throw err(409, 'Attendance for this lecture is already submitted. Use the sheet to correct it.');
  const minutes = Math.min(120, Math.max(5, Number(body.minutes) || DEFAULT_MINUTES));
  let geo = [null, null, null];
  if (body.requireLocation) {
    const lat = Number(body.lat); const lng = Number(body.lng);
    if (!validPoint(lat, lng)) throw err(400, 'To use the classroom location check, allow location on this device.', 'LOCATION_NEEDED');
    geo = [lat, lng, GEO_RADIUS_M];
  }
  const lateAfter = Math.min(120, Math.max(1, Number(body.lateAfterMinutes) || 10));
  const { rows: [row] } = await q(
    `insert into attendance_checkins (slot_id, on_date, secret, opened_by, closes_at, late_after_minutes, geo_lat, geo_lng, geo_radius_m)
     values ($1, $2, $3, $4, now() + ($5 || ' minutes')::interval, $6, $7, $8, $9)
     on conflict (tenant_id, slot_id, on_date) do update
       set status = 'open', closes_at = now() + ($5 || ' minutes')::interval,
           opened_at = case when attendance_checkins.status = 'open' and attendance_checkins.closes_at > now() then attendance_checkins.opened_at else now() end,
           late_after_minutes = excluded.late_after_minutes,
           geo_lat = excluded.geo_lat, geo_lng = excluded.geo_lng, geo_radius_m = excluded.geo_radius_m
     returning *`,
    [slotId, date, crypto.randomBytes(32).toString('hex'), actor.id, String(minutes), lateAfter, ...geo],
  );
  await audit(actor, 'attendance.checkin.open', 'timetable_slot', slotId, { date, minutes, location: geo[0] != null });
  return describe(row, lecture);
}

export async function state(actor, slotId) {
  await assertEnabled();
  const { lecture, date } = await lectureOrThrow(slotId, actor);
  const { rows: [row] } = await q('select * from attendance_checkins where slot_id = $1 and on_date = $2', [slotId, date]);
  if (!row) return { open: false, slotId, date, checkedIn: 0, recent: [], roster: (await q("select count(*)::int as n from students where course_id = $1 and status = 'Active'", [lecture.courseId])).rows[0].n };
  return describe(row, lecture);
}

export async function close(actor, slotId) {
  await assertEnabled();
  const { lecture, date } = await lectureOrThrow(slotId, actor);
  const perm = permission(actor, lecture, date);
  if (!perm.ok) throw err(403, perm.reason);
  const { rows: [row] } = await q("update attendance_checkins set status = 'closed' where slot_id = $1 and on_date = $2 returning *", [slotId, date]);
  if (!row) throw err(404, 'Check-in was not opened for this lecture.');
  await audit(actor, 'attendance.checkin.close', 'timetable_slot', slotId, { date });
  return describe(row, lecture);
}

/* ================================================================== student */

async function studentRow(studentId) {
  const { rows: [s] } = await q('select id, course_id, status from students where id = $1', [studentId]);
  if (!s) throw err(404, 'Student not found.');
  return s;
}

/** Today's lectures for the student's class, and whether check-in is open and whether they are already in. */
export async function todayFor(studentId) {
  await assertEnabled();
  const s = await studentRow(studentId);
  const date = today();
  const { rows: holiday } = await q("select 1 from events where type = 'holiday' and start_date <= $1 and end_date >= $1 limit 1", [date]);
  if (holiday.length) return { date, lectures: [] };
  const { rows } = await q(
    `select t.id as "slotId", t.subject, t.start_time as start, t.end_time as "end", t.location, t.mode, e.name as "facultyName",
            (k.id is not null and k.status = 'open' and k.closes_at > now()) as "checkinOpen",
            (k.id is not null and k.status = 'open' and k.closes_at > now() and k.geo_lat is not null) as "needsLocation",
            ar.status as "myStatus", ar.marked_via as "markedVia", a.status = 'submitted' as submitted
     from timetable_slots t
     left join reassignments r on r.slot_id = t.id and r.on_date = $2
     join employees e on e.id = coalesce(r.to_employee_id, t.employee_id)
     left join attendance_checkins k on k.slot_id = t.id and k.on_date = $2
     left join attendance_sessions a on a.slot_id = t.id and a.on_date = $2
     left join attendance_records ar on ar.session_id = a.id and ar.student_id = $3
     where t.course_id = $1 and t.weekday = $4 order by t.start_time`,
    [s.course_id, date, studentId, parseISO(date).getDay()],
  );
  return { date, lectures: rows };
}

export async function checkIn(actor, { token, deviceId, lat, lng } = {}) {
  await assertEnabled();
  const s = await studentRow(actor.studentId);
  if (s.status !== 'Active') throw err(403, 'Only active students can check in.');
  const t = parseToken(token);
  if (!t) throw err(400, 'This is not an attendance QR code. Scan the code your teacher shows in class.', 'NOT_A_CODE');
  const { rows: [k] } = await q('select * from attendance_checkins where id = $1 for update', [t.checkinId]);
  if (!k) throw err(400, 'This is not an attendance QR code. Scan the code your teacher shows in class.', 'NOT_A_CODE');
  const slotId = k.slot_id; const date = String(k.on_date instanceof Date ? toISO(k.on_date) : k.on_date).slice(0, 10);
  if (date !== today()) throw err(409, 'This check-in was for another day.', 'CHECKIN_CLOSED');
  const { lecture } = await lectureOrThrow(slotId, null);
  if (lecture.courseId !== s.course_id) throw err(404, 'This lecture is not for your class.');
  if (k.status !== 'open' || new Date(k.closes_at) <= new Date()) throw err(409, 'Check-in is not open for this lecture.', 'CHECKIN_CLOSED');
  const { rows: [sess] } = await q('select id, status from attendance_sessions where slot_id = $1 and on_date = $2 for update', [slotId, date]);
  if (sess?.status === 'submitted') throw err(409, 'Attendance for this lecture has already been submitted.');
  if (sess) {
    const { rows: [mine] } = await q('select status, marked_via as "via" from attendance_records where session_id = $1 and student_id = $2', [sess.id, s.id]);
    if (mine?.via === 'qr') return { status: mine.status, already: true, subject: lecture.subject };
    if (mine) throw err(409, 'Your attendance for this lecture is already marked by your teacher.');
  }
  const { rows: [f] } = await q('select fails from attendance_checkin_fails where checkin_id = $1 and student_id = $2', [k.id, s.id]);
  if ((f?.fails || 0) >= MAX_FAILS) throw err(429, 'Too many wrong scans. Please ask your teacher to mark you.', 'LOCKED');

  const w = windowOf();
  const fresh = t.window <= w && t.window > w - ACCEPT_WINDOWS;
  const ok = fresh && same(tokenFor(k.secret, k.id, t.window), `${PREFIX}:${t.checkinId}:${t.window}:${t.sig}`);
  if (!ok) {
    // An old photo or a made-up code. Only a signed-but-stale token is a plain "too slow"; both count as a try
    const { rows: [u] } = await q(
      `insert into attendance_checkin_fails (checkin_id, student_id, fails) values ($1, $2, 1)
       on conflict (checkin_id, student_id) do update set fails = attendance_checkin_fails.fails + 1 returning fails`, [k.id, s.id],
    );
    // The wrong attempt must be remembered, so this is returned (the controller commits it) instead of thrown, which would roll it back
    return { rejected: { status: 400, code: 'BAD_CODE', message: `This QR code has expired or is not valid. Scan the live code on the teacher's screen. ${Math.max(0, MAX_FAILS - u.fails)} tries left.` } };
  }

  // The classroom location, when the teacher asked for it
  let dist = null;
  if (k.geo_lat != null) {
    const la = Number(lat); const ln = Number(lng);
    if (!validPoint(la, ln)) throw err(400, 'Allow location for this app so we can confirm you are in the classroom, then scan again.', 'LOCATION_NEEDED');
    dist = distanceM(k.geo_lat, k.geo_lng, la, ln);
    if (dist > k.geo_radius_m) throw err(403, 'You do not seem to be in the classroom. Attendance was not marked.', 'TOO_FAR');
  }

  // One phone marking several students is not blocked (families share phones) but the teacher is told
  const device = typeof deviceId === 'string' && /^[\w-]{8,64}$/.test(deviceId) ? deviceId : null;
  let flag = null;
  if (device) {
    const { rows: shared } = await q('select student_id from attendance_checkin_scans where checkin_id = $1 and device_id = $2 and student_id <> $3', [k.id, device, s.id]);
    if (shared.length) {
      flag = 'Same phone as another student';
      await q('update attendance_checkin_scans set flag = $3 where checkin_id = $1 and device_id = $2 and flag is null', [k.id, device, flag]);
    }
  }

  const status = Date.now() > new Date(k.opened_at).getTime() + k.late_after_minutes * 60_000 ? 'late' : 'present';
  const { rows: [session] } = await q(
    `insert into attendance_sessions (slot_id, on_date, course_id, subject, start_time, end_time, taken_by, status, created_by, updated_by)
     values ($1, $2, $3, $4, $5, $6, $7, 'draft', $8, $8)
     on conflict (tenant_id, slot_id, on_date) do update set updated_at = now() returning id`,
    [slotId, date, lecture.courseId, lecture.subject, lecture.start, lecture.end, lecture.facultyId, actor.id],
  );
  await q(
    `insert into attendance_records (session_id, student_id, status, marked_via) values ($1, $2, $3, 'qr')
     on conflict (session_id, student_id) do nothing`, [session.id, s.id, status],
  );
  await q(
    `insert into attendance_checkin_scans (checkin_id, student_id, device_id, distance_m, flag) values ($1, $2, $3, $4, $5)
     on conflict (checkin_id, student_id) do nothing`, [k.id, s.id, device, dist, flag],
  );
  await audit(actor, 'attendance.checkin', 'attendance_session', session.id, { status, flagged: !!flag });
  return { status, already: false, subject: lecture.subject };
}

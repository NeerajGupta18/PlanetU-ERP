/**
 * QR check-in for attendance. A teacher opens check-in for today's lecture; the screen shows a QR code and a 6-digit
 * code that change every 30 seconds. A student scans it (their phone's camera opens the check-in page) or types the
 * code and is marked present, or late after the first minutes. It writes the same attendance records the teacher's
 * sheet uses, so the teacher still reviews the sheet and submits it.
 *
 * The code comes from a secret that never leaves the server: HMAC(secret, 30-second window). The current and the
 * previous window are accepted, so a photo or a forwarded message goes stale within a minute. Wrong codes are counted
 * per student, so a 6-digit code cannot be guessed. It proves a student had the code, not where they were.
 */
import crypto from 'node:crypto';
import { isUuid, q } from '../db/pool.js';
import { audit } from '../db/audit.js';
import { HttpError } from '../middleware/error.js';
import { parseISO } from '../utils/dates.js';
import { findLecture, hideFromOthers, permission, today } from './attendance.service.js';

export const WINDOW_SECONDS = 30;
export const MAX_FAILS = 5;
const DEFAULT_MINUTES = 30;
const err = (status, message, code) => Object.assign(new HttpError(status, message), code ? { code } : {});

export const windowOf = (ms = Date.now()) => Math.floor(ms / 1000 / WINDOW_SECONDS);
export function codeFor(secret, checkinId, window) {
  const h = crypto.createHmac('sha256', secret).update(`${checkinId}:${window}`).digest();
  return String(h.readUInt32BE(0) % 1_000_000).padStart(6, '0');
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
  const out = { ...base, checkedIn: c.n, roster, recent };
  if (open) {
    const w = windowOf(now);
    out.code = codeFor(row.secret, row.id, w);
    out.secondsLeft = Math.max(1, (w + 1) * WINDOW_SECONDS - Math.floor(now / 1000));
    out.windowSeconds = WINDOW_SECONDS;
  }
  return out;
}

export async function open(actor, slotId, body = {}) {
  const { lecture, date } = await lectureOrThrow(slotId, actor);
  const perm = permission(actor, lecture, date);
  if (!perm.ok) throw err(403, perm.reason);
  const { rows: [sess] } = await q('select status from attendance_sessions where slot_id = $1 and on_date = $2', [slotId, date]);
  if (sess?.status === 'submitted') throw err(409, 'Attendance for this lecture is already submitted. Use the sheet to correct it.');
  const minutes = Math.min(120, Math.max(5, Number(body.minutes) || DEFAULT_MINUTES));
  const lateAfter = Math.min(120, Math.max(1, Number(body.lateAfterMinutes) || 10));
  const { rows: [row] } = await q(
    `insert into attendance_checkins (slot_id, on_date, secret, opened_by, closes_at, late_after_minutes)
     values ($1, $2, $3, $4, now() + ($5 || ' minutes')::interval, $6)
     on conflict (tenant_id, slot_id, on_date) do update
       set status = 'open', closes_at = now() + ($5 || ' minutes')::interval,
           opened_at = case when attendance_checkins.status = 'open' and attendance_checkins.closes_at > now() then attendance_checkins.opened_at else now() end,
           late_after_minutes = excluded.late_after_minutes
     returning *`,
    [slotId, date, crypto.randomBytes(32).toString('hex'), actor.id, String(minutes), lateAfter],
  );
  await audit(actor, 'attendance.checkin.open', 'timetable_slot', slotId, { date, minutes });
  return describe(row, lecture);
}

export async function state(actor, slotId) {
  const { lecture, date } = await lectureOrThrow(slotId, actor);
  const { rows: [row] } = await q('select * from attendance_checkins where slot_id = $1 and on_date = $2', [slotId, date]);
  if (!row) return { open: false, slotId, date, checkedIn: 0, recent: [], roster: (await q("select count(*)::int as n from students where course_id = $1 and status = 'Active'", [lecture.courseId])).rows[0].n };
  return describe(row, lecture);
}

export async function close(actor, slotId) {
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
  const s = await studentRow(studentId);
  const date = today();
  const { rows: holiday } = await q("select 1 from events where type = 'holiday' and start_date <= $1 and end_date >= $1 limit 1", [date]);
  if (holiday.length) return { date, lectures: [] };
  const { rows } = await q(
    `select t.id as "slotId", t.subject, t.start_time as start, t.end_time as "end", t.location, t.mode, e.name as "facultyName",
            (k.id is not null and k.status = 'open' and k.closes_at > now()) as "checkinOpen",
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

export async function checkIn(actor, { slotId, code } = {}) {
  const s = await studentRow(actor.studentId);
  if (s.status !== 'Active') throw err(403, 'Only active students can check in.');
  const entered = String(code ?? '').replace(/\D/g, '');
  if (entered.length !== 6) throw err(400, 'Enter the 6-digit code shown on the teacher\'s screen.');
  const { lecture, date } = await lectureOrThrow(slotId, null);
  if (lecture.courseId !== s.course_id) throw err(404, 'This lecture is not for your class.');
  const { rows: [k] } = await q('select * from attendance_checkins where slot_id = $1 and on_date = $2 for update', [slotId, date]);
  if (!k || k.status !== 'open' || new Date(k.closes_at) <= new Date()) throw err(409, 'Check-in is not open for this lecture.', 'CHECKIN_CLOSED');
  const { rows: [sess] } = await q('select id, status from attendance_sessions where slot_id = $1 and on_date = $2 for update', [slotId, date]);
  if (sess?.status === 'submitted') throw err(409, 'Attendance for this lecture has already been submitted.');
  if (sess) {
    const { rows: [mine] } = await q('select status, marked_via as "via" from attendance_records where session_id = $1 and student_id = $2', [sess.id, s.id]);
    if (mine?.via === 'qr') return { status: mine.status, already: true };
    if (mine) throw err(409, 'Your attendance for this lecture is already marked by your teacher.');
  }
  const { rows: [f] } = await q('select fails from attendance_checkin_fails where checkin_id = $1 and student_id = $2', [k.id, s.id]);
  if ((f?.fails || 0) >= MAX_FAILS) throw err(429, 'Too many wrong codes. Please ask your teacher to mark you.', 'LOCKED');

  const w = windowOf();
  const ok = [w, w - 1].some((x) => same(codeFor(k.secret, k.id, x), entered));
  if (!ok) {
    const { rows: [u] } = await q(
      `insert into attendance_checkin_fails (checkin_id, student_id, fails) values ($1, $2, 1)
       on conflict (checkin_id, student_id) do update set fails = attendance_checkin_fails.fails + 1 returning fails`, [k.id, s.id],
    );
    // The wrong attempt must be remembered, so this is returned (the controller commits it) instead of thrown, which would roll it back
    return { rejected: { status: 400, code: 'BAD_CODE', message: `That code is not right or has expired. ${Math.max(0, MAX_FAILS - u.fails)} tries left.` } };
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
  await audit(actor, 'attendance.checkin', 'attendance_session', session.id, { status });
  return { status, already: false };
}

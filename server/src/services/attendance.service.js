/**
 * Attendance, built on the Timetable.
 *
 * A "lecture" is one dated occurrence of a weekly timetable slot - the same (slot, date) pair the
 * Timetable and Lecture Reassignment modules use. Who may mark it is decided by the same rule the
 * timetable displays: the employee the lecture was reassigned to for that date, else the slot's
 * own employee. Holidays have no lectures.
 *
 * Only SUBMITTED sessions count towards percentages; a draft is faculty's work in progress.
 * Present and Late both count as attended.
 */
import { q } from '../db/pool.js';
import { HttpError } from '../middleware/error.js';
import { audit } from '../db/audit.js';
import { isISO, parseISO, toISO } from '../utils/dates.js';
import { csvCell } from '../utils/csv.js';

export const STATUSES = ['present', 'absent', 'late'];
export const DEFAULT_THRESHOLD = 75;

const ATTENDED = "('present', 'late')";
export const pct = (a, t) => (t ? Math.round((a / t) * 1000) / 10 : 0);
export const today = () => toISO(new Date());

/* ---------------------------------------------------------------- lectures */

const isHoliday = async (date) => (
  (await q("select 1 from events where type = 'holiday' and start_date <= $1 and end_date >= $1 limit 1", [date])).rowCount > 0
);

/**
 * One dated lecture with who is effectively teaching it, or null if that slot does not run on that
 * date (wrong weekday, holiday, unknown slot).
 */
export async function findLecture(slotId, date) {
  const { rows: [l] } = await q(
    `select s.id as "slotId", s.course_id as "courseId", c.name as course, s.subject, s.weekday,
            s.start_time as start, s.end_time as "end", s.mode, s.location,
            s.employee_id as "ownerId", coalesce(r.to_employee_id, s.employee_id) as "facultyId",
            (r.to_employee_id is not null) as reassigned, e.name as "facultyName"
     from timetable_slots s
     join courses c on c.id = s.course_id
     left join reassignments r on r.slot_id = s.id and r.on_date = $2
     join employees e on e.id = coalesce(r.to_employee_id, s.employee_id)
     where s.id = $1`,
    [slotId, date],
  );
  if (!l || parseISO(date).getDay() !== l.weekday || await isHoliday(date)) return null;
  return l;
}

const LECTURE_SQL = `
  select s.id as "slotId", s.course_id as "courseId", c.name as course, s.subject, s.mode, s.location,
         s.start_time as start, s.end_time as "end",
         coalesce(r.to_employee_id, s.employee_id) as "facultyId", e.name as "facultyName",
         (r.to_employee_id is not null) as reassigned,
         a.id as "sessionId", coalesce(a.status, 'none') as "sessionStatus",
         (select count(*)::int from students st where st.course_id = s.course_id and st.status = 'Active') as roster,
         (select count(*)::int from attendance_records ar where ar.session_id = a.id) as marked,
         (select count(*)::int from attendance_records ar where ar.session_id = a.id and ar.status in ${ATTENDED}) as attended
  from timetable_slots s
  join courses c on c.id = s.course_id
  left join reassignments r on r.slot_id = s.id and r.on_date = $1
  join employees e on e.id = coalesce(r.to_employee_id, s.employee_id)
  left join attendance_sessions a on a.slot_id = s.id and a.on_date = $1`;

/** Faculty home: the lectures this employee is taking on `date`, with how far their marking is. */
export async function lecturesForEmployee(employeeId, date) {
  if (await isHoliday(date)) return { date, holiday: true, lectures: [] };
  const { rows } = await q(
    `${LECTURE_SQL} where s.weekday = $2 and coalesce(r.to_employee_id, s.employee_id) = $3
     order by s.start_time, c.name`,
    [date, parseISO(date).getDay(), employeeId],
  );
  return { date, holiday: false, lectures: rows };
}

/** Admin overview: every lecture on `date` (optionally one course) and whether it has been marked. */
export async function daySheet(date, courseId) {
  if (await isHoliday(date)) return { date, holiday: true, lectures: [] };
  const { rows } = await q(
    `${LECTURE_SQL} where s.weekday = $2 ${courseId ? 'and s.course_id = $3' : ''}
     order by s.start_time, c.name`,
    courseId ? [date, parseISO(date).getDay(), courseId] : [date, parseISO(date).getDay()],
  );
  return { date, holiday: false, lectures: rows };
}

/* ------------------------------------------------------------ marking sheet */

/**
 * Whether `actor` may change this lecture's attendance right now. Admins can correct any past or
 * present date; an employee only their own lecture, on the day itself.
 */
function permission(actor, lecture, date) {
  if (date > today()) return { ok: false, reason: 'Attendance cannot be marked for a future date.' };
  if (actor.role === 'admin') return { ok: true };
  if (actor.employeeId !== lecture.facultyId) {
    return { ok: false, reason: lecture.reassigned
      ? `This lecture was reassigned to ${lecture.facultyName} for ${date}.`
      : 'This lecture is not assigned to you.' };
  }
  if (date !== today()) return { ok: false, reason: 'Attendance can only be marked on the day of the lecture. Ask an admin to correct earlier dates.' };
  return { ok: true };
}

/** An employee who neither teaches the lecture that day nor owns the slot sees it as nonexistent. */
function hideFromOthers(actor, lecture) {
  if (actor.role === 'employee' && actor.employeeId !== lecture.facultyId && actor.employeeId !== lecture.ownerId) {
    throw new HttpError(404, 'No such lecture on that date.');
  }
}

function validateRequest(slotId, date) {
  if (!isISO(date)) throw new HttpError(400, 'Date must look like YYYY-MM-DD.');
  if (!slotId) throw new HttpError(400, 'Choose a lecture.');
}

async function loadSheet(lecture, date, actor) {
  const { rows: [session] } = await q(
    `select id, status, submitted_at as "submittedAt", updated_at as "updatedAt"
     from attendance_sessions where slot_id = $1 and on_date = $2`,
    [lecture.slotId, date],
  );
  // The roster is the course's active students, plus anyone already marked (e.g. since deactivated)
  const { rows: students } = await q(
    `select st.id, st.student_code as code, st.roll_no as "rollNo", st.name, ar.status
     from students st
     left join attendance_records ar on ar.student_id = st.id and ar.session_id = $2
     where st.course_id = $1 and (st.status = 'Active' or ar.status is not null)
     order by nullif(regexp_replace(st.roll_no, '\\D', '', 'g'), '')::numeric nulls last, st.roll_no, st.name`,
    [lecture.courseId, session?.id ?? null],
  );
  const perm = permission(actor, lecture, date);
  return {
    lecture: { ...lecture, date },
    session: session || null,
    students,
    editable: perm.ok,
    reason: perm.ok ? null : perm.reason,
  };
}

export async function getSheet({ slotId, date, actor }) {
  validateRequest(slotId, date);
  const lecture = await findLecture(slotId, date);
  if (!lecture) throw new HttpError(404, 'No such lecture on that date.');
  hideFromOthers(actor, lecture);
  return loadSheet(lecture, date, actor);
}

export async function saveSheet({ slotId, date, marks, submit, actor }) {
  validateRequest(slotId, date);
  const lecture = await findLecture(slotId, date);
  if (!lecture) throw new HttpError(404, 'No such lecture on that date.');
  hideFromOthers(actor, lecture);
  const perm = permission(actor, lecture, date);
  if (!perm.ok) throw new HttpError(403, perm.reason);

  if (!Array.isArray(marks)) throw new HttpError(400, 'Send the marks as a list of { studentId, status }.');
  const seen = new Set();
  for (const m of marks) {
    if (!m || typeof m.studentId !== 'string' || !STATUSES.includes(m.status)) {
      throw new HttpError(400, `Each mark needs a studentId and a status of: ${STATUSES.join(', ')}.`);
    }
    if (seen.has(m.studentId)) throw new HttpError(400, 'A student appears more than once.');
    seen.add(m.studentId);
  }

  // Marks may only be for students of this lecture's course (RLS already keeps them inside the tenant)
  const { rows: roster } = await q(
    "select id from students where course_id = $1 and status = 'Active'", [lecture.courseId],
  );
  const rosterIds = new Set(roster.map((r) => r.id));
  const { rows: existingSession } = await q(
    'select id, status from attendance_sessions where slot_id = $1 and on_date = $2 for update', [slotId, date],
  );
  const markedBefore = existingSession[0]
    ? new Set((await q('select student_id from attendance_records where session_id = $1', [existingSession[0].id])).rows.map((r) => r.student_id))
    : new Set();
  for (const id of seen) {
    if (!rosterIds.has(id) && !markedBefore.has(id)) throw new HttpError(400, 'One or more students are not in this class.');
  }

  const complete = [...rosterIds].every((id) => seen.has(id) || markedBefore.has(id));
  if (submit && !complete) {
    const missing = [...rosterIds].filter((id) => !seen.has(id) && !markedBefore.has(id)).length;
    throw new HttpError(400, `Mark every student before submitting - ${missing} still unmarked.`);
  }
  if (!marks.length && !submit && !existingSession[0]) throw new HttpError(400, 'Nothing to save yet.');

  const wasSubmitted = existingSession[0]?.status === 'submitted';
  const status = submit || wasSubmitted ? 'submitted' : 'draft';
  const { rows: [s] } = await q(
    `insert into attendance_sessions
       (slot_id, on_date, course_id, subject, start_time, end_time, taken_by, status, submitted_at, created_by, updated_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, case when $8::text = 'submitted' then now() end, $9, $9)
     on conflict (tenant_id, slot_id, on_date) do update
       set status = excluded.status, updated_by = excluded.updated_by, updated_at = now(),
           submitted_at = case when excluded.status = 'submitted' then coalesce(attendance_sessions.submitted_at, now()) end
     returning id`,
    [slotId, date, lecture.courseId, lecture.subject, lecture.start, lecture.end, lecture.facultyId, status, actor.id],
  );

  if (marks.length) {
    await q(
      `insert into attendance_records (session_id, student_id, status)
       select $1, x.student_id, x.status from unnest($2::uuid[], $3::text[]) as x(student_id, status)
       on conflict (session_id, student_id) do update
         set status = excluded.status, updated_at = now() where attendance_records.status <> excluded.status`,
      [s.id, marks.map((m) => m.studentId), marks.map((m) => m.status)],
    );
  }

  const action = !existingSession[0] || (!wasSubmitted && submit) ? (submit ? 'attendance.submit' : 'attendance.draft') : 'attendance.edit';
  await audit(actor, action, 'attendance_session', s.id, {
    slotId, date, marks: marks.length, by: actor.role,
  });
  return loadSheet(lecture, date, actor);
}

/* ------------------------------------------------------------------ student */

/** Classes needed in a row to reach `t`%, or how many can be missed while staying at/above it. */
function guidance(att, tot, t) {
  if (!tot) return { needToReach: 0, canMiss: 0 };
  if (pct(att, tot) >= t) return { needToReach: 0, canMiss: Math.max(0, Math.floor((100 * att - t * tot) / t)) };
  return { needToReach: t >= 100 ? null : Math.max(0, Math.ceil((t * tot - 100 * att) / (100 - t))), canMiss: 0 };
}

/** Per-subject totals from submitted sessions only. */
export async function studentSubjects(studentId, threshold = DEFAULT_THRESHOLD) {
  const { rows } = await q(
    `select a.subject, count(*) filter (where r.status in ${ATTENDED})::int as attended, count(*)::int as total
     from attendance_records r join attendance_sessions a on a.id = r.session_id
     where r.student_id = $1 and a.status = 'submitted'
     group by a.subject order by a.subject`,
    [studentId],
  );
  return rows.map((r) => ({ ...r, pct: pct(r.attended, r.total), ...guidance(r.attended, r.total, threshold) }));
}

export async function studentRecent(studentId, limit = 15) {
  const { rows } = await q(
    `select a.on_date as date, a.subject, a.start_time as start, a.end_time as "end", r.status
     from attendance_records r join attendance_sessions a on a.id = r.session_id
     where r.student_id = $1 and a.status = 'submitted'
     order by a.on_date desc, a.start_time desc limit $2`,
    [studentId, limit],
  );
  return rows;
}

/** Subjects + overall for the student pages. `legacy` (old static figures) is used only until real marking starts. */
export async function studentOverview(studentId, legacy = [], threshold = DEFAULT_THRESHOLD) {
  let subjects = await studentSubjects(studentId, threshold);
  const live = subjects.length > 0;
  if (!live) {
    subjects = (legacy || []).map((a) => ({ ...a, pct: pct(a.attended, a.total), ...guidance(a.attended, a.total, threshold) }));
  }
  const totals = subjects.reduce((acc, a) => ({ att: acc.att + a.attended, tot: acc.tot + a.total }), { att: 0, tot: 0 });
  return { subjects, overall: pct(totals.att, totals.tot), attended: totals.att, total: totals.tot, threshold, live };
}

/* -------------------------------------------------------------------- admin */

/** Student x subject attendance over submitted sessions, optionally limited to a course / dates. */
export async function report({ courseId, subject, from, to, below }) {
  const params = [];
  const where = ["a.status = 'submitted'"];
  const add = (sql, v) => { params.push(v); where.push(sql.replace('?', `$${params.length}`)); };
  if (courseId) add('a.course_id = ?', courseId);
  if (subject) add('a.subject = ?', subject);
  if (from) add('a.on_date >= ?', from);
  if (to) add('a.on_date <= ?', to);

  const { rows } = await q(
    `select st.id as "studentId", st.student_code as code, st.roll_no as "rollNo", st.name, c.name as course, a.subject,
            count(*) filter (where r.status in ${ATTENDED})::int as attended, count(*)::int as total
     from attendance_records r
     join attendance_sessions a on a.id = r.session_id
     join students st on st.id = r.student_id
     left join courses c on c.id = st.course_id
     where ${where.join(' and ')}
     group by st.id, st.student_code, st.roll_no, st.name, c.name, a.subject
     order by st.roll_no, st.name, a.subject`,
    params,
  );

  const byStudent = new Map();
  for (const r of rows) {
    const e = byStudent.get(r.studentId) || {
      studentId: r.studentId, code: r.code, rollNo: r.rollNo, name: r.name, course: r.course, attended: 0, total: 0, subjects: [],
    };
    e.attended += r.attended; e.total += r.total;
    e.subjects.push({ subject: r.subject, attended: r.attended, total: r.total, pct: pct(r.attended, r.total) });
    byStudent.set(r.studentId, e);
  }
  let students = [...byStudent.values()].map((e) => ({ ...e, pct: pct(e.attended, e.total) }));
  const limit = Number(below);
  if (Number.isFinite(limit) && below !== undefined && below !== '') students = students.filter((s) => s.pct < limit);

  const { rows: [sessions] } = await q(
    `select count(*)::int as n from attendance_sessions a where ${where.join(' and ')}`, params,
  );
  return { students, sessions: sessions.n, filters: { courseId: courseId || null, subject: subject || null, from: from || null, to: to || null } };
}

/** CSV with one row per student per subject. */
export async function reportCsv(filters) {
  const { students } = await report(filters);
  const lines = [['Roll no', 'Student ID', 'Name', 'Course', 'Subject', 'Attended', 'Total', 'Percent'].join(',')];
  for (const s of students) {
    for (const sub of s.subjects) {
      lines.push([s.rollNo, s.code, s.name, s.course, sub.subject, sub.attended, sub.total, sub.pct].map(csvCell).join(','));
    }
  }
  return `${lines.join('\r\n')}\r\n`;
}

import { db } from '../db/store.js';
import { HttpError } from '../middleware/error.js';
import { buildTimetable } from '../services/timetable.service.js';
import { addDays, daysBetween, isISO, pad, parseISO, toISO } from '../utils/dates.js';

const MAX_RANGE_DAYS = 93;

function currentStudent(req) {
  const s = db().students.find((x) => x.id === req.user.profileId);
  if (!s) throw new HttpError(404, 'Student record not found.');
  return s;
}

const courseOf = (student) => db().courses.find((c) => c.id === student.courseId);
const visibleEvents = () => db().events.filter((e) => e.audience === 'all' || e.audience === 'student');
const pct = (a, t) => (t ? Math.round((a / t) * 1000) / 10 : 0);

/* ---------- Dashboard ---------- */
export function dashboard(req, res) {
  const student = currentStudent(req);
  const course = courseOf(student);
  const today = toISO(new Date());

  const attendance = student.attendance.map((a) => ({ ...a, pct: pct(a.attended, a.total) }));
  const totals = attendance.reduce((acc, a) => ({ att: acc.att + a.attended, tot: acc.tot + a.total }), { att: 0, tot: 0 });

  const todaySchedule = buildTimetable({ courseId: student.courseId, start: today, end: today }).items;
  const upcomingEvents = visibleEvents()
    .filter((e) => e.end >= today && e.start <= toISO(addDays(new Date(), 45)))
    .sort((a, b) => a.start.localeCompare(b.start));
  const notices = [...db().notices].sort((a, b) => b.date.localeCompare(a.date));

  res.json({
    student: {
      name: student.name, rollNo: student.rollNo, course: course.name, semester: student.semester, section: student.section,
    },
    stats: {
      attendance: pct(totals.att, totals.tot),
      lecturesToday: todaySchedule.filter((i) => i.type === 'lecture').length,
      upcomingEvents: upcomingEvents.filter((e) => e.start <= toISO(addDays(new Date(), 7))).length,
      notices: notices.length,
    },
    today: todaySchedule,
    upcomingEvents: upcomingEvents.slice(0, 5),
    attendance,
    notices: notices.slice(0, 4),
  });
}

/* ---------- Profile ---------- */
export function profile(req, res) {
  const s = currentStudent(req);
  const course = courseOf(s);
  const { attendance, ...rest } = s;
  res.json({ student: { ...rest, course: course.name, courseFullName: course.fullName, department: course.department } });
}

/* ---------- Institute ---------- */
// Students only see the public profile - internal records (stakeholders,
// authorized persons' PAN/Aadhaar, documents, bank beneficiaries, stamp/
// signature) are Admin-only and are stripped out here.
export function institute(req, res) {
  const { authorizedPersons, stakeholders, documents, beneficiaries, stamp, ...publicInfo } = db().institute;
  res.json({ institute: publicInfo });
}

/* ---------- Calendar ---------- */
export function calendar(req, res) {
  const year = Number(req.query.year);
  const month = Number(req.query.month);
  if (!Number.isInteger(year) || year < 2000 || year > 2100 || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new HttpError(400, 'Provide a valid year and month (1-12).');
  }
  const first = `${year}-${pad(month)}-01`;
  const last = toISO(new Date(year, month, 0));
  const events = visibleEvents()
    .filter((e) => e.start <= last && e.end >= first)
    .sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title))
    .map(({ rel, audience, ...e }) => e);
  res.json({ year, month, events });
}

/* ---------- Timetable ---------- */
export function timetable(req, res) {
  const student = currentStudent(req);
  const today = new Date();
  const start = req.query.start || toISO(today);
  const end = req.query.end || toISO(addDays(today, 6));

  if (!isISO(start) || !isISO(end)) throw new HttpError(400, 'Dates must look like YYYY-MM-DD.');
  if (end < start) throw new HttpError(400, 'End date cannot be before the start date.');
  if (daysBetween(start, end) > MAX_RANGE_DAYS) throw new HttpError(400, `Choose a range of ${MAX_RANGE_DAYS} days or fewer.`);

  const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
  res.json(buildTimetable({
    courseId: student.courseId, start, end,
    department: str(req.query.department), employeeId: str(req.query.employeeId),
    subject: str(req.query.subject), priority: str(req.query.priority),
  }));
}

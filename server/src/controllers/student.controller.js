import { q } from '../db/pool.js';
import { HttpError } from '../middleware/error.js';
import { getInstitute, loadEvents } from '../db/repo.js';
import { feed as noticeFeed } from '../services/notices.service.js';
import { issueIdCard } from './students.controller.js';
import { buildTimetable } from '../services/timetable.service.js';
import { guidance, studentOverview } from '../services/attendance.service.js';
import { listMine as myAssignments } from '../services/assignments.service.js';
import { studentResults } from '../services/exams.service.js';
import { addDays, daysBetween, isISO, pad, toISO } from '../utils/dates.js';

const MAX_RANGE_DAYS = 93;
const STUDENT_AUDIENCES = ['all', 'student'];

// Same object shape the old JSON store used. `id` is the student's business ID (login ID / PRN).
async function currentStudent(req) {
  const { rows: [s] } = await q(
    `select s.*, c.name as course_name, c.full_name as course_full_name, d.name as department_name
     from students s
     left join courses c on c.id = s.course_id
     left join departments d on d.id = c.department_id
     where s.id = $1`,
    [req.user.studentId],
  );
  if (!s) throw new HttpError(404, 'Student record not found.');
  return {
    id: s.student_code, rollNo: s.roll_no, enrollmentNo: s.enrollment_no, name: s.name, email: s.email, phone: s.phone,
    dob: s.dob, gender: s.gender, bloodGroup: s.blood_group, nationality: s.nationality, courseId: s.course_id,
    semester: s.semester, section: s.section, batch: s.batch, admissionDate: s.admission_date, status: s.status,
    address: s.address, guardian: s.guardian, attendance: s.attendance,
    course: s.course_name, courseFullName: s.course_full_name, department: s.department_name,
  };
}

/* ---------- Dashboard ---------- */
export async function dashboard(req, res) {
  const student = await currentStudent(req);
  const today = toISO(new Date());

  // Real marked attendance; the old static figures are shown only until faculty start marking
  const overview = await studentOverview(req.user.studentId, student.attendance);

  const todaySchedule = (await buildTimetable({ courseId: student.courseId, start: today, end: today })).items;
  const upcomingEvents = await loadEvents({ audiences: STUDENT_AUDIENCES, from: today, to: toISO(addDays(new Date(), 45)) });
  const notices = req.tenant.modules.includes('notices') ? await noticeFeed(req.user, { limit: 4 }) : { notices: [], unread: 0 };

  // Money still owed, and the next thing falling due (the page shows a Pay button when this is set)
  const { rows: openItems } = await q(
    `select i.label, i.due_date as "dueDate",
            (i.amount - coalesce((select sum(a.amount) from payment_allocations a where a.fee_item_id = i.id), 0))::float8 as balance
     from student_fee_items i where i.student_id = $1 and i.status in ('unpaid', 'partial')
     order by i.due_date nulls last, i.created_at`,
    [req.user.studentId],
  );
  const outstanding = Math.round(openItems.reduce((a, i) => a + i.balance, 0) * 100) / 100;
  const { rows: [{ paid: paidTotal }] } = await q('select coalesce(sum(amount), 0)::float8 as paid from payments where student_id = $1', [req.user.studentId]);
  const next = openItems[0] || null;

  // Most recent published exam, for the "latest result" card
  const results = await studentResults(req.user.studentId);
  const latest = results.exams[0] || null;

  // Assignments still to hand in that fall due in the next 7 days
  const weekAhead = addDays(new Date(), 7).toISOString();
  const dueThisWeek = req.tenant.modules.includes('assignments')
    ? (await myAssignments(req.user.studentId)).assignments.filter((a) => ['pending', 'returned'].includes(a.state) && a.dueAt && new Date(a.dueAt).toISOString() <= weekAhead)
    : null;
  const assignmentsDue = dueThisWeek && dueThisWeek.length;
  const coursework = dueThisWeek && dueThisWeek.slice(0, 4).map((a) => ({ id: a.id, title: a.title, subject: a.subject, dueAt: a.dueAt, state: a.state }));

  // The next exam: a scheduled exam for this class, otherwise an exam on the calendar
  let nextExam = null;
  if (req.tenant.modules.includes('exams')) {
    const { rows: [x] } = await q(
      `select name, start_date::text as date from exams where course_id = $1 and semester = $2 and status = 'draft' and start_date >= $3::date
       order by start_date limit 1`, [student.courseId, student.semester, today],
    );
    const ev = upcomingEvents.find((e) => e.type === 'exam');
    nextExam = x ? { name: x.name, date: x.date } : ev ? { name: ev.title, date: ev.start } : null;
  }

  res.json({
    fees: { outstanding, paid: paidTotal, next: next && { label: next.label, dueDate: next.dueDate, balance: next.balance } },
    coursework,
    generatedAt: new Date().toISOString(),
    attendanceGuide: { ...guidance(overview.attended, overview.total, overview.threshold), attended: overview.attended, total: overview.total },
    assignmentsDue,
    nextExam,
    latestResult: latest && { id: latest.id, name: latest.name, semester: latest.semester, gpa: latest.gpa, pct: latest.pct, result: latest.result, cgpa: results.cgpa, trend: [...results.exams].reverse().filter((e) => e.pct !== null && e.pct !== undefined).map((e) => ({ name: e.name, pct: e.pct })) },
    student: {
      name: student.name, rollNo: student.rollNo, course: student.course, semester: student.semester, section: student.section,
    },
    stats: {
      attendance: overview.overall,
      lecturesToday: todaySchedule.filter((i) => i.type === 'lecture').length,
      upcomingEvents: upcomingEvents.filter((e) => e.start <= toISO(addDays(new Date(), 7))).length,
      notices: notices.unread,
    },
    today: todaySchedule,
    upcomingEvents: upcomingEvents.slice(0, 5),
    attendance: overview.subjects,
    attendanceThreshold: overview.threshold,
    notices: notices.notices,
  });
}

/* ---------- Profile ---------- */
export async function profile(req, res) {
  const { attendance, courseId, ...rest } = await currentStudent(req);
  res.json({ student: { ...rest, courseId } });
}

/* ---------- Institute ---------- */
// Students only see the public profile - internal records (stakeholders,
// authorized persons' PAN/Aadhaar, documents, bank beneficiaries, stamp/
// signature) are Admin-only and are stripped out here.
export async function institute(req, res) {
  const { authorizedPersons, stakeholders, documents, beneficiaries, stamp, ...publicInfo } = await getInstitute();
  res.json({ institute: publicInfo });
}

/* ---------- Calendar ---------- */
export async function calendar(req, res) {
  const year = Number(req.query.year);
  const month = Number(req.query.month);
  if (!Number.isInteger(year) || year < 2000 || year > 2100 || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new HttpError(400, 'Provide a valid year and month (1-12).');
  }
  const first = `${year}-${pad(month)}-01`;
  const last = toISO(new Date(year, month, 0));
  const events = (await loadEvents({ audiences: STUDENT_AUDIENCES, from: first, to: last }))
    .map(({ audience, ...e }) => e);
  res.json({ year, month, events });
}

/* ---------- Timetable ---------- */
export async function timetable(req, res) {
  const student = await currentStudent(req);
  const today = new Date();
  const start = req.query.start || toISO(today);
  const end = req.query.end || toISO(addDays(today, 6));

  if (!isISO(start) || !isISO(end)) throw new HttpError(400, 'Dates must look like YYYY-MM-DD.');
  if (end < start) throw new HttpError(400, 'End date cannot be before the start date.');
  if (daysBetween(start, end) > MAX_RANGE_DAYS) throw new HttpError(400, `Choose a range of ${MAX_RANGE_DAYS} days or fewer.`);

  const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
  res.json(await buildTimetable({
    courseId: student.courseId, start, end,
    department: str(req.query.department), employeeId: str(req.query.employeeId),
    subject: str(req.query.subject), priority: str(req.query.priority),
  }));
}

/* ---------- ID card ---------- */
export const idCard = (req, res) => issueIdCard(res, req.tenant, req.user.studentId, req);

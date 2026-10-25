/**
 * "My day": what a parent (for the child they picked) or a student sees first. Today's classes, each with whether
 * the child was marked present, absent or late; fees due; attendance; the latest result; new notices; and the one
 * next thing to do, named after a step of the Parent and student process (config/processes.js `family`).
 */
import { q } from '../db/pool.js';
import { HttpError } from '../middleware/error.js';
import { env } from '../config/env.js';
import { feed as noticeFeed } from './notices.service.js';
import { buildTimetable } from './timetable.service.js';
import { guidance, studentOverview } from './attendance.service.js';
import { studentResults } from './exams.service.js';
import { toISO } from '../utils/dates.js';

const inr0 = (n) => `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}`;
const hhmm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

/** Each lecture today, with the child's mark once the teacher has submitted the register. */
async function todaysClasses(studentId, courseId, today, now) {
  if (!courseId) return [];
  const items = (await buildTimetable({ courseId, start: today, end: today })).items.filter((i) => i.type === 'lecture');
  const { rows } = await q(
    `select a.slot_id as "slotId", a.subject, a.start_time::text as start, r.status
     from attendance_sessions a left join attendance_records r on r.session_id = a.id and r.student_id = $1
     where a.on_date = $2::date and a.status = 'submitted'`, [studentId, today],
  );
  const bySlot = new Map(rows.filter((r) => r.slotId).map((r) => [r.slotId, r]));
  return items.map((i) => {
    const mark = bySlot.get(i.id.split('@')[0]);
    // Marked: what the teacher recorded. Not marked: still to come, going on now, or over but not submitted yet.
    const status = mark ? (mark.status || 'not_marked')
      : now < i.start ? 'upcoming' : now < i.end ? 'now' : 'not_marked';
    return {
      id: i.id, subject: i.title, start: i.start, end: i.end, location: i.location, mode: i.mode,
      teacher: i.reassignedTo || i.employee?.name || null, status,
    };
  });
}

export async function myDay(user, modules) {
  const has = (m) => modules.includes(m);
  const studentId = user.studentId;
  const { rows: [s] } = await q(
    `select s.name, s.student_code as "studentCode", s.semester, s.section, s.course_id as "courseId", s.attendance, c.name as course
     from students s left join courses c on c.id = s.course_id where s.id = $1`, [studentId],
  );
  if (!s) throw new HttpError(404, 'Student record not found. Please ask the office.');
  const now = new Date();
  const today = toISO(now);

  const classes = has('timetable') || has('attendance') ? await todaysClasses(studentId, s.courseId, today, hhmm(now)) : [];
  const marked = classes.filter((c) => ['present', 'absent', 'late'].includes(c.status));
  const absentToday = marked.filter((c) => c.status === 'absent').length;

  let attendance = null;
  if (has('attendance')) {
    const o = await studentOverview(studentId, s.attendance || []);
    attendance = { overall: o.overall, threshold: o.threshold, ...guidance(o.attended, o.total, o.threshold), attended: o.attended, total: o.total };
  }

  let fees = null;
  if (has('fees')) {
    const { rows: open } = await q(
      `select i.id, i.label, i.due_date::text as "dueDate",
              (i.amount - coalesce((select sum(a.amount) from payment_allocations a where a.fee_item_id = i.id), 0))::float8 as balance
       from student_fee_items i where i.student_id = $1 and i.status in ('unpaid', 'partial')
       order by i.due_date nulls last, i.created_at`, [studentId],
    );
    const owing = open.filter((i) => i.balance > 0);
    const outstanding = Math.round(owing.reduce((a, i) => a + i.balance, 0) * 100) / 100;
    const next = owing[0] || null;
    const { rows: [last] } = await q(
      `select id, receipt_no as "receiptNo", amount::float8 as amount, paid_at as "paidAt" from payments
       where student_id = $1 order by paid_at desc limit 1`, [studentId],
    );
    fees = {
      outstanding, payOnline: env.RAZORPAY_ENABLED,
      next: next && { label: next.label, dueDate: next.dueDate, balance: Math.round(next.balance * 100) / 100, overdue: Boolean(next.dueDate && next.dueDate < today) },
      lastPayment: last || null,
    };
  }

  let latestResult = null;
  if (has('exams')) {
    const r = (await studentResults(studentId)).exams[0];
    if (r) latestResult = { id: r.id, name: r.name, gpa: r.gpa, pct: r.pct, result: r.result };
  }

  const notices = has('notices') ? await noticeFeed(user, { limit: 3 }) : null;

  // The one next thing: fees owed first (overdue before due), then new notices, then an absence today
  let next = { step: 'today', hint: classes.length ? 'Nothing to do. You are all caught up.' : 'No classes today. You are all caught up.' };
  if (fees?.outstanding > 0) {
    next = {
      step: 'pay', action: 'pay', label: `Pay ${inr0(fees.outstanding)}`,
      hint: fees.next?.overdue ? `${fees.next.label} is overdue` : fees.next?.dueDate ? `${fees.next.label} is due` : 'Fees to pay',
    };
  } else if (notices?.unread > 0) {
    next = { step: 'notices', label: notices.unread === 1 ? 'Read the new notice' : `Read ${notices.unread} new notices`, to: '/student/notices', hint: 'New from the institute' };
  } else if (absentToday > 0) {
    next = { step: 'today', label: 'See attendance', to: '/student/attendance', hint: `Absent in ${absentToday} of ${marked.length} classes today` };
  }

  return {
    student: { name: s.name, studentCode: s.studentCode, course: s.course, semester: s.semester, section: s.section },
    date: today,
    today: { classes, marked: marked.length, absent: absentToday, late: marked.filter((c) => c.status === 'late').length },
    attendance, fees, latestResult,
    notices: notices && { unread: notices.unread, latest: notices.notices.map((n) => ({ id: n.id, title: n.title, date: n.date, read: n.read, priority: n.priority })) },
    next,
  };
}

/**
 * "To do" lists: one place that says what a student or a teacher has to do next, with the date for each thing.
 * Built from the modules the institute has switched on; nothing here is stored.
 */
import { q } from '../db/pool.js';
import { addDays, toISO } from '../utils/dates.js';
import { listMine as myAssignments, list as assignmentsFor } from './assignments.service.js';
import { myQuizzes } from './quiz.service.js';
import { DEFAULT_THRESHOLD, lecturesForEmployee, today } from './attendance.service.js';
import { employeePapers } from './exams.service.js';

const inr = (n) => `₹${Math.round(Number(n)).toLocaleString('en-IN')}`;
const RANK = { bad: 0, warn: 1, info: 2 };
const sortItems = (items) => items.sort((a, b) => (RANK[a.tone] - RANK[b.tone]) || String(a.due || '9999').localeCompare(String(b.due || '9999')));

export async function forStudent(studentId, modules = []) {
  const has = (m) => modules.includes(m);
  const items = [];
  const soon = addDays(new Date(), 3).toISOString();

  if (has('assignments')) {
    for (const a of (await myAssignments(studentId)).assignments) {
      if (a.state === 'overdue' && a.allowLate) items.push({ key: `a-${a.id}`, kind: 'assignment', tone: 'bad', title: `Hand in "${a.title}"`, detail: `${a.subject} - it was due; it will be marked late`, due: a.dueAt, link: `/student/assignments/${a.id}` });
      else if (a.state === 'returned') items.push({ key: `a-${a.id}`, kind: 'assignment', tone: 'warn', title: `Redo "${a.title}"`, detail: `${a.subject} - sent back by your teacher`, due: a.dueAt, link: `/student/assignments/${a.id}` });
      else if (a.state === 'pending') items.push({ key: `a-${a.id}`, kind: 'assignment', tone: a.dueAt < soon ? 'warn' : 'info', title: `Hand in "${a.title}"`, detail: a.subject, due: a.dueAt, link: `/student/assignments/${a.id}` });
    }
  }
  if (has('quizzes')) {
    const { quizzes } = await myQuizzes(studentId);
    for (const z of quizzes.filter((x) => ['open', 'retry', 'in_progress'].includes(x.state))) {
      items.push({ key: `q-${z.id}`, kind: 'quiz', tone: z.state === 'in_progress' || (z.closeAt && z.closeAt < soon) ? 'warn' : 'info', title: z.state === 'in_progress' ? `Finish the quiz "${z.title}"` : `Take the quiz "${z.title}"`, detail: `${z.subject} - ${z.durationMinutes} min`, due: z.closeAt, link: `/student/quizzes/${z.id}/take` });
    }
  }
  if (has('fees')) {
    const t = toISO(new Date());
    const { rows: [f] } = await q(
      `select coalesce(sum(o.bal) filter (where o.due_date < $2::date), 0)::float8 as overdue, min(o.due_date) filter (where o.due_date < $2::date)::text as "overdueSince",
              coalesce(sum(o.bal) filter (where o.due_date between $2::date and $3::date), 0)::float8 as soon, min(o.due_date) filter (where o.due_date between $2::date and $3::date)::text as "soonOn"
       from (select i.due_date, i.amount - coalesce((select sum(a.amount) from payment_allocations a where a.fee_item_id = i.id), 0) as bal
             from student_fee_items i where i.student_id = $1 and i.status in ('unpaid', 'partial')) o`,
      [studentId, t, toISO(addDays(new Date(), 14))],
    );
    if (f.overdue > 0) items.push({ key: 'fees-overdue', kind: 'fees', tone: 'bad', title: `Pay ${inr(f.overdue)} in overdue fees`, detail: 'Past the due date', due: f.overdueSince, link: '/student/fees' });
    if (f.soon > 0) items.push({ key: 'fees-soon', kind: 'fees', tone: 'warn', title: `Pay ${inr(f.soon)} in fees`, detail: 'Falls due soon', due: f.soonOn, link: '/student/fees' });
  }
  if (has('library')) {
    const { rows } = await q(
      `select i.id, b.title, i.due_date::text as due from book_issues i join books b on b.id = i.book_id
       where i.student_id = $1 and i.returned_at is null and i.due_date <= current_date + 3 order by i.due_date`, [studentId],
    );
    for (const b of rows) items.push({ key: `l-${b.id}`, kind: 'library', tone: b.due < toISO(new Date()) ? 'bad' : 'warn', title: `Return "${b.title}" to the library`, detail: b.due < toISO(new Date()) ? 'Overdue - a fine may apply' : 'Due soon', due: b.due, link: '/student/library' });
  }
  return { items: sortItems(items) };
}

export async function forEmployee(actor, modules = []) {
  const has = (m) => modules.includes(m);
  const items = [];
  if (has('attendance') && has('timetable')) {
    const { lectures = [] } = await lecturesForEmployee(actor.employeeId, today()).catch(() => ({ lectures: [] }));
    for (const l of lectures.filter((x) => x.sessionStatus !== 'submitted')) {
      items.push({ key: `att-${l.slotId}`, kind: 'attendance', tone: 'warn', title: `Mark attendance: ${l.subject}`, detail: `${l.course}, ${String(l.start).slice(0, 5)} today`, due: `${today()}T${String(l.start).slice(0, 5)}`, link: `/employee/attendance/${l.slotId}` });
    }
  }
  if (has('assignments')) {
    for (const a of (await assignmentsFor(actor, { status: 'published' })).filter((x) => x.toGrade > 0)) {
      items.push({ key: `g-${a.id}`, kind: 'assignment', tone: 'warn', title: `Grade ${a.toGrade} answer${a.toGrade === 1 ? '' : 's'}: "${a.title}"`, detail: `${a.className}, ${a.subject}`, due: a.dueAt, link: `/employee/assignments/${a.id}` });
    }
  }
  if (has('exams')) {
    for (const p of (await employeePapers(actor.employeeId)).filter((x) => x.examStatus !== 'published' && x.entered < x.roster)) {
      items.push({ key: `m-${p.id}`, kind: 'marks', tone: 'warn', title: `Enter marks: ${p.subject}`, detail: `${p.examName}, ${p.course} - ${p.entered} of ${p.roster} entered`, due: null, link: `/employee/exams/${p.id}` });
    }
  }
  let lowAttendance = [];
  if (has('attendance')) {
    const { rows } = await q(
      `with mine as (select distinct course_id, lower(trim(subject)) as subj from timetable_slots where employee_id = $1)
       select a.subject, st.id, st.name, st.student_code as code,
              count(*) filter (where r.status in ('present', 'late'))::int as attended, count(*)::int as total
       from attendance_records r join attendance_sessions a on a.id = r.session_id join students st on st.id = r.student_id
       join mine m on m.course_id = a.course_id and m.subj = lower(trim(a.subject))
       where a.status = 'submitted' and st.status = 'Active'
       group by a.subject, st.id, st.name, st.student_code
       having count(*) >= 3 and count(*) filter (where r.status in ('present', 'late')) * 100.0 / count(*) < $2
       order by count(*) filter (where r.status in ('present', 'late')) * 1.0 / count(*), st.name limit 20`,
      [actor.employeeId, DEFAULT_THRESHOLD],
    );
    lowAttendance = rows.map((r) => ({ ...r, pct: Math.round((r.attended / r.total) * 1000) / 10 }));
    if (lowAttendance.length) items.push({ key: 'low-att', kind: 'attendance', tone: 'info', title: `${lowAttendance.length} student${lowAttendance.length === 1 ? ' is' : 's are'} below ${DEFAULT_THRESHOLD}% in your subjects`, detail: lowAttendance.slice(0, 3).map((s) => `${s.name} (${s.pct}%)`).join(', '), due: null, link: '/employee/attendance' });
  }
  return { items: sortItems(items), lowAttendance, threshold: DEFAULT_THRESHOLD };
}

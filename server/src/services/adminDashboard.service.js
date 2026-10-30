/**
 * The Institute Admin dashboard: every figure comes from the database, using the same queries as the page it links
 * to (Students, Fees, Attendance, Exams, Admissions), so the two always agree. Runs inside the institute's own
 * transaction (RLS). See test/adminDashboard.test.js for the reconciliation checks.
 */
import { q } from '../db/pool.js';
import { pct } from './attendance.service.js';
import { approvalCounts } from './approvals.service.js';
import { BOARD_STAGES, board } from './admissions.service.js';
import { examResults } from './exams.service.js';
import { attendanceOn, feeFigures, feeMonths, studentsBelow } from './kpi.service.js';
import { readSetup } from './setup.service.js';
import { addDays, parseISO, toISO } from '../utils/dates.js';

const ATTENDED = "('present', 'late')";
const TEACHING_TITLE = '(professor|lecturer|teacher|faculty|instructor|head of department|hod)';
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayLabel = (iso) => { const d = parseISO(iso); return `${d.getDate()} ${MONTH_SHORT[d.getMonth()]}`; };
const shift = (iso, days) => toISO(addDays(parseISO(iso), days));
const rate = (part, whole) => (whole > 0 ? pct(part, whole) : null);

/** "BCA - Division A" and "Class 9-B" are one programme or class with a division on the end. */
const programmeOf = (name) => String(name).replace(/\s*-\s*(Division\s+)?[A-Z0-9]{1,2}$/i, '').trim();

async function glance(today, setup) {
  const monthStart = `${today.slice(0, 8)}01`;
  const t = parseISO(today);
  const lastStart = toISO(new Date(t.getFullYear(), t.getMonth() - 1, 1));
  const { rows: [c] } = await q(
    `select (select count(*) from students)::int as students,
            (select count(*) from students where status = 'Active')::int as active,
            (select count(*) from students where admission_date >= $1::date)::int as "newThisMonth",
            (select count(*) from students where admission_date >= $2::date and admission_date < $1::date)::int as "newLastMonth",
            (select count(*) from employees)::int as employees,
            (select count(*) from employees e join designations g on g.id = e.designation_id
              where lower(g.name) ~ $3 or exists (select 1 from timetable_slots s where s.employee_id = e.id)
                 or exists (select 1 from exam_papers p where p.employee_id = e.id))::int as faculty,
            (select count(*) from departments)::int as departments`,
    [monthStart, lastStart, TEACHING_TITLE],
  );
  const { rows: courses } = await q(
    `select c.id, c.name, (select count(distinct s.section) from students s where s.course_id = c.id and s.section <> '')::int as sections from courses c`,
  );
  const saved = setup.divisions || {};
  return {
    ...c,
    nonTeaching: c.employees - c.faculty,
    courses: courses.length,
    programmes: new Set(courses.map((x) => programmeOf(x.name).toLowerCase())).size,
    divisions: courses.reduce((n, x) => n + Math.max(x.sections, (saved[x.id] || []).length), 0),
  };
}

async function money(today) {
  const t = parseISO(today);
  const yearStart = toISO(new Date(t.getMonth() >= 3 ? t.getFullYear() : t.getFullYear() - 1, 3, 1)); // India's financial year starts on 1 April
  const weekAgo = shift(today, -7);
  const f = await feeFigures(today);
  const { rows: [b] } = await q(
    `select coalesce(sum(i.amount), 0)::float8 as billed,
            coalesce(sum((select coalesce(sum(a.amount), 0) from payment_allocations a where a.fee_item_id = i.id)), 0)::float8 as allocated
     from student_fee_items i where i.status <> 'waived'`,
  );
  const { rows: [y] } = await q(
    `select coalesce((select sum(amount) from payments where paid_at >= $1::date), 0)::float8 as year,
            coalesce((select sum(amount) from payments where paid_at >= $2::date and paid_at < $2::date + 1), 0)::float8 as "sameDayLastWeek",
            coalesce((select sum(i.amount - coalesce((select sum(a.amount) from payment_allocations a join payments p on p.id = a.payment_id
                                                      where a.fee_item_id = i.id and p.paid_at < $2::date), 0))
                      from student_fee_items i where i.status <> 'waived' and i.due_date < $2::date), 0)::float8 as "overdueLastWeek"`,
    [yearStart, weekAgo],
  );
  const { rows: billedRows } = await q(
    `select to_char(due_date, 'YYYY-MM') as month, coalesce(sum(amount), 0)::float8 as amount
     from student_fee_items where status <> 'waived' and due_date is not null group by 1`,
  );
  const billedBy = new Map(billedRows.map((r) => [r.month, r.amount]));
  const months = (await feeMonths(today, 6)).map((m) => ({ ...m, collected: m.amount, billed: billedBy.get(m.month) || 0 }));
  const { rows: daily } = await q(
    `select to_char(paid_at, 'YYYY-MM-DD') as day, sum(amount)::float8 as amount from payments where paid_at >= $1::date group by 1`, [shift(today, -13)],
  );
  const byDay = new Map(daily.map((r) => [r.day, r.amount]));
  const last14 = Array.from({ length: 14 }, (_, i) => { const d = shift(today, i - 13); return { day: d, label: dayLabel(d), amount: byDay.get(d) || 0 }; });
  return {
    collectedToday: f.collectedToday, sameDayLastWeek: y.sameDayLastWeek, thisMonth: f.thisMonth, lastMonthToDate: f.lastMonthToDate,
    year: y.year, yearStart, outstanding: f.outstanding, overdue: f.overdue, overdueLastWeek: y.overdueLastWeek, studentsOverdue: f.studentsOverdue,
    billed: b.billed, allocated: b.allocated, collectionRate: rate(b.allocated, b.billed), months, last14,
  };
}

async function attendanceBlock(today, marked) {
  const { rows } = await q(
    `select to_char(s.on_date, 'YYYY-MM-DD') as day, count(*)::int as total, count(*) filter (where r.status in ${ATTENDED})::int as attended
     from attendance_records r join attendance_sessions s on s.id = r.session_id
     where s.status = 'submitted' and s.on_date > $1::date - 14 and s.on_date <= $1::date group by 1`, [today],
  );
  const by = new Map(rows.map((r) => [r.day, r]));
  const days = Array.from({ length: 14 }, (_, i) => {
    const d = shift(today, i - 13); const r = by.get(d);
    return { day: d, label: dayLabel(d), pct: r ? pct(r.attended, r.total) : null };
  });
  const latest = [...days].reverse().find((d) => d.pct !== null) || null;
  const below = await studentsBelow();
  return {
    today: await attendanceOn(today), lastWeek: await attendanceOn(shift(today, -7)), latest, days, below,
    lecturesToday: marked.lecturesToday, lecturesMarked: marked.lecturesMarked, lecturesNotMarked: marked.lecturesNotMarked,
    // There is no record of staff attendance in the product today, so nothing is shown for it
    staffToday: null,
  };
}

async function academics() {
  const { rows: [x] } = await q(
    `select count(*) filter (where p.marks_status <> 'submitted')::int as "papersPending",
            count(distinct e.id) filter (where p.marks_status <> 'submitted')::int as "examsAwaitingMarks",
            count(distinct e.id) filter (where not exists (select 1 from exam_papers p2 where p2.exam_id = e.id and p2.marks_status <> 'submitted'))::int as "readyToPublish"
     from exams e join exam_papers p on p.exam_id = e.id where e.status = 'draft'`,
  );
  const { rows: published } = await q("select id, name from exams where status = 'published' order by published_at desc nulls last, created_at desc limit 2");
  const stats = async (row) => {
    if (!row) return null;
    const s = (await examResults(row.id)).stats;
    return { id: row.id, name: row.name, average: s.average, passRate: s.passRate, students: s.students };
  };
  return { ...x, latest: await stats(published[0]), previous: await stats(published[1]) };
}

/** Attendance (last 30 days), fee collection and the latest published result for each class, grouped by department. */
async function departmentGrid(today) {
  const { rows } = await q(
    `with latest as (
       select distinct on (course_id) id, course_id from exams where status = 'published' order by course_id, published_at desc nulls last
     ), outcome as (
       select l.course_id, m.student_id, bool_and(not m.absent and m.marks >= p.pass_marks) as passed
       from latest l join exam_papers p on p.exam_id = l.id join exam_marks m on m.paper_id = p.id group by 1, 2
     )
     select c.id, c.name, d.id as "departmentId", coalesce(d.name, 'No department') as department,
            (select count(*) from attendance_records r join attendance_sessions s on s.id = r.session_id
              where s.course_id = c.id and s.status = 'submitted' and s.on_date > $1::date - 30)::int as "attTotal",
            (select count(*) from attendance_records r join attendance_sessions s on s.id = r.session_id
              where s.course_id = c.id and s.status = 'submitted' and s.on_date > $1::date - 30 and r.status in ${ATTENDED})::int as "attDone",
            (select coalesce(sum(i.amount), 0) from student_fee_items i join students st on st.id = i.student_id
              where st.course_id = c.id and i.status <> 'waived')::float8 as billed,
            (select coalesce(sum(a.amount), 0) from payment_allocations a join student_fee_items i on i.id = a.fee_item_id join students st on st.id = i.student_id
              where st.course_id = c.id and i.status <> 'waived')::float8 as paid,
            (select count(*) from outcome o where o.course_id = c.id)::int as sat,
            (select count(*) from outcome o where o.course_id = c.id and o.passed)::int as passed
     from courses c left join departments d on d.id = c.department_id order by department, c.name`,
    [today],
  );
  const cells = (r) => ({ attendance: rate(r.attDone, r.attTotal), fees: rate(r.paid, r.billed), results: rate(r.passed, r.sat) });
  const groups = new Map();
  for (const r of rows) {
    const g = groups.get(r.department) || { id: r.departmentId, name: r.department, attDone: 0, attTotal: 0, paid: 0, billed: 0, passed: 0, sat: 0, classes: [] };
    for (const k of ['attDone', 'attTotal', 'paid', 'billed', 'passed', 'sat']) g[k] += r[k];
    g.classes.push({ id: r.id, name: r.name, ...cells(r) });
    groups.set(r.department, g);
  }
  return [...groups.values()].map((g) => ({ id: g.id, name: g.name, ...cells(g), classes: g.classes }));
}

/**
 * Institute Pulse, 0 to 100. Attendance is the last 7 days, fees the share of billed fees collected, approvals lose 5
 * points for each item waiting and exams are the share of papers with marks in. A part with no data yet is left out
 * and the others share its weight.
 */
export const PULSE_WEIGHTS = { attendance: 30, fees: 30, approvals: 20, exams: 20 };

export function pulseScore(parts) {
  let weight = 0; let sum = 0;
  for (const [k, w] of Object.entries(PULSE_WEIGHTS)) {
    if (parts[k] === null || parts[k] === undefined) continue;
    weight += w; sum += w * parts[k];
  }
  return weight ? Math.round(sum / weight) : null;
}

const approvalPart = (n) => Math.max(0, 100 - n * 5);

async function pulse(today, modules, m) {
  const has = (x) => modules.includes(x);
  const atDay = async (end) => {
    const { rows: [r] } = await q(
      `select count(*)::int as total, count(*) filter (where r.status in ${ATTENDED})::int as attended
       from attendance_records r join attendance_sessions s on s.id = r.session_id
       where s.status = 'submitted' and s.on_date > $1::date - 7 and s.on_date <= $1::date`, [end],
    );
    return rate(r.attended, r.total);
  };
  const { rows: [y] } = await q(
    `select coalesce((select sum(a.amount) from payment_allocations a join payments p on p.id = a.payment_id join student_fee_items i on i.id = a.fee_item_id
                      where i.status <> 'waived' and p.paid_at < $1::date), 0)::float8 as "paidYesterday",
            coalesce((select sum(amount) from student_fee_items where status <> 'waived' and created_at < $1::date), 0)::float8 as "billedYesterday",
            (select count(*) from exam_papers)::int as papers,
            (select count(*) from exam_papers where marks_status = 'submitted')::int as "papersIn",
            (select count(*) from exam_papers where created_at < $1::date)::int as "papersYesterday",
            (select count(*) from exam_papers where marks_status = 'submitted' and submitted_at < $1::date)::int as "papersInYesterday",
            (select count(*) from leave_requests where created_at < $1::date and (status = 'pending' or decided_at >= $1::date))::int as "leaveYesterday",
            (select count(*) from certificate_requests where created_at < $1::date and (status = 'requested' or decided_at >= $1::date))::int as "certYesterday",
            (select count(*) from applications where submitted_at < $1::date and (status = 'submitted' or decided_at >= $1::date))::int as "appYesterday",
            (select count(*) from grievances where created_at < $1::date and status = 'open')::int as "griefYesterday"`,
    [today],
  );
  const waiting = (await approvalCounts(modules)).approvals;
  const waitingYesterday = (has('leave') ? y.leaveYesterday : 0) + (has('certificates') ? y.certYesterday : 0)
    + (has('admissions') ? y.appYesterday : 0) + (has('grievance') ? y.griefYesterday : 0);
  const now = {
    attendance: has('attendance') ? await atDay(today) : null,
    fees: has('fees') ? m?.collectionRate ?? null : null,
    approvals: approvalPart(waiting),
    exams: has('exams') ? rate(y.papersIn, y.papers) : null,
  };
  const before = {
    attendance: has('attendance') ? await atDay(shift(today, -1)) : null,
    fees: has('fees') ? rate(y.paidYesterday, y.billedYesterday) : null,
    approvals: approvalPart(waitingYesterday),
    exams: has('exams') ? rate(y.papersInYesterday, y.papersYesterday) : null,
  };
  const score = pulseScore(now);
  const changes = Object.keys(PULSE_WEIGHTS)
    .filter((k) => now[k] !== null && before[k] !== null)
    .map((k) => ({ part: k, from: before[k], to: now[k], change: Math.round((now[k] - before[k]) * 10) / 10 }));
  const biggest = changes.reduce((best, c) => (Math.abs(c.change) * PULSE_WEIGHTS[c.part] > Math.abs(best?.change ?? 0) * (PULSE_WEIGHTS[best?.part] ?? 0) ? c : best), null);
  return {
    // A part with no figure for yesterday (just set up, say) counts as unchanged, so it cannot fake a jump
    score, yesterday: pulseScore(Object.fromEntries(Object.keys(now).map((k) => [k, before[k] ?? now[k]]))), biggest: biggest && biggest.change !== 0 ? biggest : null, waiting,
    parts: Object.entries(PULSE_WEIGHTS).map(([k, weight]) => ({ key: k, weight, value: now[k], yesterday: before[k] })),
  };
}

/** The academic year: what the institute saved in setup, otherwise the usual year for its type (and it says so). */
function yearOf(setup, type, today) {
  const saved = setup.academicYear;
  if (saved?.start && saved?.end) return { name: saved.name, start: saved.start, end: saved.end, assumed: false };
  const t = parseISO(today);
  const startMonth = type === 'school' ? 3 : 6;
  const y = t.getMonth() >= startMonth ? t.getFullYear() : t.getFullYear() - 1;
  const start = toISO(new Date(y, startMonth, 1));
  return { name: `${y}-${String((y + 1) % 100).padStart(2, '0')}`, start, end: toISO(new Date(y + 1, startMonth, 0)), assumed: true };
}

async function journey(today, modules, tenantType, setup, { money: m, academics: a, decisions: d, attendance: att }) {
  const has = (x) => modules.includes(x);
  const year = yearOf(setup, tenantType, today);
  const total = (parseISO(year.end) - parseISO(year.start)) / 86400000;
  const gone = (parseISO(today) - parseISO(year.start)) / 86400000;
  const { rows: [c] } = await q(
    `select (select count(*) from courses)::int as classes,
            (select count(distinct course_id) from timetable_slots)::int as "classesTimed",
            (select count(*) from attendance_sessions where status = 'submitted')::int as registers,
            (select count(*) from exams)::int as exams,
            (select count(*) from exams where status = 'published')::int as published,
            (select count(*) from exam_papers where marks_status <> 'submitted')::int as "papersOpen",
            (select count(*) from student_fee_items)::int as "feeItems",
            (select count(*) from certificate_requests where status = 'requested')::int as "certsWaiting",
            (select count(*) from certificate_requests where status = 'issued')::int as "certsIssued",
            (select count(*) from applications)::int as applications,
            (select count(*) from applications where status = 'enrolled')::int as enrolled`,
  );
  const stage = (key, module, label, status, number, next, to) => (module && !has(module) ? null : { key, label, status, number, next, to });
  const toReview = d.waiting.application ?? 0;
  const stages = [
    stage('admissions', 'admissions', 'Admissions',
      !c.applications ? 'not_started' : (toReview || d.funnel.find((f) => f.stage === 'offer')?.count) ? 'in_progress' : 'done',
      !c.applications ? 'No applications yet' : toReview ? `${toReview} to review` : `${c.enrolled} enrolled`,
      toReview ? 'Review applications' : 'Open admissions', '/admin/admissions'),
    stage('fees', 'fees', 'Fees',
      !c.feeItems ? 'not_started' : m?.outstanding > 0 ? 'in_progress' : 'done',
      !c.feeItems ? 'No fees charged yet' : `${m?.collectionRate ?? 0}% collected`,
      !c.feeItems ? 'Set up fees' : 'Collect fees', '/admin/fees'),
    stage('timetable', 'timetable', 'Timetable',
      !c.classesTimed ? 'not_started' : c.classesTimed < c.classes ? 'in_progress' : 'done',
      `${c.classesTimed} of ${c.classes} classes`,
      c.classesTimed < c.classes ? 'Finish the timetable' : 'Open timetable', '/admin/timetable'),
    stage('attendance', 'attendance', 'Attendance',
      !c.registers ? 'not_started' : today > year.end ? 'done' : 'in_progress',
      !c.registers ? 'Nothing marked yet' : att.lecturesNotMarked ? `${att.lecturesNotMarked} not marked today` : `${c.registers} registers`,
      att.lecturesNotMarked ? 'See who has not marked' : 'Open attendance', '/admin/attendance'),
    stage('exams', 'exams', 'Exams',
      !c.exams ? 'not_started' : c.papersOpen ? 'in_progress' : 'done',
      !c.exams ? 'No exams yet' : c.papersOpen ? `${c.papersOpen} papers need marks` : 'All marks in',
      !c.exams ? 'Create an exam' : 'Open exams', '/admin/exams'),
    stage('results', 'exams', 'Results',
      !c.published ? 'not_started' : c.published < c.exams ? 'in_progress' : 'done',
      `${c.published} of ${c.exams} published`,
      a.readyToPublish ? 'Publish results' : 'Open results', '/admin/exams'),
    stage('certificates', 'certificates', 'Certificates',
      !c.certsIssued && !c.certsWaiting ? 'not_started' : c.certsWaiting ? 'in_progress' : 'done',
      c.certsWaiting ? `${c.certsWaiting} waiting` : `${c.certsIssued} issued`,
      c.certsWaiting ? 'Issue certificates' : 'Open certificates', '/admin/certificates'),
  ].filter(Boolean);
  return { year, progress: Math.max(0, Math.min(100, Math.round((gone / total) * 100))), stages };
}

export async function adminOverview(modules, tenantType, marked, { today = toISO(new Date()) } = {}) {
  const has = (m) => modules.includes(m);
  const setup = await readSetup();
  const out = { today, glance: await glance(today, setup) };
  out.money = has('fees') ? await money(today) : null;
  out.attendance = has('attendance') ? await attendanceBlock(today, marked) : null;
  out.academics = has('exams') ? await academics() : null;
  const waiting = await approvalCounts(modules);
  const counts = has('admissions') ? (await board()).counts : null;
  out.decisions = {
    waiting,
    enquiries: counts?.enquiry ?? null,
    funnel: counts ? BOARD_STAGES.map((stage) => ({ stage, count: counts[stage] })) : [],
  };
  out.departments = await departmentGrid(today);
  out.pulse = await pulse(today, modules, out.money);
  out.journey = await journey(today, modules, tenantType, setup, { money: out.money, academics: out.academics || {}, decisions: out.decisions, attendance: out.attendance || {} });
  return out;
}

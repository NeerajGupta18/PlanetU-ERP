/**
 * Dashboard KPIs: the numbers each role's home page opens with. Every figure comes with something to compare it
 * to (the same weekday last week, the same days of last month, a target) so the page can say whether it is good
 * or needs action. All of it runs inside the current institute (RLS), and a department scope (a head of
 * department) narrows attendance and leave to that department's courses and staff.
 */
import { q } from '../db/pool.js';
import { DEFAULT_THRESHOLD, pct } from './attendance.service.js';
import { approvalCounts } from './approvals.service.js';
import { addDays, parseISO, toISO } from '../utils/dates.js';

const ATTENDED = "('present', 'late')";
const OPEN = '(i.amount - coalesce((select sum(a.amount) from payment_allocations a where a.fee_item_id = i.id), 0))';
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayLabel = (iso) => { const d = parseISO(iso); return `${d.getDate()} ${MONTH_SHORT[d.getMonth()]}`; };

/** Present (or late) share of the marked records on one date, or null when nothing was marked. */
export async function attendanceOn(date, courseIds = null) {
  const { rows: [r] } = await q(
    `select count(*)::int as total, count(*) filter (where r.status in ${ATTENDED})::int as attended
     from attendance_records r join attendance_sessions s on s.id = r.session_id
     where s.status = 'submitted' and s.on_date = $1::date and ($2::uuid[] is null or s.course_id = any ($2::uuid[]))`,
    [date, courseIds],
  );
  return r.total ? pct(r.attended, r.total) : null;
}

/** Weekly attendance % for the last `weeks` weeks (Monday to Sunday), oldest first. Weeks with no marking are null. */
export async function attendanceWeeks(today, weeks = 8, courseIds = null) {
  const { rows } = await q(
    `select to_char(date_trunc('week', s.on_date), 'YYYY-MM-DD') as week, count(*)::int as total,
            count(*) filter (where r.status in ${ATTENDED})::int as attended
     from attendance_records r join attendance_sessions s on s.id = r.session_id
     where s.status = 'submitted' and s.on_date > $1::date - ($2::int * 7) and s.on_date <= $1::date
       and ($3::uuid[] is null or s.course_id = any ($3::uuid[]))
     group by 1`,
    [today, weeks, courseIds],
  );
  const byWeek = new Map(rows.map((r) => [r.week, r]));
  const t = parseISO(today);
  const monday = addDays(t, -((t.getDay() + 6) % 7));
  const out = [];
  for (let i = weeks - 1; i >= 0; i -= 1) {
    const wk = toISO(addDays(monday, -7 * i));
    const r = byWeek.get(wk);
    out.push({ week: wk, label: dayLabel(wk), pct: r?.total ? pct(r.attended, r.total) : null });
  }
  return out;
}

/** Fees collected in each of the last `months` calendar months, oldest first (this month so far is the last). */
export async function feeMonths(today, months = 6) {
  const t = parseISO(today);
  const first = toISO(new Date(t.getFullYear(), t.getMonth() - (months - 1), 1));
  const { rows } = await q(
    `select to_char(paid_at, 'YYYY-MM') as month, coalesce(sum(amount), 0)::float8 as amount
     from payments where paid_at >= $1::date group by 1`, [first],
  );
  const byMonth = new Map(rows.map((r) => [r.month, r.amount]));
  const out = [];
  for (let i = months - 1; i >= 0; i -= 1) {
    const d = new Date(t.getFullYear(), t.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    out.push({ month: key, label: MONTH_SHORT[d.getMonth()], amount: byMonth.get(key) || 0 });
  }
  return out;
}

/** Active students whose attendance over all marked classes is below the minimum (with at least 3 classes marked). */
export async function studentsBelow(threshold = DEFAULT_THRESHOLD, courseIds = null) {
  const { rows } = await q(
    `select st.id, st.name, st.student_code as code, c.name as course,
            count(*) filter (where r.status in ${ATTENDED})::int as attended, count(*)::int as total
     from attendance_records r join attendance_sessions s on s.id = r.session_id join students st on st.id = r.student_id
     left join courses c on c.id = st.course_id
     where s.status = 'submitted' and st.status = 'Active' and ($2::uuid[] is null or st.course_id = any ($2::uuid[]))
     group by st.id, st.name, st.student_code, c.name
     having count(*) >= 3 and count(*) filter (where r.status in ${ATTENDED}) * 100.0 / count(*) < $1
     order by count(*) filter (where r.status in ${ATTENDED}) * 1.0 / count(*), st.name`,
    [threshold, courseIds],
  );
  return { count: rows.length, students: rows.slice(0, 5).map((r) => ({ ...r, pct: pct(r.attended, r.total) })), threshold };
}

/** Money: collected today / this month (and the same days of last month), what is still owed and what is overdue. */
export async function feeFigures(today) {
  const t = parseISO(today);
  const monthStart = `${today.slice(0, 8)}01`;
  const lastStart = toISO(new Date(t.getFullYear(), t.getMonth() - 1, 1));
  // The same number of days into last month (capped at its length), so a half-month is compared with a half-month
  const lastLen = new Date(t.getFullYear(), t.getMonth(), 0).getDate();
  const lastSameDay = toISO(new Date(t.getFullYear(), t.getMonth() - 1, Math.min(t.getDate(), lastLen) + 1));
  const { rows: [f] } = await q(
    `select coalesce((select sum(amount) from payments where paid_at >= $1::date), 0)::float8 as "collectedToday",
            coalesce((select sum(amount) from payments where paid_at >= $2::date), 0)::float8 as "thisMonth",
            coalesce((select sum(amount) from payments where paid_at >= $3::date and paid_at < $4::date), 0)::float8 as "lastMonthToDate",
            coalesce((select sum(amount) from payments where paid_at >= $3::date and paid_at < $2::date), 0)::float8 as "lastMonth",
            coalesce(sum(${OPEN}), 0)::float8 as outstanding,
            coalesce(sum(${OPEN}) filter (where i.due_date < $1::date), 0)::float8 as overdue,
            count(distinct i.student_id) filter (where i.due_date < $1::date)::int as "studentsOverdue",
            coalesce(sum(${OPEN}) filter (where i.due_date between $1::date and $1::date + 7), 0)::float8 as "dueThisWeek"
     from student_fee_items i where i.status in ('unpaid', 'partial')`,
    [today, monthStart, lastStart, lastSameDay],
  );
  return f;
}

/** The institute-wide KPIs and charts for the admin dashboard (and the principal's "Institute overview"). */
export async function institute(modules = [], { today = toISO(new Date()) } = {}) {
  const has = (m) => modules.includes(m);
  const out = { approvals: await approvalCounts(modules) };
  if (has('attendance')) {
    out.attendance = {
      today: await attendanceOn(today),
      lastWeek: await attendanceOn(toISO(addDays(parseISO(today), -7))),
      weeks: await attendanceWeeks(today, 6),
      below: await studentsBelow(),
    };
  }
  if (has('fees')) out.fees = { ...(await feeFigures(today)), months: await feeMonths(today, 6) };
  if (has('visitors')) {
    const { rows: [v] } = await q(
      `select count(*) filter (where status = 'checked_in')::int as inside,
              count(*) filter (where status = 'expected' and expected_on = $1::date)::int as expected
       from visitor_visits`, [today],
    );
    out.visitors = v;
  }
  return out;
}

/* ------------------------------------------------------------------ office staff */

const card = (key, label, value, extra = {}) => ({ key, label, value, ...extra });
const waiting = (n, act, clear = 'All clear', level = 'warn') => (n > 0 ? { status: level, hint: act } : { status: 'clear', hint: clear });
const inr = (n) => `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}`;
const compare = (now, before, period) => {
  if (!before) return now ? `Nothing in the same days ${period}` : `Same as ${period}`;
  const d = Math.round(((now - before) / before) * 100);
  return d === 0 ? `Same as ${period}` : `${d > 0 ? 'Up' : 'Down'} ${Math.abs(d)}% on ${period}`;
};

/**
 * KPI groups for an employee's office roles: one group per office area they hold (fees, library, the gate, ...),
 * each a few cards with a value, a status and the page to open. A role that covers the whole institute's
 * dashboard (the principal) gets a pointer to the institute overview instead of repeating it here.
 */
export async function officeSummary(office, modules = [], { today = toISO(new Date()) } = {}) {
  if (!office) return { overview: false, groups: [] };
  const has = (m) => modules.includes(m);
  const area = (a) => office.areas?.[a];
  const all = (a) => area(a)?.scope === 'all';
  if (all('dashboard')) {
    const a = await approvalCounts(modules);
    return { overview: true, approvals: a.approvals, groups: [] };
  }
  const groups = [];

  if (all('fees') && has('fees')) {
    const f = await feeFigures(today);
    const { rows: [o] } = await q("select count(*)::int as n from online_payment_orders where status = 'needs_review'");
    groups.push({
      area: 'fees', title: 'Fees', link: '/admin/fees', cards: [
        card('today', 'Collected today', inr(f.collectedToday), { icon: 'banknote', to: '/admin/fees?tab=payments' }),
        card('month', 'Collected this month', inr(f.thisMonth), { icon: 'trend', hint: compare(f.thisMonth, f.lastMonthToDate, 'last month'), status: 'info', to: '/admin/fees' }),
        card('overdue', 'Overdue fees', inr(f.overdue), { icon: 'wallet', to: '/admin/fees', ...waiting(f.studentsOverdue, `${f.studentsOverdue} student${f.studentsOverdue === 1 ? '' : 's'} to follow up`, 'Nothing overdue', 'bad') }),
        card('review', 'Online payments to check', o.n, { icon: 'alert', to: '/admin/fees?tab=online', ...waiting(o.n, 'Check and settle', 'None waiting') }),
      ],
    });
  }
  if (all('payroll') && has('payroll')) {
    const month = today.slice(0, 7);
    const { rows: [r] } = await q('select status from payroll_runs where month = $1', [month]);
    const { rows: [e] } = await q('select count(*)::int as n from employee_salaries');
    const state = !r ? { value: 'Not started', status: 'warn', hint: 'Run this month\'s payroll' }
      : r.status === 'draft' ? { value: 'Draft', status: 'warn', hint: 'Check and finalise' } : { value: 'Finalised', status: 'good', hint: 'Payslips are out' };
    groups.push({
      area: 'payroll', title: 'Payroll', link: '/admin/payroll', cards: [
        card('run', `Payroll for ${MONTH_SHORT[Number(month.slice(5)) - 1]}`, state.value, { icon: 'wallet', status: state.status, hint: state.hint, to: '/admin/payroll' }),
        card('people', 'Staff with a salary set', e.n, { icon: 'users', to: '/admin/payroll' }),
      ],
    });
  }

  // A head of department: their department's attendance, staff on leave and leave requests
  const dept = area('leave')?.scope === 'department' || area('attendance')?.scope === 'department';
  if (dept) {
    const ids = [...new Set([...(area('leave')?.departmentIds || []), ...(area('attendance')?.departmentIds || [])])];
    const { rows: courses } = await q('select id from courses where department_id = any ($1)', [ids]);
    const courseIds = courses.map((c) => c.id);
    const { rows: [d] } = await q('select string_agg(name, \', \' order by name) as name from departments where id = any ($1)', [ids]);
    const cards = [];
    if (has('attendance') && area('attendance')) {
      const now = await attendanceOn(today, courseIds);
      const week = (await attendanceWeeks(today, 2, courseIds));
      const thisWeek = week[1].pct; const lastWeek = week[0].pct;
      const shown = now ?? thisWeek;
      cards.push(card('att', now !== null ? 'Department attendance today' : 'Department attendance this week', shown === null ? null : `${shown}%`, {
        icon: 'percent', to: '/admin/attendance',
        ...(shown === null ? { status: 'neutral', hint: 'Nothing marked yet' } : shown < DEFAULT_THRESHOLD ? { status: 'bad', hint: `Below ${DEFAULT_THRESHOLD}%` }
          : { status: 'info', hint: lastWeek !== null && now === null ? `Last week ${lastWeek}%` : `Target ${DEFAULT_THRESHOLD}%` }),
      }));
      const below = await studentsBelow(DEFAULT_THRESHOLD, courseIds);
      cards.push(card('below', `Students below ${DEFAULT_THRESHOLD}%`, below.count, { icon: 'users', to: '/admin/attendance', ...waiting(below.count, 'Talk to them', 'Everyone above') }));
    }
    if (has('leave') && area('leave')) {
      const { rows: [l] } = await q(
        `select count(*) filter (where r.status = 'pending')::int as pending,
                count(*) filter (where r.status = 'approved' and r.from_date <= $2::date and r.to_date >= $2::date)::int as "onLeave"
         from leave_requests r join employees e on e.id = r.employee_id where e.department_id = any ($1)`, [ids, today],
      );
      cards.push(card('leave', 'Leave requests to decide', l.pending, { icon: 'calendar', to: '/admin/leave', ...waiting(l.pending, 'Approve or reject') }));
      cards.push(card('away', 'Faculty on leave today', l.onLeave, { icon: 'away', to: '/admin/leave', status: l.onLeave ? 'info' : 'clear', hint: l.onLeave ? 'Arrange cover' : 'Everyone in' }));
    }
    if (has('exams')) {
      const { rows: [x] } = await q(
        `select count(*)::int as total, count(*) filter (where not m.absent and m.marks >= p.pass_marks)::int as passed, max(e.name) as exam
         from exam_marks m join exam_papers p on p.id = m.paper_id join exams e on e.id = p.exam_id
         where e.status = 'published' and e.course_id = any ($1)
           and e.published_at = (select max(published_at) from exams where status = 'published' and course_id = any ($1))`, [courseIds],
      );
      if (x.total) cards.push(card('pass', 'Pass rate, last exam', `${pct(x.passed, x.total)}%`, { icon: 'award', status: 'info', hint: x.exam }));
    }
    if (cards.length) groups.push({ area: 'department', title: `Department${d?.name ? `: ${d.name}` : ''}`, link: area('leave') ? '/admin/leave' : '/admin/attendance', cards });
  }

  if (all('admissions') && has('admissions')) {
    const { rows: [a] } = await q(
      `select count(*) filter (where status = 'submitted')::int as review, count(*) filter (where status = 'accepted')::int as enrol,
              count(*) filter (where submitted_at >= $1::date - 6)::int as week
       from applications`, [today],
    );
    groups.push({
      area: 'admissions', title: 'Admissions', link: '/admin/admissions', cards: [
        card('review', 'Applications to review', a.review, { icon: 'clipboard', to: '/admin/admissions', ...waiting(a.review, 'Review now') }),
        card('enrol', 'Accepted, to enrol', a.enrol, { icon: 'userplus', to: '/admin/admissions', ...waiting(a.enrol, 'Enrol them', 'None waiting', 'info') }),
        card('week', 'New in the last 7 days', a.week, { icon: 'trend', to: '/admin/admissions' }),
      ],
    });
  }
  if (all('certificates') && has('certificates')) {
    const { rows: [c] } = await q("select count(*)::int as n from certificate_requests where status = 'requested'");
    groups.push({ area: 'certificates', title: 'Certificates', link: '/admin/certificates', cards: [card('waiting', 'Certificate requests', c.n, { icon: 'award', to: '/admin/certificates', ...waiting(c.n, 'Issue or reject') })] });
  }
  if (all('exams') && has('exams')) {
    const { rows: [x] } = await q(
      `select count(*) filter (where p.marks_status <> 'submitted')::int as pending,
              count(distinct e.id) filter (where not exists (select 1 from exam_papers p2 where p2.exam_id = e.id and p2.marks_status <> 'submitted'))::int as ready
       from exams e join exam_papers p on p.exam_id = e.id where e.status = 'draft'`,
    );
    groups.push({
      area: 'exams', title: 'Exams', link: '/admin/exams', cards: [
        card('pending', 'Papers with marks pending', x.pending, { icon: 'pen', to: '/admin/exams', ...waiting(x.pending, 'Remind faculty', 'All marks in') }),
        card('ready', 'Exams ready to publish', x.ready, { icon: 'award', to: '/admin/exams', ...waiting(x.ready, 'Publish results', 'Nothing to publish', 'info') }),
      ],
    });
  }
  if (all('library') && has('library')) {
    const { rows: [l] } = await q(
      `select count(*) filter (where returned_at is null)::int as out, count(*) filter (where returned_at is null and due_date < $1::date)::int as overdue,
              count(*) filter (where returned_at is null and due_date between $1::date and $1::date + 2)::int as soon,
              (select coalesce(sum(available_copies), 0) from books)::int as available
       from book_issues`, [today],
    );
    groups.push({
      area: 'library', title: 'Library', link: '/admin/library', cards: [
        card('out', 'Books on loan', l.out, { icon: 'book', to: '/admin/library' }),
        card('overdue', 'Overdue returns', l.overdue, { icon: 'alert', to: '/admin/library', ...waiting(l.overdue, 'Send reminders', 'None overdue', 'bad') }),
        card('soon', 'Due back in 2 days', l.soon, { icon: 'calendar', to: '/admin/library', status: l.soon ? 'info' : 'clear', hint: l.soon ? 'Expect returns' : 'None due' }),
        card('available', 'Copies on the shelf', l.available, { icon: 'book', to: '/admin/library' }),
      ],
    });
  }
  if (all('hostel') && has('hostel')) {
    const { rows: [h] } = await q(
      `select coalesce((select sum(beds) from hostel_rooms where active), 0)::int as beds,
              (select count(*) from hostel_stays where status = 'active')::int as residents`,
    );
    const free = Math.max(0, h.beds - h.residents);
    groups.push({
      area: 'hostel', title: 'Hostel', link: '/admin/hostel', cards: [
        card('residents', 'Residents', h.residents, { icon: 'users', to: '/admin/hostel', status: 'info', hint: h.beds ? `${pct(h.residents, h.beds)}% of beds used` : 'No rooms yet' }),
        card('free', 'Beds free', free, { icon: 'bed', to: '/admin/hostel', ...(h.beds && !free ? { status: 'warn', hint: 'Hostel is full' } : { status: 'neutral' }) }),
      ],
    });
  }
  if (all('transport') && has('transport')) {
    const { rows: [t] } = await q(
      `select coalesce((select sum(seats) from transport_routes where active), 0)::int as seats,
              (select count(*) from transport_routes where active)::int as routes,
              (select count(*) from transport_rides where status = 'active')::int as riders`,
    );
    groups.push({
      area: 'transport', title: 'Transport', link: '/admin/transport', cards: [
        card('riders', 'Students riding', t.riders, { icon: 'users', to: '/admin/transport', status: 'info', hint: `${t.routes} route${t.routes === 1 ? '' : 's'} running` }),
        card('seats', 'Seats free', Math.max(0, t.seats - t.riders), { icon: 'bus', to: '/admin/transport' }),
      ],
    });
  }
  if (all('visitors') && has('visitors')) {
    const { rows: [v] } = await q(
      `select count(*) filter (where status = 'checked_in')::int as inside,
              count(*) filter (where status = 'expected' and expected_on = $1::date)::int as expected,
              count(*) filter (where check_in_at >= $1::date and check_in_at < $1::date + 1)::int as today
       from visitor_visits`, [today],
    );
    groups.push({
      area: 'visitors', title: 'Gate', link: '/admin/visitors', cards: [
        card('inside', 'Visitors inside now', v.inside, { icon: 'door', to: '/admin/visitors', status: v.inside ? 'info' : 'clear', hint: v.inside ? 'Check out when they leave' : 'Nobody inside' }),
        card('expected', 'Expected today', v.expected, { icon: 'calendar', to: '/admin/visitors', status: v.expected ? 'info' : 'clear', hint: v.expected ? 'Pre-registered' : 'None expected' }),
        card('today', 'Checked in today', v.today, { icon: 'users', to: '/admin/visitors' }),
      ],
    });
  }
  if (all('placement') && has('placement')) {
    const { rows: [p] } = await q(
      `select (select count(*) from placement_drives where status = 'open')::int as open,
              (select count(*) from placement_applications where status = 'applied')::int as review,
              (select count(*) from placement_applications where status = 'selected')::int as selected`,
    );
    groups.push({
      area: 'placement', title: 'Placement', link: '/admin/placement', cards: [
        card('open', 'Open drives', p.open, { icon: 'briefcase', to: '/admin/placement' }),
        card('review', 'Applications to shortlist', p.review, { icon: 'clipboard', to: '/admin/placement', ...waiting(p.review, 'Shortlist now', 'None waiting') }),
        card('selected', 'Students selected', p.selected, { icon: 'award', to: '/admin/placement', status: p.selected ? 'good' : 'neutral', hint: p.selected ? 'Offers made' : undefined }),
      ],
    });
  }
  return { overview: false, groups };
}

/* ------------------------------------------------------------------ platform */

/** Which institutes nobody has signed in to for a week (platform context: reads every tenant's login audit). */
export async function quietInstitutes(days = 7) {
  const { rows } = await q(
    `select t.id, t.name, t.code, max(a.at) as "lastLogin"
     from tenants t left join audit_log a on a.tenant_id = t.id and a.action = 'auth.login'
     where t.status = 'active' and coalesce(t.settings->>'demo', 'false') <> 'true'
     group by t.id, t.name, t.code
     having max(a.at) is null or max(a.at) < now() - ($1::int || ' days')::interval
     order by max(a.at) nulls first, t.name`, [days],
  );
  return rows;
}

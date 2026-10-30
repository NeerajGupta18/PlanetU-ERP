/**
 * The teacher's and staff member's dashboard: today's lectures for the My Day timeline, marks entry per paper, leave,
 * students who need a call and approvals. Everything is for this person only: their own lectures and papers, and for a
 * class teacher their own class. Always read fresh, because a teacher who has just marked a lecture must see it marked.
 */
import { q } from '../db/pool.js';
import { approvalCounts } from './approvals.service.js';
import { lecturesForEmployee, today as todayISO } from './attendance.service.js';
import { employeePapers } from './exams.service.js';
import { balances } from './leave.service.js';
import { feed as noticeFeed } from './notices.service.js';
import { officeOf } from './staff.service.js';
import { classesOf, watchOverview } from '../../agents/attendanceWatch.js';

export async function employeeOverview(user, modules = []) {
  const has = (m) => modules.includes(m);
  const today = todayISO();
  const employeeId = user.employeeId;
  const office = await officeOf(user);
  const out = { today, generatedAt: new Date().toISOString(), lectures: null, papers: null, leave: null, needCall: null, approvals: null, notices: null };

  if (has('attendance') && has('timetable')) {
    const d = await lecturesForEmployee(employeeId, today);
    out.lectures = { holiday: d.holiday, daily: d.daily, items: d.lectures };
  }
  if (has('exams')) {
    const rows = await employeePapers(employeeId);
    out.papers = rows.filter((p) => p.examStatus === 'draft').map((p) => ({
      id: p.id, subject: p.subject, exam: p.examName, course: p.course, entered: p.entered, roster: p.roster, status: p.marksStatus,
    }));
  }
  if (has('leave')) {
    const year = new Date().getFullYear();
    const { rows: requests } = await q(
      `select r.id, r.from_date::text as "fromDate", r.to_date::text as "toDate", r.status, t.name as type
       from leave_requests r join leave_types t on t.id = r.leave_type_id
       where r.employee_id = $1 order by r.created_at desc limit 3`, [employeeId],
    );
    out.leave = { balances: await balances(employeeId, year), requests };
  }
  // Attendance watch: only the classes this person is class teacher of
  const classes = await classesOf(employeeId);
  if (has('attendance') && classes.length) {
    const w = await watchOverview({ tenant: { modules }, classes, office: { full: false, areas: {} } });
    out.needCall = { count: w.counts.flagged, students: w.students.slice(0, 5).map((s) => ({ id: s.id, name: s.name, class: s.class, percent: s.percent, threeInARow: s.threeInARow })) };
  }
  if (office?.areas?.approvals?.scope === 'all') {
    out.approvals = { count: (await approvalCounts(modules)).approvals, to: '/admin/approvals' };
  } else if (office?.areas?.leave?.scope === 'department' && has('leave')) {
    const { rows: [r] } = await q(
      `select count(*)::int as n from leave_requests r join employees e on e.id = r.employee_id where r.status = 'pending' and e.department_id = any ($1)`,
      [office.areas.leave.departmentIds],
    );
    out.approvals = { count: r.n, to: '/admin/leave' };
  }
  if (has('notices')) {
    const f = await noticeFeed(user, { limit: 3 });
    out.notices = { unread: f.unread, latest: f.notices.map((n) => ({ id: n.id, title: n.title, date: n.date, read: n.read, priority: n.priority })) };
  }
  return out;
}

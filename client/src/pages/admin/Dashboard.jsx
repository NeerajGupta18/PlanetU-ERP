import { Link } from 'react-router-dom';
import {
  AlertTriangle, BarChart3, CalendarCheck, CalendarDays, ClipboardCheck, Inbox, LayoutDashboard, ListTodo, Megaphone, Percent, Receipt, TrendingUp, Upload, UserPlus, Users2, Wallet, Zap,
} from 'lucide-react';
import { useFetch } from '../../hooks/useFetch.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useTenantConfig } from '../../hooks/useTenantConfig.js';
import { Badge, Card, PageBanner, StatCard, pending } from '../../components/ui/Ui.jsx';
import { DataBoundary, EmptyState } from '../../components/ui/Feedback.jsx';
import { BarChart, LineChart } from '../../components/ui/Charts.jsx';
import AttentionList from '../../components/campus/AttentionList.jsx';
import SetupChecklist from '../../components/campus/SetupChecklist.jsx';
import { EVENT_TYPES } from '../../utils/eventTypes.js';
import { fmtEventDates, fmtLong, todayISO } from '../../utils/dates.js';
import { compare, inr0, inrShort, plural } from '../../utils/kpi.js';

export default function Dashboard() {
  const { data, loading, error, reload } = useFetch('/admin/dashboard');
  return (
    <DataBoundary loading={loading} error={error} data={data} reload={reload}>
      {data && <DashboardView d={data} />}
    </DataBoundary>
  );
}

function QuickAction({ to, icon: Icon, label }) {
  return <Link to={to} className="quick"><span className="quick__icon"><Icon size={18} /></span><span>{label}</span></Link>;
}

/** Everything waiting for the office, most urgent first. Built from the same figures as the cards. */
function attentionItems(d, has, t) {
  const w = d.today; const k = d.kpis; const a = k.approvals || {};
  const items = [];
  if (has('attendance') && has('timetable') && w.lecturesNotMarked > 0) {
    items.push({ key: 'att', tone: 'warn', title: `${plural(w.lecturesNotMarked, 'lecture')} today without attendance`, detail: `${w.lecturesMarked} of ${w.lecturesToday} marked so far`, link: '/admin/attendance' });
  }
  if (k.fees?.studentsOverdue > 0) items.push({ key: 'fees', tone: 'bad', title: `${plural(k.fees.studentsOverdue, t('student', 'Student').toLowerCase())} with overdue fees`, detail: `${inr0(k.fees.overdue)} past the due date`, link: '/admin/fees' });
  if (a.leave > 0) items.push({ key: 'leave', tone: 'warn', title: `${plural(a.leave, 'leave request')} to decide`, detail: 'Approve or reject from Approvals', link: '/admin/approvals' });
  if (a.application > 0) items.push({ key: 'app', tone: 'warn', title: `${plural(a.application, 'application')} to review`, detail: t('admission', 'Admissions'), link: '/admin/admissions' });
  if (w.applicationsToEnrol > 0) items.push({ key: 'enrol', tone: 'info', title: `${plural(w.applicationsToEnrol, 'accepted applicant')} to enrol`, detail: t('admission', 'Admissions'), link: '/admin/admissions' });
  if (a.certificate > 0) items.push({ key: 'cert', tone: 'warn', title: `${plural(a.certificate, 'certificate request')} waiting`, detail: 'Issue or reject', link: '/admin/certificates' });
  if (a.grievance > 0) items.push({ key: 'griev', tone: 'warn', title: `${plural(a.grievance, 'new grievance')} to answer`, detail: 'Help desk', link: '/admin/grievances' });
  if (k.attendance?.below.count > 0) {
    const b = k.attendance.below;
    items.push({ key: 'below', tone: 'warn', title: `${plural(b.count, t('student', 'Student').toLowerCase())} below ${b.threshold}% attendance`, detail: b.students.slice(0, 3).map((s) => `${s.name} (${s.pct}%)`).join(', '), link: '/admin/reports' });
  }
  if (k.fees?.dueThisWeek > 0) items.push({ key: 'due', tone: 'info', title: `${inr0(k.fees.dueThisWeek)} in fees falls due this week`, detail: 'A reminder now saves a follow-up later', link: '/admin/fees' });
  if (has('leave') && w.onLeaveToday > 0) items.push({ key: 'away', tone: 'info', title: `${plural(w.onLeaveToday, t('employee', 'Employee').toLowerCase())} on leave today`, detail: 'Check lectures that need cover', link: '/admin/leave' });
  if (k.visitors?.inside > 0) items.push({ key: 'vis', tone: 'info', title: `${plural(k.visitors.inside, 'visitor')} inside now`, detail: k.visitors.expected ? `${k.visitors.expected} more expected today` : 'Check them out when they leave', link: '/admin/visitors' });
  return items;
}

function DashboardView({ d }) {
  const { office } = useAuth();
  const { hasModule, t } = useTenantConfig();
  const w = d.today; const k = d.kpis;
  const att = hasModule('attendance') && hasModule('timetable');
  const fees = hasModule('fees') && k.fees;
  const attK = hasModule('attendance') && k.attendance;
  const items = attentionItems(d, hasModule, t);

  // Attendance: today's figure once lectures are marked, otherwise this week so far; both against the same day/week before
  const weeks = attK ? k.attendance.weeks : [];
  const thisWeek = weeks[weeks.length - 1]?.pct ?? null;
  const lastWeek = weeks[weeks.length - 2]?.pct ?? null;
  const attNow = attK ? (k.attendance.today ?? thisWeek) : null;
  const attStatus = attNow === null ? { status: 'neutral' } : attNow < 75 ? { status: 'bad', hint: 'Below the 75% minimum' } : { status: 'good', hint: 'Above the 75% minimum' };

  return (
    <>
      <PageBanner icon={LayoutDashboard} title={office ? 'Institute overview' : 'Dashboard'} subtitle={`${d.institute.name}  |  ${fmtLong(todayISO())}`} />

      <SetupChecklist />

      <div className="stats stats--3">
        {attK && (
          <StatCard
            value={attNow === null ? null : `${attNow}%`} icon={Percent} to="/admin/attendance"
            label={k.attendance.today !== null ? 'Students present today' : 'Attendance this week'}
            sub={k.attendance.today !== null ? compare(k.attendance.today, k.attendance.lastWeek, 'last week', { points: true }) : compare(thisWeek, lastWeek, 'last week', { points: true })}
            {...attStatus}
          />
        )}
        {att && (
          <StatCard
            value={w.lecturesToday ? <>{w.lecturesNotMarked}<small>of {w.lecturesToday}</small></> : 0} label="Lectures not marked today" icon={CalendarCheck} to="/admin/attendance"
            {...(w.lecturesToday === 0 ? { status: 'clear', hint: 'No lectures today' } : pending(w.lecturesNotMarked, { act: 'Remind faculty', clear: 'All lectures marked' }))}
          />
        )}
        {fees && (
          <StatCard value={inr0(k.fees.thisMonth)} label="Fees collected this month" icon={TrendingUp} to="/admin/fees" status="info"
            sub={compare(k.fees.thisMonth, k.fees.lastMonthToDate, 'last month') || 'First collections this month'}
            hint={k.fees.collectedToday ? `${inr0(k.fees.collectedToday)} today` : undefined}
          />
        )}
        {fees && (
          <StatCard value={inr0(k.fees.overdue)} label="Fees overdue" icon={Wallet} to="/admin/fees"
            sub={`${inr0(k.fees.outstanding)} still to collect in all`}
            {...pending(k.fees.studentsOverdue, { level: 'bad', act: `${plural(k.fees.studentsOverdue, t('student', 'Student').toLowerCase())} to follow up`, clear: 'Nothing overdue' })}
          />
        )}
        <StatCard value={k.approvals.approvals} label="Waiting for approval" icon={Inbox} to="/admin/approvals"
          sub={[k.approvals.leave && plural(k.approvals.leave, 'leave'), k.approvals.application && plural(k.approvals.application, 'application'), k.approvals.certificate && plural(k.approvals.certificate, 'certificate'), k.approvals.grievance && plural(k.approvals.grievance, 'grievance')].filter(Boolean).join(', ') || undefined}
          {...pending(k.approvals.approvals, { act: 'Decide now' })}
        />
        {attK ? (
          <StatCard value={k.attendance.below.count} label={`${t('students', 'Students')} below ${k.attendance.below.threshold}%`} icon={AlertTriangle} to="/admin/reports"
            sub={k.attendance.below.students[0] ? `Lowest: ${k.attendance.below.students[0].name}, ${k.attendance.below.students[0].pct}%` : undefined}
            {...pending(k.attendance.below.count, { act: 'Talk to them', clear: 'Everyone above' })}
          />
        ) : (
          <StatCard value={d.stats.totalStudents} label={t('students', 'Students')} icon={Users2} to="/admin/students" />
        )}
      </div>

      <div className="grid-2">
        <Card title={`Needs your attention${items.length ? ` (${items.length})` : ''}`} icon={ListTodo}>
          <AttentionList items={items} />
        </Card>
        <UpcomingEvents events={d.upcomingEvents} />
      </div>

      {(fees || attK) && (
        <div className="grid-2">
          {fees && (
            <Card title="Fees collected by month" icon={BarChart3} action={<Link to="/admin/fees" className="btn btn--outline btn--sm">Fees</Link>}>
              <BarChart
                data={k.fees.months.map((m, i) => ({ label: m.label, full: monthName(m.month), value: m.amount, note: i === k.fees.months.length - 1 ? 'so far' : undefined }))}
                format={inr0} axisFormat={inrShort} caption="Fees collected in each of the last six months"
              />
              <p className="chart-note">Last six months. {monthName(k.fees.months[k.fees.months.length - 1].month)} is this month so far.</p>
            </Card>
          )}
          {attK && (
            <Card title="Student attendance by week" icon={Percent} action={<Link to="/admin/reports" className="btn btn--outline btn--sm">Reports</Link>}>
              {weeks.every((x) => x.pct === null) ? (
                <EmptyState title="No attendance marked yet" hint="The trend appears here once faculty start marking lectures." />
              ) : (
                <>
                  <LineChart
                    data={weeks.map((x) => ({ label: x.label, full: `Week of ${x.label}`, value: x.pct }))}
                    format={(v) => `${v}%`} min={Math.max(0, Math.min(60, ...weeks.filter((x) => x.pct !== null).map((x) => Math.floor(x.pct / 10) * 10)))} max={100}
                    target={75} targetLabel="75% minimum" caption="Share of students present in each of the last six weeks"
                  />
                  <p className="chart-note">Share of students present, week by week (Monday to Sunday).</p>
                </>
              )}
            </Card>
          )}
        </div>
      )}

      <Card title="Shortcuts" icon={Zap}>
        <div className="quicks">
          {hasModule('admissions') && <QuickAction to="/admin/admissions" icon={ClipboardCheck} label={`Review ${t('admission', 'Admissions').toLowerCase()}`} />}
          {hasModule('students') && !office && <QuickAction to="/admin/students/import" icon={Upload} label={`Import ${t('students', 'Students').toLowerCase()}`} />}
          {!office && <QuickAction to="/admin/employees" icon={UserPlus} label={`Add ${t('employee', 'Employee').toLowerCase()}`} />}
          {hasModule('fees') && <QuickAction to="/admin/fees" icon={Receipt} label="Record payment" />}
          <QuickAction to="/admin/calendar" icon={CalendarDays} label="Add an event" />
          {hasModule('notices') && <QuickAction to="/admin/notices" icon={Megaphone} label="Post a notice" />}
        </div>
      </Card>
    </>
  );
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthName = (ym) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;

function UpcomingEvents({ events }) {
  return (
    <Card title="Upcoming events" icon={CalendarDays} action={<Link to="/admin/calendar" className="btn btn--outline btn--sm">Calendar</Link>}>
      {events.length === 0 ? (
        <EmptyState title="Nothing scheduled" hint="New exams, events and deadlines will show up here." />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Event</th><th>Type</th><th>Dates</th></tr></thead>
            <tbody>
              {events.map((e) => {
                const type = EVENT_TYPES[e.type] || { label: e.type, tone: 'gray' };
                return (
                  <tr key={e.id}>
                    <td><strong>{e.title}</strong></td>
                    <td><Badge tone={type.tone}>{type.label}</Badge></td>
                    <td>{fmtEventDates(e.start, e.end)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

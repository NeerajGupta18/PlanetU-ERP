import { Link } from 'react-router-dom';
import {
  Banknote, Building2, CalendarCheck, CalendarDays, ClipboardCheck, ClipboardList, LayoutDashboard, Megaphone, Network, Plus, Receipt, Upload, UserPlus, Users, Users2, Wallet,
} from 'lucide-react';
import { useFetch } from '../../hooks/useFetch.js';
import { useTenantConfig } from '../../hooks/useTenantConfig.js';
import { Badge, Card, PageBanner, StatCard } from '../../components/ui/Ui.jsx';
import { DataBoundary, EmptyState } from '../../components/ui/Feedback.jsx';
import { STATUS } from '../../components/admissions/status.js';
import { EVENT_TYPES } from '../../utils/eventTypes.js';
import { fmtEventDates } from '../../utils/dates.js';

const inr = (n) => `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

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

function DashboardView({ d }) {
  const { hasModule, t } = useTenantConfig();
  const w = d.today;
  const adm = hasModule('admissions');
  const fees = hasModule('fees');
  const att = hasModule('attendance') && hasModule('timetable');

  return (
    <>
      <PageBanner icon={LayoutDashboard} title="Admin Dashboard" subtitle={d.institute.name} />

      <Card title="Quick actions" icon={Plus}>
        <div className="quicks">
          {adm && <QuickAction to="/admin/admissions" icon={ClipboardCheck} label={`Review ${t('admission', 'Admissions').toLowerCase()}`} />}
          {hasModule('students') && <QuickAction to="/admin/students/import" icon={Upload} label={`Import ${t('students', 'Students').toLowerCase()}`} />}
          <QuickAction to="/admin/employees" icon={UserPlus} label={`Add ${t('employee', 'Employee').toLowerCase()}`} />
          {fees && <QuickAction to="/admin/fees" icon={Receipt} label="Record payment" />}
          {att && <QuickAction to="/admin/attendance" icon={CalendarCheck} label="Attendance" />}
          <QuickAction to="/admin/calendar" icon={CalendarDays} label="Add an event" />
          {hasModule('notices') && <QuickAction to="/admin/notices" icon={Megaphone} label="Post a notice" />}
        </div>
      </Card>

      <div className="stats">
        {adm && <StatCard value={w.applicationsToReview} label="Applications to review" icon={ClipboardList} tone="rose" />}
        {fees && <StatCard value={inr(w.feesThisMonth)} label="Fees collected this month" icon={Banknote} tone="green" />}
        {fees && <StatCard value={inr(w.feesOutstanding)} label="Fees outstanding" icon={Wallet} tone="amber" />}
        {att && <StatCard value={w.attendancePercent === null ? '-' : `${w.attendancePercent}%`} label="Attendance marked today" icon={CalendarCheck} tone="indigo" />}
        <StatCard value={d.stats.totalStudents} label={t('students', 'Students')} icon={Users2} tone="indigo" />
        <StatCard value={d.stats.totalEmployees} label={t('employees', 'Employees')} icon={Users} tone="green" />
        <StatCard value={d.stats.totalDepartments} label="Departments" icon={Network} tone="amber" />
        <StatCard value={d.stats.lecturesNext7Days} label="Lectures in next 7 days" icon={CalendarDays} tone="rose" />
      </div>

      {(adm || att) && (
        <div className="grid-2">
          {adm && (
            <Card title={`Needs your attention`} icon={ClipboardCheck} action={<Link to="/admin/admissions" className="btn btn--outline btn--sm">Open</Link>}>
              <ul className="todo">
                <li><strong>{w.applicationsToReview}</strong> application{w.applicationsToReview === 1 ? '' : 's'} waiting for review</li>
                <li><strong>{w.applicationsToEnrol}</strong> accepted, ready to enrol</li>
                {w.applicationFeesPending > 0 && <li><strong>{w.applicationFeesPending}</strong> application fee{w.applicationFeesPending === 1 ? '' : 's'} not yet received</li>}
                {hasModule('certificates') && w.certificatesToIssue > 0 && <li><strong>{w.certificatesToIssue}</strong> certificate request{w.certificatesToIssue === 1 ? '' : 's'} <Link to="/admin/certificates">waiting</Link></li>}
                {att && <li><strong>{w.lecturesNotMarked}</strong> of {w.lecturesToday} lecture{w.lecturesToday === 1 ? '' : 's'} today without attendance</li>}
              </ul>
              {d.recentApplications.length > 0 && (
                <div className="table-wrap" style={{ marginTop: 12 }}>
                  <table className="table">
                    <thead><tr><th>Applicant</th><th>{t('course', 'Course')}</th><th>Status</th></tr></thead>
                    <tbody>
                      {d.recentApplications.map((a) => (
                        <tr key={a.id}>
                          <td><strong>{a.name}</strong><div className="muted">{a.applicationNo}</div></td>
                          <td>{a.course}</td>
                          <td><Badge tone={STATUS[a.status]?.tone || 'gray'}>{STATUS[a.status]?.label || a.status}</Badge></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          )}
          <UpcomingEvents events={d.upcomingEvents} />
        </div>
      )}
      {!(adm || att) && <UpcomingEvents events={d.upcomingEvents} />}

      <Card title="Institute" icon={Building2}>
        <dl className="fields fields--3">
          <div className="field-view"><dt>Name</dt><dd>{d.institute.name}</dd></div>
          <div className="field-view"><dt>Email</dt><dd>{d.institute.email || '-'}</dd></div>
          <div className="field-view"><dt>Phone</dt><dd>{d.institute.phone || '-'}</dd></div>
        </dl>
      </Card>
    </>
  );
}

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

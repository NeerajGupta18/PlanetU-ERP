import { Building2, CalendarDays, LayoutDashboard, Network, Users, Users2 } from 'lucide-react';
import { useFetch } from '../../hooks/useFetch.js';
import { Badge, Card, PageBanner, StatCard } from '../../components/ui/Ui.jsx';
import { DataBoundary, EmptyState } from '../../components/ui/Feedback.jsx';
import { EVENT_TYPES } from '../../utils/eventTypes.js';
import { fmtEventDates } from '../../utils/dates.js';

export default function Dashboard() {
  const { data, loading, error, reload } = useFetch('/admin/dashboard');
  return (
    <DataBoundary loading={loading} error={error} data={data} reload={reload}>
      {data && <DashboardView d={data} />}
    </DataBoundary>
  );
}

function DashboardView({ d }) {
  return (
    <>
      <PageBanner
        icon={LayoutDashboard}
        title="Admin Dashboard"
        subtitle={d.institute.name}
      />

      <div className="stats">
        <StatCard value={d.stats.totalDepartments} label="Departments" icon={Network} tone="indigo" />
        <StatCard value={d.stats.totalDesignations} label="Designations" icon={Users2} tone="green" />
        <StatCard value={d.stats.totalEmployees} label="Employees" icon={Users} tone="amber" />
        <StatCard value={d.stats.lecturesNext7Days} label="Lectures in next 7 days" icon={CalendarDays} tone="rose" />
      </div>

      <Card title="Upcoming events" icon={CalendarDays}>
        {d.upcomingEvents.length === 0 ? (
          <EmptyState title="Nothing scheduled" hint="New exams, events and deadlines will show up here." />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Event</th><th>Type</th><th>Dates</th><th>Audience</th></tr></thead>
              <tbody>
                {d.upcomingEvents.map((e) => {
                  const type = EVENT_TYPES[e.type] || { label: e.type, tone: 'gray' };
                  return (
                    <tr key={e.id}>
                      <td><strong>{e.title}</strong></td>
                      <td><Badge tone={type.tone}>{type.label}</Badge></td>
                      <td>{fmtEventDates(e.start, e.end)}</td>
                      <td className="muted">{e.audience === 'all' ? 'Everyone' : e.audience}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

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

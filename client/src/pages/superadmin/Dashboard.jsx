import { Building2, CheckCircle2, LayoutDashboard, PauseCircle, Users } from 'lucide-react';
import { useFetch } from '../../hooks/useFetch.js';
import { Badge, Card, PageBanner, StatCard } from '../../components/ui/Ui.jsx';
import { DataBoundary, EmptyState } from '../../components/ui/Feedback.jsx';
import { fmtDate } from '../../utils/dates.js';

const TYPE_LABEL = { school: 'School', college: 'College', university: 'University', company: 'Company' };

export default function Dashboard() {
  const { data, loading, error, reload } = useFetch('/super-admin/dashboard');
  return (
    <DataBoundary loading={loading} error={error} data={data} reload={reload}>
      {data && (
        <>
          <PageBanner icon={LayoutDashboard} title="Platform Dashboard" subtitle="Every institute running on PlanetU ERP" />

          <div className="stats">
            <StatCard value={data.stats.total} label="Institutes" icon={Building2} tone="indigo" />
            <StatCard value={data.stats.active} label="Active" icon={CheckCircle2} tone="green" />
            <StatCard value={data.stats.suspended} label="Suspended" icon={PauseCircle} tone="rose" />
            <StatCard value={data.stats.users} label="User accounts" icon={Users} tone="amber" />
          </div>

          <div className="grid-2">
            <Card title="Institutes by type" icon={Building2}>
              {data.byType.length === 0 ? <EmptyState title="No institutes yet" /> : (
                <table className="table">
                  <tbody>
                    {data.byType.map((t) => (
                      <tr key={t.type}><td><strong>{TYPE_LABEL[t.type] || t.type}</strong></td><td className="muted">{t.n}</td></tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>

            <Card title="Recently added" icon={Building2}>
              {data.recent.length === 0 ? <EmptyState title="Nothing yet" /> : (
                <table className="table">
                  <tbody>
                    {data.recent.map((t) => (
                      <tr key={t.id}>
                        <td><strong>{t.name}</strong><div className="muted">{t.code}</div></td>
                        <td><Badge tone={t.status === 'active' ? 'green' : 'red'}>{t.status}</Badge></td>
                        <td className="muted">{fmtDate(t.createdAt.slice(0, 10))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          </div>
        </>
      )}
    </DataBoundary>
  );
}

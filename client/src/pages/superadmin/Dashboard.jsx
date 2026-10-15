import { Link } from 'react-router-dom';
import { AlertTriangle, BarChart3, Building2, CheckCircle2, Clock, Hourglass, LayoutDashboard, ListTodo, Moon, TrendingUp } from 'lucide-react';
import { useFetch } from '../../hooks/useFetch.js';
import { Badge, Card, PageBanner, StatCard, pending } from '../../components/ui/Ui.jsx';
import { DataBoundary, EmptyState } from '../../components/ui/Feedback.jsx';
import { BarChart } from '../../components/ui/Charts.jsx';
import AttentionList from '../../components/campus/AttentionList.jsx';
import { fmtDate } from '../../utils/dates.js';
import { inr0, inrShort, plural } from '../../utils/kpi.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export default function Dashboard() {
  const { data, loading, error, reload } = useFetch('/super-admin/dashboard');
  return (
    <DataBoundary loading={loading} error={error} data={data} reload={reload}>
      {data && <View d={data} />}
    </DataBoundary>
  );
}

function View({ d }) {
  const b = d.billing;
  const paying = d.stats.total - d.stats.demo;
  const items = [
    ...b.overdue.map((o) => ({ key: `o-${o.tenantId}`, tone: 'bad', title: `${o.name}: ${inr0(o.amount)} overdue`, detail: o.status === 'past_due' ? 'In the grace period' : 'Invoice past its due date', link: '/super-admin/billing' })),
    ...b.trialsEnding.map((t) => ({ key: `t-${t.tenantId}`, tone: 'warn', title: `${t.name}: trial ends ${fmtDate(t.endsOn)}`, detail: 'Help them choose a plan', link: '/super-admin/billing' })),
    ...(b.needsReview > 0 ? [{ key: 'review', tone: 'warn', title: `${plural(b.needsReview, 'online payment')} to check`, detail: 'Paid, but not matched to an invoice yet', link: '/super-admin/billing' }] : []),
    ...b.suspended.map((s) => ({ key: `s-${s.tenantId}`, tone: 'info', title: `${s.name} is suspended`, detail: s.reason || 'No reason recorded', link: '/super-admin/institutes' })),
    ...d.quiet.map((q) => ({ key: `q-${q.id}`, tone: 'info', title: `${q.name}: nobody signed in this week`, detail: q.lastLogin ? `Last sign-in ${fmtDate(String(q.lastLogin).slice(0, 10))}` : 'Never signed in', link: '/super-admin/institutes' })),
  ];
  const series = b.series.map((s) => ({ label: MONTHS[Number(s.month.slice(5)) - 1], full: `${MONTHS[Number(s.month.slice(5)) - 1]} ${s.month.slice(0, 4)}`, value: s.collected }));

  return (
    <>
      <PageBanner icon={LayoutDashboard} title="Platform Dashboard" subtitle="Every institute running on PlanetU ERP" />

      <div className="stats stats--3">
        <StatCard value={<>{d.stats.active}<small>of {d.stats.total}</small></>} label="Institutes active" icon={Building2} to="/super-admin/institutes"
          sub={`${d.stats.demo} demo, ${paying} customer${paying === 1 ? '' : 's'}`} {...(d.stats.suspended ? { status: 'warn', hint: `${d.stats.suspended} suspended` } : {})}
        />
        <StatCard value={inr0(b.collectedThisMonth)} label="Received this month" icon={TrendingUp} to="/super-admin/billing" status="info" sub={`Monthly recurring ${inr0(b.mrr)}`} />
        <StatCard value={inr0(b.receivables.overdue)} label="Overdue invoices" icon={AlertTriangle} to="/super-admin/billing"
          sub={`${inr0(b.receivables.outstanding)} unpaid in all`} {...pending(b.receivables.overdueCount, { level: 'bad', act: `${plural(b.receivables.overdueCount, 'invoice')} to chase`, clear: 'Nothing overdue' })}
        />
        <StatCard value={b.trialsEnding.length} label="Trials ending in 7 days" icon={Hourglass} to="/super-admin/billing" {...pending(b.trialsEnding.length, { act: 'Follow up', clear: 'None ending' })} />
        <StatCard value={d.stats.activeWeek} label="Institutes signed in this week" icon={CheckCircle2} to="/super-admin/institutes" sub={`${d.stats.users} user accounts in all`} />
        <StatCard value={d.quiet.length} label="No sign-in for 7 days" icon={Moon} to="/super-admin/institutes" {...(d.quiet.length ? { status: 'info', hint: 'Check in with them' } : { status: 'clear', hint: 'Everyone active' })} />
      </div>

      <div className="grid-2">
        <Card title={`Needs your attention${items.length ? ` (${items.length})` : ''}`} icon={ListTodo}>
          <AttentionList items={items} />
        </Card>
        <Card title="Received by month" icon={BarChart3} action={<Link to="/super-admin/billing" className="btn btn--outline btn--sm">Billing</Link>}>
          {series.length === 0 || series.every((s) => !s.value) ? (
            <EmptyState title="No payments yet" hint="Subscription payments will be charted here month by month." />
          ) : (
            <BarChart data={series} format={inr0} axisFormat={inrShort} caption="Subscription payments received each month" />
          )}
        </Card>
      </div>

      <Card title="Recently added" icon={Clock}>
        {d.recent.length === 0 ? <EmptyState title="Nothing yet" /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Institute</th><th>Status</th><th>Added</th></tr></thead>
              <tbody>
                {d.recent.map((t) => (
                  <tr key={t.id}>
                    <td><strong>{t.name}</strong><div className="muted">{t.code}</div></td>
                    <td><Badge tone={t.status === 'active' ? 'green' : 'red'}>{t.status}</Badge></td>
                    <td className="muted">{fmtDate(t.createdAt.slice(0, 10))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

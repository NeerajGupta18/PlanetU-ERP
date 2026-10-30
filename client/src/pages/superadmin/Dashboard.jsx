import { Link } from 'react-router-dom';
import { BarChart3, Clock, Filter, HeartPulse, LayoutDashboard, ListChecks, ListTodo } from 'lucide-react';
import { Badge, Card, PageBanner, CollapsibleCards } from '../../components/ui/Ui.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import { EmptyState, ErrorState } from '../../components/ui/Feedback.jsx';
import { Funnel } from '../../components/dash/Charts.jsx';
import { Freshness, KpiCard, KpiGrid, KpiLoading, useDashboard } from '../../components/dash/KpiCard.jsx';
import { PROCESSES } from '../../config/processes.js';
import { BarChart } from '../../components/ui/Charts.jsx';
import AttentionList from '../../components/campus/AttentionList.jsx';
import { fmtDate } from '../../utils/dates.js';
import { inr0, inrCompact, inrShort, numIn, plural } from '../../utils/kpi.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export default function Dashboard() {
  const { data, loading, error, reload, refresh } = useDashboard('/super-admin/dashboard/overview');
  if (error && !data) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <KpiLoading />;
  return <div className="dash-page"><View d={data} loading={loading} onRefresh={refresh} /></div>;
}

const FLAG = { red: ['Act now', 'red'], amber: ['Watch', 'amber'], green: ['Healthy', 'green'] };
const stepLabel = (key) => PROCESSES.setup.steps.find((s) => s.key === key)?.label || key;

/** The flagship: one row per institute with a flag and the reason, most urgent first. */
function HealthBoard({ rows }) {
  return (
    <Card title="Client health board" icon={HeartPulse} action={<Link to="/super-admin/institutes" className="btn btn--outline btn--sm">Institutes</Link>}>
      <DataTable
        caption="Client health: one row per institute with a flag and the reason" rows={rows}
        empty={{ title: 'No institutes yet', hint: 'Add your first institute to watch its health here.', action: { label: 'Add an institute', to: '/super-admin/institutes' } }}
        columns={[
          { key: 'flag', label: 'Flag', render: (i) => <Badge tone={FLAG[i.flag][1]}>{FLAG[i.flag][0]}</Badge> },
          { key: 'name', label: 'Institute', render: (i) => <><strong>{i.name}</strong>{i.demo && <> <Badge tone="gray">Demo</Badge></>}<div className="muted">{i.code}</div></> },
          { key: 'reason', label: 'Why', render: (i) => i.reason },
          { key: 'people', label: 'Students / staff', num: true, render: (i) => `${numIn(i.students)} / ${numIn(i.employees)}` },
          { key: 'last', label: 'Last active', render: (i) => (i.lastActive ? fmtDate(String(i.lastActive).slice(0, 10)) : 'Never') },
        ]}
      />
    </Card>
  );
}

function SetupProgress({ rows }) {
  const list = rows.filter((i) => i.setup);
  return (
    <Card title="Setup progress" icon={ListChecks}>
      {list.length === 0 ? <EmptyState compact title="Nothing to show" hint="Each institute's seven setup steps show here." /> : (
        <ul className="setup-bars">
          {list.map((i) => (
            <li key={i.id}>
              <span className="setup-bars__name">{i.name}</span>
              <span className="progress" role="progressbar" aria-label={`${i.name} setup`} aria-valuemin={0} aria-valuemax={i.setup.total} aria-valuenow={i.setup.done}><span className="progress__fill" style={{ width: `${(i.setup.done / i.setup.total) * 100}%` }} /></span>
              <small>{i.setup.done === i.setup.total ? 'Ready' : `${i.setup.done} of ${i.setup.total}, next: ${stepLabel(i.setup.current)}`}</small>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function View({ d, loading, onRefresh }) {
  const b = d.billing;
  const o = d.overview;
  const t = o.totals;
  const a = o.assistants;
  const items = [
    ...b.overdue.map((o) => ({ key: `o-${o.tenantId}`, tone: 'bad', title: `${o.name}: ${inr0(o.amount)} overdue`, detail: o.status === 'past_due' ? 'In the grace period' : 'Invoice past its due date', link: '/super-admin/billing' })),
    ...b.trialsEnding.map((t) => ({ key: `t-${t.tenantId}`, tone: 'warn', title: `${t.name}: trial ends ${fmtDate(t.endsOn)}`, detail: 'Help them choose a plan', link: '/super-admin/billing' })),
    ...(b.needsReview > 0 ? [{ key: 'review', tone: 'warn', title: `${plural(b.needsReview, 'online payment')} to check`, detail: 'Paid, but not matched to an invoice yet', link: '/super-admin/billing' }] : []),
    ...b.suspended.map((s) => ({ key: `s-${s.tenantId}`, tone: 'info', title: `${s.name} is suspended`, detail: s.reason || 'No reason recorded', link: '/super-admin/institutes' })),
    ...d.quiet.map((q) => ({ key: `q-${q.id}`, tone: 'info', title: `${q.name}: nobody signed in this week`, detail: q.lastLogin ? `Last sign-in ${fmtDate(String(q.lastLogin).slice(0, 10))}` : 'Never signed in', link: '/super-admin/institutes' })),
  ];
  const series = b.series.map((s) => ({ label: MONTHS[Number(s.month.slice(5)) - 1], full: `${MONTHS[Number(s.month.slice(5)) - 1]} ${s.month.slice(0, 4)}`, value: s.collected }));

  return (
    <CollapsibleCards>
      <PageBanner icon={LayoutDashboard} title="Platform Dashboard" subtitle="Every institute running on PlanetU ERP" />
      <Freshness at={d.generatedAt} loading={loading} onRefresh={onRefresh} />

      <KpiGrid>
        <KpiCard label="Institutes" value={numIn(t.institutes)} to="/super-admin/institutes" meaning="All institutes, including demo ones" sub={`${t.byType.map((x) => `${x.count} ${x.key}`).join(', ')}. ${d.stats.active} active, ${d.stats.suspended} suspended, ${t.demo} demo`} />
        <KpiCard label="Students, all institutes" value={numIn(t.students)} to="/super-admin/institutes" meaning="A count only. No student's record is read here." sub={`${numIn(t.employees)} employees`} />
        <KpiCard label="Average setup done" value={t.setupAverage === null ? null : `${t.setupAverage}%`} to="/super-admin/institutes" meaning="Average share of the seven setup steps finished" sub={`${plural(t.stuck, 'institute')} stuck for over a week`} />
        <KpiCard label="No activity in 7 days" value={numIn(t.quiet)} to="/super-admin/institutes" meaning="Nobody at the institute did anything recorded for 7 days" />
        <KpiCard label="Check-ins due" value={numIn(t.checksDue)} to="/super-admin/institutes" meaning="Institutes at their 30, 60 or 90-day check-in this week" />
        <KpiCard label="Demo requests" value={numIn(o.demoRequests.new)} to="/super-admin/demo-requests" meaning="New requests from the front page" sub={`new. ${numIn(o.messagesWaiting)} chat ${o.messagesWaiting === 1 ? 'message' : 'messages'} waiting`} />
        <KpiCard label="Assistant tokens today" value={numIn(a.tokensToday)} to="/super-admin/institutes" meaning="Tokens used by every institute's assistants today" sub={`Busiest institute ${numIn(a.busiest)} of ${numIn(a.capPerInstitute)}`} />
        <KpiCard label="Public chat tokens today" value={numIn(a.publicToday)} to="/super-admin/demo-requests" meaning="Tokens used by the front page help chat today" sub={`of ${numIn(a.publicCap)} a day`} />
        <KpiCard label="Received this month" value={inrCompact(b.collectedThisMonth)} full={inr0(b.collectedThisMonth)} to="/super-admin/billing" meaning="Subscription payments received this month" sub={`${inr0(b.receivables.overdue)} overdue`} />
      </KpiGrid>

      <HealthBoard rows={o.institutes} />

      <div className="grid-2">
        <SetupProgress rows={o.institutes} />
        <Card title="Demo requests by stage" icon={Filter}>
          <Funnel
            stages={[{ stage: 'new', label: 'New', count: o.demoRequests.new }, { stage: 'contacted', label: 'Contacted', count: o.demoRequests.contacted }, { stage: 'closed', label: 'Closed', count: o.demoRequests.closed }]}
            caption="Demo requests at each stage"
            empty={{ title: 'No demo requests yet', hint: 'Requests from the front page form and chat show here.' }}
          />
        </Card>
      </div>
      <Card title="New institutes, 12 months" icon={BarChart3}>
        <BarChart data={o.newByMonth.map((m) => ({ label: MONTHS[Number(m.month.slice(5)) - 1], full: `${MONTHS[Number(m.month.slice(5)) - 1]} ${m.month.slice(0, 4)}`, value: m.count }))} format={String} caption="Institutes added in each of the last 12 months" height={170} />
      </Card>

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
    </CollapsibleCards>
  );
}

import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AlertTriangle, Banknote, CircleDollarSign, Download, FileText, Landmark, Play, Save, TrendingUp } from 'lucide-react';
import { useFetch } from '../../hooks/useFetch.js';
import { api } from '../../api/http.js';
import { Badge, Card, PageBanner, StatCard, Tabs } from '../../components/ui/Ui.jsx';
import { DataBoundary, EmptyState } from '../../components/ui/Feedback.jsx';
import InstituteBilling from '../../components/billing/InstituteBilling.jsx';
import RecordPayment from '../../components/billing/RecordPayment.jsx';
import { fmtDate } from '../../utils/dates.js';
import { CYCLE_LABEL, INVOICE_STATUS, SUB_STATUS, SUSPEND_REASON, inr, inr0 } from '../../utils/billing.js';

export default function Billing() {
  const [sp, setSp] = useSearchParams();
  const tab = sp.get('tab') || 'overview';
  const open = sp.get('institute') || '';
  const setTab = (t) => setSp({ tab: t });
  const manage = (id) => setSp((cur) => { const n = new URLSearchParams(cur); if (id) n.set('institute', id); else n.delete('institute'); return n; });

  return (
    <>
      <PageBanner icon={CircleDollarSign} title="Billing" subtitle="Charge institutes for their subscription: plans, invoices, payments and who is behind" />
      <Card>
        <Tabs
          tabs={[{ id: 'overview', label: 'Overview' }, { id: 'institutes', label: 'Institutes' }, { id: 'invoices', label: 'Invoices' }, { id: 'plans', label: 'Plans & pricing' }]}
          active={tab} onChange={setTab}
        />
        {tab === 'overview' && <Overview onManage={manage} />}
        {tab === 'institutes' && <Institutes onManage={manage} />}
        {tab === 'invoices' && <Invoices onManage={manage} />}
        {tab === 'plans' && <Plans />}
      </Card>
      {open && <InstituteBilling tenantId={open} onClose={() => manage('')} />}
    </>
  );
}

/* ------------------------------------------------------------------ overview */
function Overview({ onManage }) {
  const { data, loading, error, reload } = useFetch('/super-admin/billing/overview');
  const [run, setRun] = useState({ busy: false, msg: '', err: '' });
  const review = useFetch('/super-admin/billing/review-orders');

  const runNow = async () => {
    setRun({ busy: true, msg: '', err: '' });
    try {
      const { result: r } = await api.post('/super-admin/billing/run');
      setRun({ busy: false, err: '', msg: `Done: ${r.generated} invoice${r.generated === 1 ? '' : 's'} issued, ${r.reminders} reminder${r.reminders === 1 ? '' : 's'} sent, ${r.suspended} suspended${r.blocked.length ? `, ${r.blocked.length} could not be invoiced (billing details missing)` : ''}.` });
      reload();
    } catch (e) { setRun({ busy: false, msg: '', err: e.message }); }
  };

  return (
    <DataBoundary loading={loading} error={error} data={data} reload={reload}>
      {data && (
        <>
          <div className="stats">
            <StatCard value={inr0(data.mrr)} label="Monthly recurring revenue" icon={TrendingUp} tone="indigo" />
            <StatCard value={inr0(data.arr)} label="Annualised (MRR x 12)" icon={Landmark} tone="green" />
            <StatCard value={inr0(data.collected.thisMonth)} label="Collected this month" icon={Banknote} tone="amber" />
            <StatCard value={inr0(data.receivables.overdue)} label={`Overdue (${data.receivables.overdueCount} invoice${data.receivables.overdueCount === 1 ? '' : 's'})`} icon={AlertTriangle} tone={data.receivables.overdue ? 'rose' : 'green'} />
          </div>
          <p className="muted" style={{ margin: '4px 0 14px' }}>
            {data.counts.institutes} institutes: {data.counts.active} paying, {data.counts.trialing} on trial, {data.counts.past_due} past due, {data.counts.suspended} paused.
            Outstanding {inr(data.receivables.outstanding)} across {data.receivables.open} open invoice{data.receivables.open === 1 ? '' : 's'}.
            Collected so far in FY {data.collected.financialYear}: {inr(data.collected.thisFinancialYear)}. MRR excludes GST and per-student extras.
          </p>

          <div className="toolbar">
            <div className="toolbar__filters"><button type="button" className="btn btn--primary btn--sm" disabled={run.busy} onClick={runNow}><Play size={13} /> {run.busy ? 'Running...' : 'Run billing now'}</button></div>
            <span className="muted" style={{ fontSize: 13 }}>Billing also runs by itself every few hours.</span>
          </div>
          {run.msg && <p className="note" role="status">{run.msg}</p>}
          {run.err && <p className="form-error" role="alert">{run.err}</p>}

          {review.data?.orders?.length > 0 && (
            <div className="form-error" role="alert" style={{ marginBottom: 14 }}>
              <strong>{review.data.orders.length} online payment{review.data.orders.length === 1 ? ' needs' : 's need'} your attention.</strong> Money was taken by Razorpay but could not be applied.
              {review.data.orders.map((o) => (
                <div key={o.id} style={{ marginTop: 6, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span>{o.instituteName} · {o.invoiceNumber} · {inr(o.amount)} · {o.razorpayPaymentId} - {o.failureReason}</span>
                  <button type="button" className="btn btn--outline btn--sm" onClick={async () => { const note = window.prompt('How was this resolved? (e.g. Refunded in Razorpay)'); if (note) { await api.post(`/super-admin/billing/review-orders/${o.id}/resolve`, { note }); review.reload(); reload(); } }}>Mark resolved</button>
                </div>
              ))}
            </div>
          )}

          <Series rows={data.series} />

          <div className="grid-2" style={{ marginTop: 14, alignItems: 'start' }}>
            <Attention title="Overdue" items={data.attention.overdue} onManage={onManage} render={(x) => `${inr(x.amount)} overdue${x.status === 'past_due' ? ' · in grace period' : ''}`} tone="red" empty="No overdue invoices." />
            <Attention title="Access paused" items={data.attention.suspended} onManage={onManage} render={(x) => SUSPEND_REASON[x.reason] || 'Paused'} tone="red" empty="Nobody is paused." />
            <Attention title="Trials ending within a week" items={data.attention.trialsEnding} onManage={onManage} render={(x) => `ends ${fmtDate(x.endsOn)}${x.planKey === 'trial' ? ' · no plan chosen' : ''}`} tone="amber" empty="No trials ending soon." />
            <Attention title="Renewing in the next 14 days" items={data.attention.renewalsSoon} onManage={onManage} render={(x) => `paid until ${fmtDate(x.paidUntil)}`} tone="blue" empty="No renewals coming up." />
            <Attention title="Missing billing details" items={data.attention.missingDetails} onManage={onManage} render={() => 'cannot be invoiced until a state is added'} tone="amber" empty="Every paying institute has billing details." />
            <Attention title="Cancelling" items={data.attention.cancelling} onManage={onManage} render={(x) => `ends ${fmtDate(x.paidUntil)}`} tone="gray" empty="Nobody has asked to cancel." />
          </div>
        </>
      )}
    </DataBoundary>
  );
}

function Series({ rows }) {
  if (!rows.length) return null;
  const max = Math.max(1, ...rows.flatMap((r) => [r.invoiced, r.collected]));
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 14 }}>
      <strong>Invoiced and collected, last months</strong>
      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-end', height: 130, marginTop: 10 }}>
        {rows.map((r) => (
          <div key={r.month} style={{ flex: 1, textAlign: 'center' }}>
            <div style={{ display: 'flex', gap: 3, alignItems: 'flex-end', height: 100, justifyContent: 'center' }} title={`${r.month}: invoiced ${inr(r.invoiced)}, collected ${inr(r.collected)}`}>
              <div style={{ width: 16, height: `${(r.invoiced / max) * 100}%`, minHeight: r.invoiced ? 2 : 0, background: '#c7d2fe', borderRadius: 3 }} />
              <div style={{ width: 16, height: `${(r.collected / max) * 100}%`, minHeight: r.collected ? 2 : 0, background: 'var(--green)', borderRadius: 3 }} />
            </div>
            <small className="muted">{r.month.slice(2)}</small>
          </div>
        ))}
      </div>
      <small className="muted"><span style={{ color: '#818cf8' }}>■</span> invoiced &nbsp; <span style={{ color: 'var(--green)' }}>■</span> collected</small>
    </div>
  );
}

function Attention({ title, items, render, onManage, tone, empty }) {
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}><strong>{title}</strong><Badge tone={items.length ? tone : 'gray'}>{items.length}</Badge></div>
      {items.length === 0 ? <p className="muted" style={{ margin: '8px 0 0', fontSize: 13 }}>{empty}</p> : (
        <ul style={{ listStyle: 'none', padding: 0, margin: '8px 0 0' }}>
          {items.map((x) => (
            <li key={x.tenantId} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '4px 0', fontSize: 13.5 }}>
              <span><strong>{x.name}</strong><br /><span className="muted">{render(x)}</span></span>
              <button type="button" className="btn btn--outline btn--sm" onClick={() => onManage(x.tenantId)}>Open</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ institutes */
function Institutes({ onManage }) {
  const { data, loading, error, reload } = useFetch('/super-admin/billing/subscriptions');
  return (
    <DataBoundary loading={loading} error={error} data={data} reload={reload}>
      {data && (data.subscriptions.length === 0 ? <EmptyState title="No billable institutes yet" hint="Institutes created with a plan appear here. Demo institutes are never billed." /> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Institute</th><th>Plan</th><th>Status</th><th>Paid until</th><th style={{ textAlign: 'right' }}>Students</th><th style={{ textAlign: 'right' }}>MRR</th><th style={{ textAlign: 'right' }}>Unpaid</th><th /></tr></thead>
            <tbody>
              {data.subscriptions.map((s) => {
                const st = SUB_STATUS[s.status];
                return (
                  <tr key={s.tenantId}>
                    <td><strong>{s.name}</strong><div className="muted">{s.code}</div>{!s.detailsComplete && s.planKey !== 'trial' && <Badge tone="amber">Billing details missing</Badge>}</td>
                    <td>{s.planName}{s.planKey !== 'trial' && <div className="muted">{CYCLE_LABEL[s.cycle]}{s.discountPercent ? ` · ${s.discountPercent}% off` : ''}{s.customMonthlyPrice !== null ? ' · custom price' : ''}</div>}</td>
                    <td><Badge tone={st.tone}>{st.label}</Badge>{s.cancelAtPeriodEnd && <div><Badge tone="amber">Cancelling</Badge></div>}{s.status === 'suspended' && <div className="muted">{SUSPEND_REASON[s.suspendedReason]}</div>}</td>
                    <td className="muted">{s.status === 'trialing' ? `trial ends ${fmtDate(s.trialEndsOn)}` : fmtDate(s.paidUntil)}</td>
                    <td style={{ textAlign: 'right' }}>{s.students}</td>
                    <td style={{ textAlign: 'right' }}>{s.mrr ? inr0(s.mrr) : '-'}</td>
                    <td style={{ textAlign: 'right' }}>{s.openAmount ? <span style={{ color: s.overdueAmount ? 'var(--red)' : undefined, fontWeight: 600 }}>{inr(s.openAmount)}</span> : '-'}</td>
                    <td><button type="button" className="btn btn--outline btn--sm" onClick={() => onManage(s.tenantId)}>Manage</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
    </DataBoundary>
  );
}

/* ------------------------------------------------------------------ invoices */
function Invoices({ onManage }) {
  const [f, setF] = useState({ status: '', search: '', from: '', to: '' });
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
  const { data, loading, error, reload } = useFetch(`/super-admin/billing/invoices${qs ? `?${qs}` : ''}`);
  const [pay, setPay] = useState(null);
  const [msg, setMsg] = useState('');
  const set = (k) => (e) => setF((c) => ({ ...c, [k]: e.target.value }));

  const voidIt = async (i) => {
    const reason = window.prompt(`Void ${i.number}? Say why (it stays on record):`);
    if (!reason) return;
    try { await api.post(`/super-admin/billing/invoices/${i.id}/void`, { reason }); reload(); } catch (e) { window.alert(e.message); }
  };
  const remind = async (i) => {
    try { const r = await api.post(`/super-admin/billing/invoices/${i.id}/remind`); setMsg(`Reminder sent to ${i.instituteName} (${r.sent} recipient${r.sent === 1 ? '' : 's'}).`); } catch (e) { window.alert(e.message); }
  };

  return (
    <>
      <div className="toolbar">
        <div className="toolbar__filters">
          <select className="input" value={f.status} onChange={set('status')} aria-label="Status" style={{ width: 'auto' }}>
            <option value="">All invoices</option><option value="open">Unpaid</option><option value="overdue">Overdue</option><option value="paid">Paid</option><option value="void">Void</option>
          </select>
          <input className="input" placeholder="Invoice no. or institute" value={f.search} onChange={set('search')} style={{ width: 210 }} aria-label="Search" />
          <input className="input" type="date" value={f.from} onChange={set('from')} aria-label="From date" style={{ width: 'auto' }} />
          <input className="input" type="date" value={f.to} onChange={set('to')} aria-label="To date" style={{ width: 'auto' }} />
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <a className="btn btn--outline btn--sm" href={`/api/super-admin/billing/invoices?format=xlsx${qs ? `&${qs}` : ''}`} download><Download size={13} /> Excel register</a>
          <a className="btn btn--outline btn--sm" href={`/api/super-admin/billing/invoices?format=csv${qs ? `&${qs}` : ''}`} download><Download size={13} /> CSV</a>
        </div>
      </div>
      {msg && <p className="note" role="status">{msg}</p>}
      <DataBoundary loading={loading} error={error} data={data} reload={reload}>
        {data && (data.invoices.length === 0 ? <EmptyState title="No invoices match" /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Invoice</th><th>Institute</th><th>Period</th><th style={{ textAlign: 'right' }}>Taxable</th><th style={{ textAlign: 'right' }}>GST</th><th style={{ textAlign: 'right' }}>Total</th><th>Status</th><th /></tr></thead>
              <tbody>
                {data.invoices.map((i) => (
                  <tr key={i.id}>
                    <td><strong>{i.number}</strong><div className="muted">{fmtDate(i.issueDate)}</div></td>
                    <td><a href="#institute" onClick={(e) => { e.preventDefault(); onManage(i.tenantId); }}>{i.instituteName}</a></td>
                    <td className="muted">{fmtDate(i.periodStart)} to {fmtDate(i.periodEnd)}</td>
                    <td style={{ textAlign: 'right' }}>{inr(i.taxable)}</td>
                    <td style={{ textAlign: 'right' }}>{inr(i.cgst + i.sgst + i.igst)}</td>
                    <td style={{ textAlign: 'right' }}><strong>{inr(i.total)}</strong></td>
                    <td><Badge tone={i.overdue ? 'red' : INVOICE_STATUS[i.status].tone}>{i.overdue ? 'Overdue' : INVOICE_STATUS[i.status].label}</Badge>{i.status === 'open' && <div className="muted">due {fmtDate(i.dueDate)}</div>}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <a className="btn btn--outline btn--sm" href={`/api/super-admin/billing/invoices/${i.id}/pdf`} target="_blank" rel="noreferrer" aria-label={`PDF for ${i.number}`}><FileText size={13} /></a>
                        {i.status === 'open' && <button type="button" className="btn btn--primary btn--sm" onClick={() => setPay(i)}>Record payment</button>}
                        {i.status === 'open' && <button type="button" className="btn btn--outline btn--sm" onClick={() => remind(i)}>Remind</button>}
                        {i.status === 'open' && <button type="button" className="btn btn--outline btn--sm" onClick={() => voidIt(i)}>Void</button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </DataBoundary>
      {pay && <RecordPayment invoice={pay} onClose={() => setPay(null)} onDone={() => { setPay(null); reload(); }} />}
    </>
  );
}

/* ------------------------------------------------------------------ plans */
function Plans() {
  const { data, loading, error, reload } = useFetch('/super-admin/billing/plans');
  return (
    <DataBoundary loading={loading} error={error} data={data} reload={reload}>
      {data && (
        <>
          <p className="muted" style={{ marginTop: 0 }}>
            All prices are in rupees <strong>before GST</strong> ({data.gstRate}% is added on every invoice; set it with BILLING_GST_RATE). New institutes get a {data.trialDays}-day free trial.
            A price change applies to <strong>future invoices only</strong>: invoices already issued keep the price they were issued at.
          </p>
          <div className="grid-2" style={{ alignItems: 'start' }}>
            {data.plans.filter((p) => p.key !== 'trial').map((p) => <PlanEditor key={p.key} plan={p} onSaved={reload} />)}
          </div>
        </>
      )}
    </DataBoundary>
  );
}

function PlanEditor({ plan, onSaved }) {
  const [f, setF] = useState({ name: plan.name, monthlyPrice: plan.monthlyPrice, annualPrice: plan.annualPrice, includedStudents: plan.includedStudents, extraStudentPrice: plan.extraStudentPrice, description: plan.description, features: plan.features.join('\n'), selectable: plan.selectable });
  const [state, setState] = useState({ busy: false, err: '', ok: '' });
  const set = (k) => (e) => setF((c) => ({ ...c, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const save = async (e) => {
    e.preventDefault(); setState({ busy: true, err: '', ok: '' });
    try {
      await api.put(`/super-admin/billing/plans/${plan.key}`, {
        name: f.name, description: f.description, monthlyPrice: Number(f.monthlyPrice), annualPrice: Number(f.annualPrice), includedStudents: Number(f.includedStudents),
        extraStudentPrice: Number(f.extraStudentPrice), features: f.features.split('\n').map((x) => x.trim()).filter(Boolean), selectable: f.selectable,
      });
      setState({ busy: false, err: '', ok: 'Saved. Future invoices use these prices.' }); onSaved();
    } catch (ex) { setState({ busy: false, err: ex.message, ok: '' }); }
  };
  const saving = Math.max(0, Number(f.monthlyPrice) * 12 - Number(f.annualPrice));
  return (
    <form onSubmit={save} style={{ border: '1px solid var(--border)', borderRadius: 14, padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><strong style={{ fontSize: 16 }}>{plan.key}</strong><label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}><input type="checkbox" checked={f.selectable} onChange={set('selectable')} /> Institutes can choose it</label></div>
      {state.err && <p className="form-error" role="alert">{state.err}</p>}
      {state.ok && <p className="note" role="status">{state.ok}</p>}
      <div className="fields">
        <div className="form-field form-field--full"><label className="label" htmlFor={`pn-${plan.key}`}>Name</label><input id={`pn-${plan.key}`} className="input" value={f.name} onChange={set('name')} maxLength={40} /></div>
        <div className="form-field"><label className="label">Monthly price</label><input className="input" type="number" min="1" step="0.01" value={f.monthlyPrice} onChange={set('monthlyPrice')} aria-label={`${plan.key} monthly price`} /></div>
        <div className="form-field"><label className="label">Annual price</label><input className="input" type="number" min="1" step="0.01" value={f.annualPrice} onChange={set('annualPrice')} aria-label={`${plan.key} annual price`} /></div>
        <div className="form-field"><label className="label">Students included</label><input className="input" type="number" min="0" value={f.includedStudents} onChange={set('includedStudents')} aria-label={`${plan.key} included students`} /></div>
        <div className="form-field"><label className="label">Per extra student / month</label><input className="input" type="number" min="0" step="0.01" value={f.extraStudentPrice} onChange={set('extraStudentPrice')} aria-label={`${plan.key} extra student price`} /></div>
        <div className="form-field form-field--full"><label className="label">Short description</label><input className="input" value={f.description} onChange={set('description')} maxLength={300} /></div>
        <div className="form-field form-field--full"><label className="label">Features (one per line)</label><textarea className="input" rows={4} value={f.features} onChange={set('features')} /></div>
      </div>
      <small className="muted">Annual saves {inr0(saving)} against twelve monthly payments{Number(f.monthlyPrice) ? ` (${Math.round((saving / (Number(f.monthlyPrice) * 12)) * 100)}% off)` : ''}.</small>
      <div className="form-actions"><button className="btn btn--primary btn--sm" disabled={state.busy}><Save size={14} /> Save {plan.key}</button></div>
    </form>
  );
}

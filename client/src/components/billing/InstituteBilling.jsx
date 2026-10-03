import { useState } from 'react';
import { FileText, Receipt, Save } from 'lucide-react';
import { useFetch } from '../../hooks/useFetch.js';
import { api } from '../../api/http.js';
import { Badge } from '../ui/Ui.jsx';
import { DataBoundary } from '../ui/Feedback.jsx';
import Modal from '../ui/Modal.jsx';
import RecordPayment from './RecordPayment.jsx';
import { fmtDate } from '../../utils/dates.js';
import { CYCLE_LABEL, INVOICE_STATUS, SUB_STATUS, SUSPEND_REASON, inr } from '../../utils/billing.js';

/** The vendor's workbench for ONE institute: subscription terms, billing details, and its invoices. */
export default function InstituteBilling({ tenantId, onClose }) {
  const { data, loading, error, reload } = useFetch(`/super-admin/billing/tenants/${tenantId}`);
  return (
    <Modal open title={data ? `Billing: ${data.tenant.name}` : 'Billing'} onClose={onClose} width={860}>
      <DataBoundary loading={loading} error={error} data={data} reload={reload}>
        {data && <Body d={data} tenantId={tenantId} reload={reload} />}
      </DataBoundary>
    </Modal>
  );
}

function Body({ d, tenantId, reload }) {
  const s = d.subscription;
  const st = SUB_STATUS[s.status];
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [pay, setPay] = useState(null);
  const run = async (fn, ok) => {
    setBusy(true); setErr(''); setMsg('');
    try { await fn(); if (ok) setMsg(ok); await reload(); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <>
      <div className="badges" style={{ marginBottom: 10 }}>
        <Badge tone={st.tone}>{st.label}{s.status === 'suspended' ? `: ${SUSPEND_REASON[s.suspendedReason]}` : ''}</Badge>
        <Badge tone="purple">{d.plan?.name}{s.planKey !== 'trial' ? ` · ${CYCLE_LABEL[s.cycle]}` : ''}</Badge>
        <Badge tone="gray">{d.students} active students</Badge>
        <Badge tone="gray">{s.status === 'trialing' ? `trial ends ${fmtDate(s.trialEndsOn)}` : `paid until ${fmtDate(s.paidUntil)}`}</Badge>
        {s.pendingPlanKey && <Badge tone="amber">moving to {s.pendingPlanKey} at renewal</Badge>}
        {d.profileGaps.length > 0 && <Badge tone="amber">missing: {d.profileGaps.join(', ')}</Badge>}
      </div>
      {msg && <p className="note" role="status">{msg}</p>}
      {err && <p className="form-error" role="alert">{err}</p>}

      <Terms d={d} tenantId={tenantId} busy={busy} run={run} />
      <Profile d={d} tenantId={tenantId} busy={busy} run={run} />

      <h3 className="label" style={{ marginTop: 20 }}>Invoices</h3>
      <div className="toolbar">
        <span className="muted" style={{ fontSize: 13 }}>
          {d.estimate ? `Next invoice about ${inr(d.estimate.taxable)} + ${d.estimate.gstRate}% GST${d.nextInvoiceOn ? `, issued ${fmtDate(d.nextInvoiceOn)}` : ''}.` : 'No plan chosen yet, so nothing can be invoiced.'}
        </span>
        <button type="button" className="btn btn--outline btn--sm" disabled={busy || !d.estimate} onClick={() => run(() => api.post(`/super-admin/billing/tenants/${tenantId}/invoices`), 'Invoice issued.')}><FileText size={13} /> Issue next invoice now</button>
      </div>
      {d.invoices.length === 0 ? <p className="muted">No invoices yet.</p> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Invoice</th><th>Period</th><th style={{ textAlign: 'right' }}>Total</th><th>Status</th><th /></tr></thead>
            <tbody>
              {d.invoices.map((i) => (
                <tr key={i.id}>
                  <td><strong>{i.number}</strong><div className="muted">{fmtDate(i.issueDate)}</div></td>
                  <td className="muted">{fmtDate(i.periodStart)} to {fmtDate(i.periodEnd)}</td>
                  <td style={{ textAlign: 'right' }}>{inr(i.total)}</td>
                  <td><Badge tone={i.overdue ? 'red' : INVOICE_STATUS[i.status].tone}>{i.overdue ? 'Overdue' : INVOICE_STATUS[i.status].label}</Badge></td>
                  <td>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <a className="btn btn--outline btn--sm" href={`/api/super-admin/billing/invoices/${i.id}/pdf`} target="_blank" rel="noreferrer" aria-label={`PDF for ${i.number}`}><FileText size={13} /></a>
                      {i.status === 'open' && <button type="button" className="btn btn--primary btn--sm" onClick={() => setPay(i)}><Receipt size={13} /> Record payment</button>}
                      {i.status === 'open' && <button type="button" className="btn btn--outline btn--sm" onClick={() => { const reason = window.prompt(`Void ${i.number}? Say why:`); if (reason) run(() => api.post(`/super-admin/billing/invoices/${i.id}/void`, { reason }), 'Invoice voided.'); }}>Void</button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pay && <RecordPayment invoice={pay} onClose={() => setPay(null)} onDone={() => { setPay(null); setMsg('Payment recorded.'); reload(); }} />}
    </>
  );
}

function Terms({ d, tenantId, busy, run }) {
  const s = d.subscription;
  const [f, setF] = useState({
    planKey: s.planKey, cycle: s.cycle, discountPercent: s.discountPercent, customMonthlyPrice: s.customMonthlyPrice ?? '', graceDays: s.graceDays, cancelAtPeriodEnd: s.cancelAtPeriodEnd,
    trialEndsOn: s.trialEndsOn || '', extendUntil: '',
  });
  const set = (k) => (e) => setF((c) => ({ ...c, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const save = (e) => {
    e.preventDefault();
    const body = {
      planKey: f.planKey, cycle: f.cycle, discountPercent: Number(f.discountPercent || 0), graceDays: Number(f.graceDays), cancelAtPeriodEnd: f.cancelAtPeriodEnd,
      customMonthlyPrice: f.customMonthlyPrice === '' ? null : Number(f.customMonthlyPrice),
      ...(s.status === 'trialing' && f.trialEndsOn && f.trialEndsOn !== s.trialEndsOn ? { trialEndsOn: f.trialEndsOn } : {}),
      ...(f.extendUntil ? { extendUntil: f.extendUntil } : {}),
    };
    run(() => api.put(`/super-admin/billing/tenants/${tenantId}/subscription`, body), 'Subscription updated. Price changes apply from the next invoice.');
  };
  return (
    <form onSubmit={save} style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 14, marginTop: 10 }}>
      <strong>Subscription terms</strong>
      <div className="fields" style={{ marginTop: 8 }}>
        <div className="form-field"><label className="label" htmlFor="t-plan">Plan</label>
          <select id="t-plan" className="input" value={f.planKey} onChange={set('planKey')}>{d.plans.map((p) => <option key={p.key} value={p.key} disabled={p.key === 'trial' && s.status !== 'trialing'}>{p.name}</option>)}</select></div>
        <div className="form-field"><label className="label" htmlFor="t-cycle">Billing cycle</label>
          <select id="t-cycle" className="input" value={f.cycle} onChange={set('cycle')}><option value="monthly">Monthly</option><option value="annual">Annual</option></select></div>
        <div className="form-field"><label className="label" htmlFor="t-disc">Discount %</label><input id="t-disc" className="input" type="number" min="0" max="100" step="0.5" value={f.discountPercent} onChange={set('discountPercent')} /></div>
        <div className="form-field"><label className="label" htmlFor="t-custom">Agreed monthly price (optional)</label><input id="t-custom" className="input" type="number" min="0" step="0.01" placeholder="Plan price" value={f.customMonthlyPrice} onChange={set('customMonthlyPrice')} /></div>
        <div className="form-field"><label className="label" htmlFor="t-grace">Grace days after due date</label><input id="t-grace" className="input" type="number" min="0" max="60" value={f.graceDays} onChange={set('graceDays')} /></div>
        {s.status === 'trialing' && <div className="form-field"><label className="label" htmlFor="t-trial">Trial ends</label><input id="t-trial" className="input" type="date" value={f.trialEndsOn} onChange={set('trialEndsOn')} /></div>}
        <div className="form-field"><label className="label" htmlFor="t-ext">Courtesy: paid until</label><input id="t-ext" className="input" type="date" value={f.extendUntil} min={new Date().toISOString().slice(0, 10)} onChange={set('extendUntil')} /></div>
        <div className="form-field"><label className="label">&nbsp;</label><label style={{ display: 'flex', gap: 6, alignItems: 'center', paddingTop: 8 }}><input type="checkbox" checked={f.cancelAtPeriodEnd} onChange={set('cancelAtPeriodEnd')} /> Cancel at end of paid period</label></div>
      </div>
      <small className="muted">A courtesy date gives access until then without payment, and lifts a pause. Plan and price changes apply from the next invoice (nothing is prorated).</small>
      <div className="form-actions"><button className="btn btn--primary btn--sm" disabled={busy}><Save size={14} /> Save terms</button></div>
    </form>
  );
}

function Profile({ d, tenantId, busy, run }) {
  const [f, setF] = useState({ ...d.profile });
  const set = (k) => (e) => setF((c) => ({ ...c, [k]: e.target.value }));
  const save = (e) => { e.preventDefault(); run(() => api.put(`/super-admin/billing/tenants/${tenantId}/profile`, f), 'Billing details saved.'); };
  return (
    <form onSubmit={save} style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 14, marginTop: 10 }}>
      <strong>Billing details (printed on invoices)</strong>
      <div className="fields" style={{ marginTop: 8 }}>
        <div className="form-field form-field--full"><label className="label" htmlFor="p-legal">Legal name</label><input id="p-legal" className="input" value={f.legalName} onChange={set('legalName')} /></div>
        <div className="form-field"><label className="label" htmlFor="p-state">State</label>
          <select id="p-state" className="input" value={f.state} onChange={set('state')}><option value="">Choose...</option>{d.states.map((x) => <option key={x.code} value={x.name}>{x.name}</option>)}</select></div>
        <div className="form-field"><label className="label" htmlFor="p-gst">GSTIN</label><input id="p-gst" className="input" value={f.gstin} onChange={set('gstin')} maxLength={15} /></div>
        <div className="form-field form-field--full"><label className="label" htmlFor="p-addr">Address</label><input id="p-addr" className="input" value={f.address} onChange={set('address')} /></div>
        <div className="form-field"><label className="label" htmlFor="p-city">City</label><input id="p-city" className="input" value={f.city} onChange={set('city')} /></div>
        <div className="form-field"><label className="label" htmlFor="p-pin">PIN</label><input id="p-pin" className="input" value={f.pincode} onChange={set('pincode')} maxLength={6} /></div>
        <div className="form-field"><label className="label" htmlFor="p-mail">Billing email</label><input id="p-mail" className="input" type="email" value={f.billingEmail} onChange={set('billingEmail')} /></div>
        <div className="form-field"><label className="label" htmlFor="p-phone">Phone</label><input id="p-phone" className="input" value={f.billingPhone} onChange={set('billingPhone')} /></div>
      </div>
      <div className="form-actions"><button className="btn btn--outline btn--sm" disabled={busy}><Save size={14} /> Save details</button></div>
    </form>
  );
}

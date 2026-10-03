import { useState } from 'react';
import { AlertTriangle, Banknote, CheckCircle2, CreditCard, Download, FileText, Save, ShieldCheck } from 'lucide-react';
import { useFetch } from '../../hooks/useFetch.js';
import { api } from '../../api/http.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { loadRazorpay } from '../../hooks/useRazorpay.js';
import { Badge, Card, PageBanner } from '../../components/ui/Ui.jsx';
import { DataBoundary } from '../../components/ui/Feedback.jsx';
import Modal from '../../components/ui/Modal.jsx';
import PlanPicker from '../../components/billing/PlanPicker.jsx';
import { fmtDate } from '../../utils/dates.js';
import { CYCLE_LABEL, INVOICE_STATUS, SUB_STATUS, inr } from '../../utils/billing.js';

export default function Billing() {
  const { refresh } = useAuth();
  const { data, loading, error, reload } = useFetch('/admin/billing');
  const [notice, setNotice] = useState(null);

  // After any change the session is re-read too: it carries the banner and the "access paused" flag
  const changed = async (msg) => { if (msg) setNotice(msg); await reload(); refresh().catch(() => {}); };

  return (
    <>
      <PageBanner icon={CreditCard} title="Subscription & billing" subtitle="Your plan, invoices and billing details" />
      <DataBoundary loading={loading} error={error} data={data} reload={reload}>
        {data && <View d={data} notice={notice} onChanged={changed} />}
      </DataBoundary>
    </>
  );
}

function View({ d, notice, onChanged }) {
  const { subscription: s, plan, students, estimate } = d;
  const [planModal, setPlanModal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const st = SUB_STATUS[s.status];
  const included = plan?.includedStudents || 0;
  const over = Math.max(0, students - included);

  const act = async (fn, msg) => {
    setBusy(true); setErr('');
    try { await fn(); await onChanged(msg); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const cancel = () => { if (window.confirm(`Cancel your subscription? You keep full access until ${fmtDate(s.paidUntil)}, and are not invoiced again. You can change your mind before then.`)) act(() => api.put('/admin/billing/change', { cancelAtPeriodEnd: true }), 'Your subscription will end on ' + fmtDate(s.paidUntil) + '.'); };

  return (
    <>
      {d.locked && (
        <div className="form-error" role="alert" style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: 2 }} />
          <span>
            <strong>Access to your institute is paused ({d.lockReason}).</strong> Nothing has been deleted. {d.openInvoices.length ? 'Pay the invoice below' : 'Choose a plan'} and everyone is let back in immediately.
          </span>
        </div>
      )}
      {notice && <p className="note" role="status" style={{ background: '#dcfce7', borderColor: '#bbf7d0' }}><CheckCircle2 size={14} style={{ verticalAlign: '-2px' }} /> {notice}</p>}
      {err && <p className="form-error" role="alert">{err}</p>}

      <div className="grid-2" style={{ alignItems: 'start' }}>
        <Card title="Your subscription" icon={ShieldCheck}>
          <div className="badges" style={{ marginBottom: 12 }}>
            <Badge tone={st.tone}>{st.label}</Badge>
            <Badge tone="purple">{plan?.name}{s.planKey !== 'trial' ? ` · ${CYCLE_LABEL[s.cycle]}` : ''}</Badge>
            {s.cancelAtPeriodEnd && <Badge tone="amber">Ends {fmtDate(s.paidUntil)}</Badge>}
          </div>
          <dl className="kv">
            {s.planKey === 'trial'
              ? <><dt>Trial ends</dt><dd>{fmtDate(s.trialEndsOn)}</dd></>
              : <><dt>{s.status === 'trialing' ? 'Trial ends' : 'Paid until'}</dt><dd>{s.paidUntil ? fmtDate(s.paidUntil) : '-'}</dd></>}
            {d.nextInvoiceOn && <><dt>Next invoice</dt><dd>{fmtDate(d.nextInvoiceOn)}</dd></>}
            {s.pendingPlanKey && <><dt>Changing to</dt><dd>{d.plans.find((p) => p.key === s.pendingPlanKey)?.name} ({CYCLE_LABEL[s.pendingCycle || s.cycle]}) from the next invoice</dd></>}
            {s.discountPercent > 0 && <><dt>Your discount</dt><dd>{s.discountPercent}%</dd></>}
            {s.customMonthlyPrice !== null && <><dt>Your agreed price</dt><dd>{inr(s.customMonthlyPrice)} per month</dd></>}
          </dl>

          <h3 className="label" style={{ marginTop: 18 }}>Students</h3>
          <div className="bars__track" role="img" aria-label={`${students} students of ${included} included`}>
            <div className={`bars__fill bars__fill--${over ? 'warn' : 'good'}`} style={{ width: `${Math.min(100, included ? (students / included) * 100 : 0)}%` }} />
          </div>
          <small className="muted">
            {students} active of {included.toLocaleString('en-IN')} included in your plan.
            {over > 0 && ` ${over} above the allowance are charged at ${inr(plan.extraStudentPrice)} per student per month.`}
          </small>

          {estimate && d.openInvoices.length === 0 && (
            <p className="note">
              Your next invoice will be about <strong>{inr(estimate.taxable)}</strong> plus {estimate.gstRate}% GST
              {s.pendingPlanKey || s.cycle ? ` (${CYCLE_LABEL[estimate.cycle]} ${d.plans.find((p) => p.key === estimate.planKey)?.name})` : ''}, based on your students when it is issued.
            </p>
          )}

          <div className="form-actions" style={{ justifyContent: 'flex-start' }}>
            <button type="button" className="btn btn--primary btn--sm" disabled={busy || (!d.profile.legalName)} onClick={() => setPlanModal(true)}>
              {s.planKey === 'trial' || s.status === 'suspended' ? 'Choose a plan' : 'Change plan'}
            </button>
            {s.cancelAtPeriodEnd
              ? <button type="button" className="btn btn--outline btn--sm" disabled={busy} onClick={() => act(() => api.put('/admin/billing/change', { cancelAtPeriodEnd: false }), 'Your subscription will continue.')}>Keep my subscription</button>
              : s.planKey !== 'trial' && s.status !== 'suspended' && <button type="button" className="btn btn--outline btn--sm" disabled={busy} onClick={cancel}>Cancel subscription</button>}
          </div>
        </Card>

        <OpenInvoices d={d} onChanged={onChanged} />
      </div>

      <Details d={d} onSaved={() => onChanged('Billing details saved.')} />

      <Card title="Invoices" icon={FileText}>
        {d.invoices.length === 0 ? <p className="muted" style={{ margin: 0 }}>No invoices yet. Your first one is issued shortly before your trial ends.</p> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Invoice</th><th>Date</th><th>Period</th><th style={{ textAlign: 'right' }}>Amount</th><th>Status</th><th /></tr></thead>
              <tbody>
                {d.invoices.map((i) => (
                  <tr key={i.id}>
                    <td><strong>{i.number}</strong></td>
                    <td className="muted">{fmtDate(i.issueDate)}</td>
                    <td className="muted">{fmtDate(i.periodStart)} to {fmtDate(i.periodEnd)}</td>
                    <td style={{ textAlign: 'right' }}>{inr(i.total)}</td>
                    <td><Badge tone={i.overdue ? 'red' : INVOICE_STATUS[i.status].tone}>{i.overdue ? 'Overdue' : INVOICE_STATUS[i.status].label}</Badge></td>
                    <td><a className="btn btn--outline btn--sm" href={`/api/admin/billing/invoices/${i.id}/pdf`} target="_blank" rel="noreferrer"><Download size={13} /> PDF</a></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {planModal && (
        <Modal open title={s.planKey === 'trial' || s.status === 'suspended' ? 'Choose your plan' : 'Change your plan'} onClose={() => setPlanModal(false)} width={760}>
          <PlanPicker
            plans={d.plans.filter((p) => p.selectable)} current={s.planKey} currentCycle={s.cycle} students={students} gstRate={d.gstRate}
            immediate={s.planKey === 'trial' || s.status === 'suspended'} busy={busy}
            onPick={(planKey, cycle) => act(async () => {
              if (s.planKey === 'trial' || s.status === 'suspended') await api.post('/admin/billing/choose-plan', { planKey, cycle });
              else await api.put('/admin/billing/change', { planKey, cycle });
              setPlanModal(false);
            }, s.planKey === 'trial' || s.status === 'suspended' ? 'Your invoice is ready below. Pay it to start your subscription.' : 'Done. Your new plan starts from your next invoice.')}
          />
        </Modal>
      )}
    </>
  );
}

function OpenInvoices({ d, onChanged }) {
  const [busyId, setBusyId] = useState('');
  const [err, setErr] = useState('');
  const [result, setResult] = useState(null);

  async function pay(inv) {
    setBusyId(inv.id); setErr(''); setResult(null);
    try {
      if (!(await loadRazorpay())) throw new Error('Could not load the secure payment form. Check your internet connection and try again.');
      const order = await api.post(`/admin/billing/invoices/${inv.id}/order`);
      const rzp = new window.Razorpay({
        key: order.keyId, order_id: order.orderId, amount: order.amountPaise, currency: order.currency,
        name: d.payTo.name || 'PlanetU ERP', description: `Invoice ${inv.number}`, prefill: order.prefill, theme: { color: '#4029c9' },
        modal: { ondismiss: () => setBusyId('') },
        handler: async (resp) => {
          try {
            const r = await api.post('/admin/billing/verify', resp);
            setResult(r.status);
            await onChanged(r.status === 'paid' ? `Payment received for ${inv.number}. Thank you!` : null);
          } catch { setResult('unconfirmed'); await onChanged(null); } finally { setBusyId(''); }
        },
      });
      rzp.on('payment.failed', (r) => { setErr(r?.error?.description || 'The payment did not go through. You have not been charged. Please try again.'); setBusyId(''); });
      rzp.open();
    } catch (e) { setErr(e.message); setBusyId(''); }
  }

  return (
    <Card title="Pay your invoice" icon={Banknote}>
      {err && <p className="form-error" role="alert">{err}</p>}
      {(result === 'pending' || result === 'unconfirmed') && <p className="note">We have your payment and are waiting for the bank to confirm. This page updates by itself; please do not pay again.</p>}
      {result === 'needs_review' && <p className="note">Your payment went through but could not be applied automatically. We will sort it out; please do not pay again.</p>}
      {d.openInvoices.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}><CheckCircle2 size={14} style={{ verticalAlign: '-2px', color: 'var(--green)' }} /> Nothing to pay right now.</p>
      ) : d.openInvoices.map((inv) => (
        <div key={inv.id} style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 14, marginBottom: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
            <div>
              <strong>{inv.number}</strong>
              <div className="muted" style={{ fontSize: 13 }}>{fmtDate(inv.periodStart)} to {fmtDate(inv.periodEnd)}</div>
              <div style={{ marginTop: 4 }}>
                {inv.overdue
                  ? <Badge tone="red">Overdue by {inv.daysOverdue} day{inv.daysOverdue === 1 ? '' : 's'}</Badge>
                  : <Badge tone="amber">Due {fmtDate(inv.dueDate)}</Badge>}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 22, fontWeight: 800 }}>{inr(inv.total)}</div>
              <div className="muted" style={{ fontSize: 12 }}>including GST</div>
            </div>
          </div>
          <div className="form-actions" style={{ justifyContent: 'flex-start', marginTop: 10 }}>
            {d.online.enabled && <button type="button" className="btn btn--primary btn--sm" disabled={!!busyId} onClick={() => pay(inv)}><CreditCard size={14} /> {busyId === inv.id ? 'Opening...' : 'Pay now'}</button>}
            <a className="btn btn--outline btn--sm" href={`/api/admin/billing/invoices/${inv.id}/pdf`} target="_blank" rel="noreferrer"><FileText size={14} /> Invoice</a>
          </div>
        </div>
      ))}
      {d.openInvoices.length > 0 && (
        <details style={{ marginTop: 6 }}>
          <summary style={{ cursor: 'pointer', fontWeight: 600 }}>{d.online.enabled ? 'Prefer a bank transfer?' : 'How to pay'}</summary>
          <p className="note" style={{ marginBottom: 0 }}>
            {d.payTo.bank || d.payTo.upi ? <>{d.payTo.bank && <>Bank: {d.payTo.bank}<br /></>}{d.payTo.upi && <>UPI: {d.payTo.upi}<br /></>}Use the invoice number as the payment reference.</> : `Contact ${d.payTo.name}${d.payTo.email ? ` at ${d.payTo.email}` : ''} for payment details.`}
            {' '}We record transfers within one working day, and your access is restored as soon as we do.
          </p>
        </details>
      )}
    </Card>
  );
}

function Details({ d, onSaved }) {
  const [f, setF] = useState({ ...d.profile });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k) => (e) => setF((c) => ({ ...c, [k]: e.target.value }));
  const gaps = d.profileGaps;

  const save = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    try { await api.put('/admin/billing/profile', f); await onSaved(); } catch (ex) { setErr(ex.message); } finally { setBusy(false); }
  };

  return (
    <Card title="Billing details" icon={FileText}>
      <p className="muted" style={{ marginTop: 0 }}>These appear on your GST invoices. The state decides whether GST is shown as CGST + SGST or IGST.</p>
      {gaps.length > 0 && <p className="form-error" role="alert">Please add your {gaps.join(' and ')} so invoices can be issued.</p>}
      {err && <p className="form-error" role="alert">{err}</p>}
      <form onSubmit={save}>
        <div className="fields">
          <div className="form-field form-field--full"><label className="label" htmlFor="b-legal">Legal name of the institute / trust</label><input id="b-legal" className="input" value={f.legalName} onChange={set('legalName')} maxLength={150} /></div>
          <div className="form-field"><label className="label" htmlFor="b-state">State</label>
            <select id="b-state" className="input" value={f.state} onChange={set('state')}><option value="">Choose...</option>{d.states.map((s) => <option key={s.code} value={s.name}>{s.name}</option>)}</select></div>
          <div className="form-field"><label className="label" htmlFor="b-gst">GSTIN (optional)</label><input id="b-gst" className="input" value={f.gstin} onChange={set('gstin')} maxLength={15} placeholder="27AAAAA0000A1Z5" style={{ textTransform: 'uppercase' }} /></div>
          <div className="form-field form-field--full"><label className="label" htmlFor="b-addr">Address</label><input id="b-addr" className="input" value={f.address} onChange={set('address')} maxLength={300} /></div>
          <div className="form-field"><label className="label" htmlFor="b-city">City</label><input id="b-city" className="input" value={f.city} onChange={set('city')} maxLength={80} /></div>
          <div className="form-field"><label className="label" htmlFor="b-pin">PIN code</label><input id="b-pin" className="input" value={f.pincode} onChange={set('pincode')} maxLength={6} inputMode="numeric" /></div>
          <div className="form-field"><label className="label" htmlFor="b-mail">Send invoices to</label><input id="b-mail" className="input" type="email" value={f.billingEmail} onChange={set('billingEmail')} placeholder="accounts@yourinstitute.edu" /></div>
          <div className="form-field"><label className="label" htmlFor="b-phone">Phone</label><input id="b-phone" className="input" value={f.billingPhone} onChange={set('billingPhone')} maxLength={20} /></div>
        </div>
        <div className="form-actions"><button className="btn btn--primary" disabled={busy}><Save size={15} /> Save details</button></div>
      </form>
    </Card>
  );
}


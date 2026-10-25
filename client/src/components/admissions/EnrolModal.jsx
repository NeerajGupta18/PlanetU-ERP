import { useState } from 'react';
import { CreditCard, Receipt, UserCheck } from 'lucide-react';
import { useFetch } from '../../hooks/useFetch.js';
import { useTenantConfig } from '../../hooks/useTenantConfig.js';
import { api } from '../../api/http.js';
import Modal from '../ui/Modal.jsx';
import StepBar from '../ui/StepBar.jsx';
import { DataBoundary } from '../ui/Feedback.jsx';
import { FormActions, FormError, FormField } from '../ui/Ui.jsx';
import { inr } from './status.js';
import { fmtDate } from '../../utils/dates.js';

const METHODS = [['cash', 'Cash'], ['upi', 'UPI'], ['card', 'Card'], ['cheque', 'Cheque'], ['bank_transfer', 'Bank transfer']];

/**
 * The last two steps of admissions in one screen: take the enrolment fee and enrol. One click creates the student
 * in their class (and division), charges the class fee plan, records the fee with a receipt, and invites the parent.
 */
export default function EnrolModal({ app, onClose, onDone }) {
  const { t, tenant, hasModule } = useTenantConfig();
  const plan = useFetch(`/admin/admissions/${app.id}/enrol-plan`);
  const firstDue = plan.data?.feePlan?.items?.[0]?.amount;
  const [f, setF] = useState(null);
  const form = f || { division: '', amount: firstDue ? String(Number(firstDue)) : '', method: 'cash', reference: '', inviteParent: true };
  const set = (k) => (e) => setF({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const guardianEmail = app.guardian?.email;

  const submit = async (e) => {
    e.preventDefault(); setErr(null); setBusy(true);
    try {
      const amount = Number(form.amount || 0);
      const r = await api.post(`/admin/admissions/${app.id}/enroll`, {
        division: form.division || undefined, inviteParent: form.inviteParent,
        payment: amount > 0 ? { amount, method: form.method, reference: form.reference } : undefined,
      });
      setDone(r); onDone();
    } catch (x) { setErr(x); } finally { setBusy(false); }
  };

  if (done) {
    return (
      <Modal open title={`${app.name} is enrolled`} onClose={onClose} width={540}>
        <StepBar process="admissions" current="enrolled" done={['enquiry', 'application', 'documents', 'decision', 'offer', ...(done.payment ? ['fee'] : [])]} />
        <div className="secret-box" style={{ marginTop: 12 }}>
          <div>PRN / login ID: <strong>{done.student.prn}</strong>{done.student.division && <> · Division <strong>{done.student.division}</strong></>}</div>
          <div>Email: <strong>{done.student.email}</strong></div>
          <div>One-time password:<br /><code>{done.student.temporaryPassword}</code></div>
        </div>
        <p className="muted">Shown only once. A link to set a password was also emailed. They sign in with the institute code <strong>{tenant?.code}</strong>.</p>
        <ul className="done-list">
          <li>{done.fees.plan ? <>Fee plan <strong>{done.fees.plan}</strong> charged ({done.fees.charged} items)</> : 'No fee plan for this class yet: add one in Fees.'}</li>
          <li>{done.payment ? <>Enrolment fee <strong>{inr(done.payment.amount)}</strong> received, receipt <strong>{done.payment.receiptNo}</strong></> : 'No fee taken now: the student shows under Enrolment fee on the board.'}</li>
          <li>{done.parent.invited ? <>Parent invited at <strong>{done.parent.email}</strong></> : done.parent.reason}</li>
        </ul>
        <div className="form-actions">
          {hasModule('id_cards') && <a className="btn btn--outline" href={`/api/admin/students/${done.student.id}/id-card.pdf`} target="_blank" rel="noreferrer"><CreditCard size={15} /> ID card</a>}
          {done.payment && <a className="btn btn--outline" href={`/api/admin/fees/payments/${done.payment.id}/receipt.pdf`} target="_blank" rel="noreferrer"><Receipt size={15} /> Receipt</a>}
          <button type="button" className="btn btn--primary" onClick={onClose}>Done</button>
        </div>
      </Modal>
    );
  }

  const p = plan.data?.feePlan;
  return (
    <Modal open title={`Enrol ${app.name}`} onClose={onClose} width={560}>
      <StepBar process="admissions" current="fee" />
      <DataBoundary loading={plan.loading} error={plan.error} data={plan.data} reload={plan.reload}>
        {plan.data && (
          <form onSubmit={submit} style={{ marginTop: 12 }}>
            <FormError error={err} />
            <p style={{ marginTop: 0 }}><UserCheck size={15} aria-hidden="true" /> {t('course', 'Course')}: <strong>{app.course}</strong></p>
            <div className="fields">
              {plan.data.divisions.length > 0 && (
                <FormField label="Division" required full>
                  <select className="input" value={form.division} onChange={set('division')}>
                    <option value="">Choose...</option>
                    {plan.data.divisions.map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                </FormField>
              )}
            </div>
            <div className="plan-box">
              {p ? (
                <>
                  <strong>{p.name}</strong> <span className="muted">({p.academicYear}) · {inr(p.total)} in all</span>
                  <ul>{p.items.map((i) => <li key={i.label}>{i.label}: {inr(i.amount)}{i.dueDate && <span className="muted"> by {fmtDate(String(i.dueDate).slice(0, 10))}</span>}</li>)}</ul>
                  <span className="muted">These become the student's dues.</span>
                </>
              ) : <span className="muted">This class has no fee plan yet. A fee taken now is recorded as "Enrolment fee".</span>}
            </div>
            <div className="fields" style={{ marginTop: 12 }}>
              <FormField label="Enrolment fee taken now" hint="Leave empty to enrol now and collect later">
                <input className="input" type="number" inputMode="decimal" min="0" step="0.01" value={form.amount} onChange={set('amount')} />
              </FormField>
              <FormField label="Paid by">
                <select className="input" value={form.method} onChange={set('method')} disabled={!Number(form.amount)}>
                  {METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </FormField>
              {Number(form.amount) > 0 && form.method !== 'cash' && (
                <FormField label="Reference" hint="UPI, cheque or card slip number" full><input className="input" value={form.reference} onChange={set('reference')} /></FormField>
              )}
            </div>
            <label className="check-row" style={{ marginTop: 12 }}>
              <input type="checkbox" checked={form.inviteParent} onChange={set('inviteParent')} disabled={!guardianEmail} />
              {guardianEmail ? <> Invite the parent ({guardianEmail}) to the parent app</> : ' No guardian email on the application: invite the parent later from the student record'}
            </label>
            <FormActions submit={Number(form.amount) > 0 ? `Take ${inr(form.amount)} and enrol` : 'Enrol without fee'} busyLabel="Enrolling..." busy={busy} onCancel={onClose} />
          </form>
        )}
      </DataBoundary>
    </Modal>
  );
}

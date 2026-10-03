import { useState } from 'react';
import { CheckCircle2, FileText, ShieldCheck } from 'lucide-react';
import Modal from '../ui/Modal.jsx';
import { api } from '../../api/http.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { BRAND } from '../../config/brand.js';
import { loadRazorpay } from '../../hooks/useRazorpay.js';

const inr = (n) => `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Pay fees online through Razorpay Checkout (UPI / cards / netbanking).
 *   scope = { feeItemId?: string, label: string, due: number }
 *   feeItemId omitted -> pay against the whole outstanding balance (oldest charge first).
 * The amount typed here is only a REQUEST - the server re-checks it against what is really owed.
 */
export default function PayOnlineModal({ scope, onClose, onDone }) {
  const { institute } = useAuth();
  const [amount, setAmount] = useState(Number(scope.due).toFixed(2));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [result, setResult] = useState(null); // { status, receiptId?, receiptNo?, paymentRef? }

  const report = async (resp) => {
    try {
      const r = await api.post('/student/fees/online/verify', resp);
      setResult({ status: r.status, receiptId: r.paymentId, receiptNo: r.receiptNo, paymentRef: resp.razorpay_payment_id });
    } catch {
      // The money may well have moved; Razorpay also tells our server directly, so this self-heals.
      setResult({ status: 'unconfirmed', paymentRef: resp.razorpay_payment_id });
    } finally { setBusy(false); }
  };

  const submit = async (e) => {
    e.preventDefault(); setErr(''); setBusy(true);
    try {
      if (!(await loadRazorpay())) throw new Error('Could not load the secure payment form. Check your internet connection and try again.');
      const order = await api.post('/student/fees/online/orders', { feeItemId: scope.feeItemId, amount: Number(amount) });
      const rzp = new window.Razorpay({
        key: order.keyId,
        order_id: order.orderId,
        amount: order.amountPaise,
        currency: order.currency,
        name: institute?.name || BRAND.name,
        description: scope.label,
        prefill: order.prefill,
        theme: { color: '#4029c9' },
        modal: { ondismiss: () => setBusy(false) },
        handler: report,
      });
      rzp.on('payment.failed', (r) => {
        setErr(r?.error?.description || 'The payment did not go through. You have not been charged - please try again.');
        setBusy(false);
      });
      rzp.open();
    } catch (e2) { setErr(e2.message); setBusy(false); }
  };

  const finish = () => { onDone(); };

  return (
    <Modal open title="Pay fees online" onClose={result ? finish : (busy ? () => {} : onClose)} width={440}>
      {result ? (
        <>
          {result.status === 'paid' && (
            <p className="secret-box" style={{ background: '#dcfce7', borderColor: '#bbf7d0' }}>
              <CheckCircle2 size={16} style={{ verticalAlign: '-3px' }} /> Payment successful. Your receipt number is <strong>{result.receiptNo}</strong>.
            </p>
          )}
          {(result.status === 'pending' || result.status === 'unconfirmed') && (
            <p className="secret-box">
              We have your payment details and are waiting for the bank to confirm. Your fees will update automatically within a few minutes - you do not need to pay again.
            </p>
          )}
          {result.status === 'needs_review' && (
            <p className="secret-box">
              Your payment went through, but we could not apply it automatically (your balance may have changed). The accounts office will sort it out - please do not pay again.
            </p>
          )}
          {result.paymentRef && <p className="muted" style={{ fontSize: 12 }}>Payment ID: <code>{result.paymentRef}</code></p>}
          <div className="form-actions">
            {result.receiptId && (
              <a className="btn btn--outline" href={`/api/student/fees/payments/${result.receiptId}/receipt.pdf`} target="_blank" rel="noreferrer"><FileText size={14} /> Receipt</a>
            )}
            <button type="button" className="btn btn--primary" onClick={finish}>Done</button>
          </div>
        </>
      ) : (
        <form onSubmit={submit}>
          {err && <p className="form-error">{err}</p>}
          <p className="muted" style={{ marginTop: 0 }}>{scope.label}. Outstanding: <strong>{inr(scope.due)}</strong></p>
          <div className="form-field">
            <label className="label" htmlFor="online-amount">Amount to pay (₹)</label>
            <input id="online-amount" className="input" type="number" min="1" max={scope.due} step="0.01" required value={amount} onChange={(e) => setAmount(e.target.value)} />
            <span className="muted" style={{ fontSize: 12 }}>Pay the full amount or part of it as an instalment.</span>
          </div>
          <p className="muted" style={{ fontSize: 12, display: 'flex', gap: 6, alignItems: 'center' }}>
            <ShieldCheck size={14} /> Secure payment by Razorpay: UPI, cards and netbanking. We never see your card or bank details.
          </p>
          <div className="form-actions">
            <button type="button" className="btn btn--outline" onClick={onClose}>Cancel</button>
            <button className="btn btn--primary" disabled={busy}>{busy ? 'Opening payment...' : `Pay ${inr(Number(amount) || 0)}`}</button>
          </div>
        </form>
      )}
    </Modal>
  );
}

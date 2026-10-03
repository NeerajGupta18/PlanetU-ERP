import { useState } from 'react';
import { Receipt } from 'lucide-react';
import { api } from '../../api/http.js';
import Modal from '../ui/Modal.jsx';
import { inr } from '../../utils/billing.js';

export default function RecordPayment({ invoice, onClose, onDone }) {
  const [f, setF] = useState({ method: 'bank_transfer', reference: '', paidOn: '', note: '' });
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((c) => ({ ...c, [k]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    try { await api.post(`/super-admin/billing/invoices/${invoice.id}/payments`, { ...f, paidOn: f.paidOn || undefined }); onDone(); } catch (ex) { setErr(ex.message); setBusy(false); }
  };
  return (
    <Modal open title={`Record payment for ${invoice.number}`} onClose={onClose} width={480}>
      <form onSubmit={submit}>
        <p style={{ marginTop: 0 }}>Amount: <strong>{inr(invoice.total)}</strong> (the invoice is settled in full). Use this for money received outside Razorpay.</p>
        {err && <p className="form-error" role="alert">{err}</p>}
        <div className="fields">
          <div className="form-field"><label className="label" htmlFor="rp-m">Method</label>
            <select id="rp-m" className="input" value={f.method} onChange={set('method')}><option value="bank_transfer">Bank transfer</option><option value="upi">UPI</option><option value="cheque">Cheque</option><option value="cash">Cash</option><option value="other">Other</option></select></div>
          <div className="form-field"><label className="label" htmlFor="rp-d">Received on</label><input id="rp-d" className="input" type="date" value={f.paidOn} max={new Date().toISOString().slice(0, 10)} onChange={set('paidOn')} /></div>
          <div className="form-field form-field--full"><label className="label" htmlFor="rp-r">Reference{f.method === 'cash' ? ' (optional)' : ''}</label><input id="rp-r" className="input" value={f.reference} onChange={set('reference')} placeholder="UTR / transaction ID / cheque no." maxLength={120} /></div>
          <div className="form-field form-field--full"><label className="label" htmlFor="rp-n">Note</label><input id="rp-n" className="input" value={f.note} onChange={set('note')} maxLength={300} /></div>
        </div>
        <div className="form-actions"><button type="button" className="btn btn--outline" onClick={onClose}>Cancel</button><button className="btn btn--primary" disabled={busy}><Receipt size={15} /> Record payment</button></div>
      </form>
    </Modal>
  );
}


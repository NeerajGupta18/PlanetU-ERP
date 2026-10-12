import { useState } from 'react';
import { useFetch } from '../../hooks/useFetch.js';
import { api } from '../../api/http.js';
import Modal from '../ui/Modal.jsx';
import { DataBoundary } from '../ui/Feedback.jsx';
import { useDialogs } from '../ui/Dialogs.jsx';

/** Application fee, open/closed switch and the note applicants see before they start. */
export default function AdmissionSettings({ onClose }) {
  const { toast } = useDialogs();
  const { data, loading, error, reload } = useFetch('/admin/admissions/settings');
  return (
    <Modal open title="Admission settings" onClose={onClose} width={520}>
      <DataBoundary loading={loading && !data} error={error} data={data} reload={reload}>
        {data && <Form s={data.settings} onClose={onClose} toast={toast} />}
      </DataBoundary>
    </Modal>
  );
}

function Form({ s, onClose, toast }) {
  const [fee, setFee] = useState(String(s.applicationFee));
  const [accepting, setAccepting] = useState(s.accepting);
  const [instructions, setInstructions] = useState(s.instructions);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async (e) => {
    e.preventDefault(); setErr(''); setBusy(true);
    try { await api.put('/admin/admissions/settings', { applicationFee: Number(fee || 0), accepting, instructions }); toast.success('Admission settings saved.'); onClose(); }
    catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={save}>
      {err && <p className="form-error">{err}</p>}
      <div className="fields fields--1">
        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="checkbox" checked={accepting} onChange={(e) => setAccepting(e.target.checked)} />
          <span><strong>Accepting applications</strong> <span className="muted">- untick to close the public form</span></span>
        </label>
        <div className="form-field"><label className="label">Application fee (₹)</label>
          <input className="input" type="number" min="0" step="0.01" value={fee} onChange={(e) => setFee(e.target.value)} />
          <small className="muted">0 means no fee. New applications use the fee that is set when they start. If online payment is switched on for your installation, applicants pay in the last step; otherwise you record the fee here when it is paid at the counter.</small></div>
        <div className="form-field"><label className="label">Note shown at the top of the form</label>
          <textarea className="input" rows={4} maxLength={2000} placeholder="e.g. Keep your 12th marksheet and an ID proof ready. Last date to apply is 30 June." value={instructions} onChange={(e) => setInstructions(e.target.value)} /></div>
      </div>
      <div className="form-actions">
        <button type="button" className="btn btn--outline" onClick={onClose}>Cancel</button>
        <button className="btn btn--primary" disabled={busy}>{busy ? 'Saving...' : 'Save'}</button>
      </div>
    </form>
  );
}

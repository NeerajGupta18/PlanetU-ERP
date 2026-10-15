import { useState } from 'react';
import { Copy, Printer } from 'lucide-react';
import { api } from '../../api/http.js';
import Modal from '../ui/Modal.jsx';
import { inr } from './status.js';

const CATEGORIES = ['General', 'OBC', 'SC', 'ST', 'EWS', 'Other'];
const blank = {
  courseId: '', name: '', email: '', phone: '', dob: '', gender: '', address: '', feeStatus: 'pending', feeReference: '',
  personal: { nationality: 'Indian', category: '', bloodGroup: '' },
  guardian: { fatherName: '', motherName: '', name: '', relation: '', phone: '', email: '', occupation: '' },
  previousEducation: { institution: '', qualification: '', board: '', year: '', percentage: '', tenth: { board: '', year: '', percentage: '' } },
  entrance: { exam: '', rollNo: '', score: '' },
};
const today = new Date().toISOString().slice(0, 10);

/** The office types in the form for someone standing at the counter. After saving it hands over the application number and access code. */
export default function WalkInModal({ courses, fee, courseLabel = 'Course', onClose, onCreated }) {
  const [f, setF] = useState(blank);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const nest = (g, k) => (e) => setF((x) => ({ ...x, [g]: { ...x[g], [k]: e.target.value } }));

  const save = async (e) => {
    e.preventDefault(); setErr(''); setBusy(true);
    try {
      const r = await api.post('/admin/admissions/walk-in', f);
      setDone({ id: r.application.id, applicationNo: r.application.applicationNo, accessCode: r.accessCode, name: r.application.name });
      onCreated();
    } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };

  if (done) {
    return (
      <Modal open title="Application saved" onClose={onClose} width={480}>
        <div className="secret-box">
          <div>Applicant: <strong>{done.name}</strong></div>
          <div>Application number: <strong>{done.applicationNo}</strong></div>
          <div>Access code: <code>{done.accessCode}</code></div>
        </div>
        <p className="muted">Give these two to the applicant - they use them on the status page. The access code is shown only now. Next, add the scanned documents (they are marked verified), then accept the application.</p>
        <div className="form-actions no-print">
          <button type="button" className="btn btn--outline" onClick={() => navigator.clipboard?.writeText(`${done.applicationNo} / ${done.accessCode}`)}><Copy size={14} /> Copy</button>
          <button type="button" className="btn btn--outline" onClick={() => window.print()}><Printer size={14} /> Print</button>
          <button type="button" className="btn btn--primary" onClick={() => onCreated(done.id, true)}>Add documents</button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open title="Add a walk-in application" onClose={onClose} width={760}>
      <form onSubmit={save}>
        {err && <p className="form-error">{err}</p>}
        <div className="fields">
          <label className="form-field"><span className="label">{courseLabel} *</span>
            <select className="input" value={f.courseId} onChange={set('courseId')} required><option value="">Select...</option>{courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label className="form-field"><span className="label">Full name *</span><input className="input" value={f.name} onChange={set('name')} required /></label>
          <label className="form-field"><span className="label">Email *</span><input className="input" type="email" value={f.email} onChange={set('email')} required /></label>
          <label className="form-field"><span className="label">Mobile *</span><input className="input" type="tel" value={f.phone} onChange={set('phone')} required /></label>
          <label className="form-field"><span className="label">Date of birth *</span><input className="input" type="date" max={today} value={f.dob} onChange={set('dob')} required /></label>
          <label className="form-field"><span className="label">Gender</span>
            <select className="input" value={f.gender} onChange={set('gender')}><option value="">-</option><option>Female</option><option>Male</option><option>Other</option></select></label>
          <label className="form-field"><span className="label">Category</span>
            <select className="input" value={f.personal.category} onChange={nest('personal', 'category')}><option value="">-</option>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></label>
          <label className="form-field"><span className="label">Nationality</span><input className="input" value={f.personal.nationality} onChange={nest('personal', 'nationality')} /></label>
          <label className="form-field form-field--full"><span className="label">Address *</span><input className="input" value={f.address} onChange={set('address')} required /></label>
          <label className="form-field"><span className="label">Father's name</span><input className="input" value={f.guardian.fatherName} onChange={nest('guardian', 'fatherName')} /></label>
          <label className="form-field"><span className="label">Mother's name</span><input className="input" value={f.guardian.motherName} onChange={nest('guardian', 'motherName')} /></label>
          <label className="form-field"><span className="label">Guardian to contact *</span><input className="input" value={f.guardian.name} onChange={nest('guardian', 'name')} required /></label>
          <label className="form-field"><span className="label">Guardian's phone *</span><input className="input" type="tel" value={f.guardian.phone} onChange={nest('guardian', 'phone')} required /></label>
          <label className="form-field"><span className="label">Last qualification</span><input className="input" placeholder="12th, Diploma..." value={f.previousEducation.qualification} onChange={nest('previousEducation', 'qualification')} /></label>
          <label className="form-field"><span className="label">School / college</span><input className="input" value={f.previousEducation.institution} onChange={nest('previousEducation', 'institution')} /></label>
          <div className="form-field"><label className="label">Year / percentage</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input className="input" placeholder="2024" maxLength={4} value={f.previousEducation.year} onChange={nest('previousEducation', 'year')} />
              <input className="input" placeholder="88.5" value={f.previousEducation.percentage} onChange={nest('previousEducation', 'percentage')} />
            </div></div>
          <div className="form-field"><label className="label">Entrance exam and score</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input className="input" placeholder="JEE" value={f.entrance.exam} onChange={nest('entrance', 'exam')} />
              <input className="input" placeholder="Score" value={f.entrance.score} onChange={nest('entrance', 'score')} />
            </div></div>
          {fee > 0 && (
            <div className="form-field form-field--full"><label className="label">Application fee {inr(fee)}</label>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <select className="input" style={{ maxWidth: 240 }} value={f.feeStatus} onChange={set('feeStatus')}>
                  <option value="pending">Not collected yet</option><option value="paid">Collected now</option><option value="waived">Waived</option>
                </select>
                {f.feeStatus !== 'pending' && <input className="input" style={{ flex: 1, minWidth: 180 }} placeholder={f.feeStatus === 'paid' ? 'Receipt number (optional)' : 'Reason for waiver'} required={f.feeStatus === 'waived'} value={f.feeReference} onChange={set('feeReference')} />}
              </div></div>
          )}
        </div>
        <div className="form-actions">
          <button type="button" className="btn btn--outline" onClick={onClose}>Cancel</button>
          <button className="btn btn--primary" disabled={busy}>{busy ? 'Saving...' : 'Save application'}</button>
        </div>
      </form>
    </Modal>
  );
}

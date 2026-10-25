import { useState } from 'react';
import { api } from '../../api/http.js';
import Modal from '../ui/Modal.jsx';
import { FormActions, FormError, FormField } from '../ui/Ui.jsx';
import ShareMessage from '../ui/ShareMessage.jsx';

/**
 * Step 1 of admissions: someone phoned or came to the desk asking about a course. Name, email and the course start
 * their application; the form link and access code go to their email, and a ready WhatsApp message is shown too.
 */
export default function EnquiryModal({ courses, courseLabel = 'Course', onClose, onCreated }) {
  const [f, setF] = useState({ name: '', phone: '', email: '', courseId: courses.length === 1 ? courses[0].id : '', sendLink: true });
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  const save = async (e) => {
    e.preventDefault(); setErr(null); setBusy(true);
    try { const r = await api.post('/admin/admissions/enquiries', f); setDone(r); onCreated(); } catch (x) { setErr(x); } finally { setBusy(false); }
  };

  if (done) {
    return (
      <Modal open title="Enquiry added" onClose={onClose} width={520}>
        <p style={{ marginTop: 0 }}><strong>{done.name}</strong> is on the board under Enquiry, application <strong>{done.applicationNo}</strong>.</p>
        {done.invite ? (
          <>
            <p className="muted">The form link and access code were emailed. To send them on WhatsApp too:</p>
            <ShareMessage message={done.invite.message} whatsapp={done.invite.whatsapp} />
          </>
        ) : <p className="muted">No link was sent. Use "Send form link" on the card when they are ready, or fill the form in at the desk.</p>}
        <div className="form-actions"><button type="button" className="btn btn--primary" onClick={onClose}>Done</button></div>
      </Modal>
    );
  }

  return (
    <Modal open title="Add an enquiry" onClose={onClose} width={520}>
      <form onSubmit={save}>
        <FormError error={err} />
        <div className="fields">
          <FormField label="Full name" required full><input className="input" value={f.name} onChange={set('name')} autoFocus /></FormField>
          <FormField label="Mobile" hint="For the WhatsApp message"><input className="input" type="tel" inputMode="tel" value={f.phone} onChange={set('phone')} placeholder="98765 43210" /></FormField>
          <FormField label="Email" required hint="The form link goes here"><input className="input" type="email" inputMode="email" value={f.email} onChange={set('email')} /></FormField>
          <FormField label={courseLabel} required full>
            <select className="input" value={f.courseId} onChange={set('courseId')}>
              <option value="">Choose...</option>
              {courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </FormField>
        </div>
        <label className="check-row" style={{ marginTop: 12 }}>
          <input type="checkbox" checked={f.sendLink} onChange={set('sendLink')} /> Email them the link to fill in the application
        </label>
        <FormActions submit="Add enquiry" busyLabel="Adding..." busy={busy} onCancel={onClose} />
      </form>
    </Modal>
  );
}

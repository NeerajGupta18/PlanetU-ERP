import { useState } from 'react';
import { Send, Upload } from 'lucide-react';
import { pub } from '../../api/public.js';
import { Badge } from '../ui/Ui.jsx';
import { DOC_LABEL, DOC_TONE } from './status.js';

/** Upload / replace documents and submit. Used right after applying and again from the status page. */
export default function DocumentsPanel({ code, app, accessCode, onChange }) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const editable = ['draft', 'documents_pending'].includes(app.status);
  const types = [...app.requiredDocuments, 'other'];

  const upload = async (docType, file) => {
    if (!file) return;
    setBusy(docType); setError('');
    const form = new FormData();
    form.set('docType', docType);
    form.set('file', file);
    try { onChange((await pub(code, `/applications/${app.id}/documents`, { method: 'POST', form, accessCode })).application); }
    catch (err) { setError(err.message); } finally { setBusy(''); }
  };

  const submit = async () => {
    setBusy('submit'); setError('');
    try { onChange((await pub(code, `/applications/${app.id}/submit`, { method: 'POST', accessCode })).application); }
    catch (err) { setError(err.message); } finally { setBusy(''); }
  };

  return (
    <div>
      {error && <p className="form-error">{error}</p>}
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Document</th><th>Uploaded</th><th>Status</th>{editable && <th />}</tr></thead>
          <tbody>
            {types.map((t) => {
              const docs = app.documents.filter((d) => d.docType === t);
              const required = app.requiredDocuments.includes(t);
              return (docs.length ? docs : [null]).map((d, i) => (
                <tr key={d?.id || t}>
                  <td><strong>{DOC_LABEL[t]}</strong>{required && <span className="muted"> *</span>}</td>
                  <td className="muted">{d ? d.name : 'Not uploaded'}</td>
                  <td>
                    {d && <Badge tone={DOC_TONE[d.status]}>{d.status}</Badge>}
                    {d?.remark && <div className="muted">{d.remark}</div>}
                  </td>
                  {editable && (
                    <td>
                      {(!d || d.status !== 'verified') && i === 0 && (
                        <label className="btn btn--outline btn--sm" style={{ cursor: 'pointer' }}>
                          <Upload size={13} /> {busy === t ? 'Uploading...' : d ? 'Replace' : 'Upload'}
                          <input type="file" hidden accept="application/pdf,image/png,image/jpeg" disabled={!!busy}
                            onChange={(e) => { upload(t, e.target.files[0]); e.target.value = ''; }} />
                        </label>
                      )}
                    </td>
                  )}
                </tr>
              ));
            })}
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ margin: '8px 0 0' }}>PDF, PNG or JPEG, up to 5 MB each. * required</p>
      {editable && (
        <div className="form-actions">
          <button type="button" className="btn btn--primary" disabled={!!busy} onClick={submit}>
            <Send size={15} /> {busy === 'submit' ? 'Submitting...' : app.status === 'documents_pending' ? 'Resubmit application' : 'Submit application'}
          </button>
        </div>
      )}
    </div>
  );
}

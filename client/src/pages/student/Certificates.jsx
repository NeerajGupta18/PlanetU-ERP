import { useState } from 'react';
import { Download, FileText } from 'lucide-react';
import { useFetch } from '../../hooks/useFetch.js';
import { api } from '../../api/http.js';
import { Badge, Card, PageBanner } from '../../components/ui/Ui.jsx';
import { DataBoundary, EmptyState } from '../../components/ui/Feedback.jsx';
import Modal from '../../components/ui/Modal.jsx';
import { useDialogs } from '../../components/ui/Dialogs.jsx';
import { fmtDate } from '../../utils/dates.js';

const INFO = {
  bonafide: 'Proof that you are a student here - for a bank, scholarship, passport or visa.',
  character: 'A certificate of conduct, for admissions elsewhere or a job.',
  noc: 'A No Objection Certificate - for an internship, a course or an exam elsewhere.',
  transfer: 'Needed when you leave. Any pending fees must be cleared first.',
};
const TONE = { requested: 'amber', issued: 'green', rejected: 'red' };
const WORD = { requested: 'Waiting', issued: 'Issued', rejected: 'Not issued' };

export default function Certificates() {
  const { toast } = useDialogs();
  const { data, loading, error, reload } = useFetch('/student/certificates');
  const [type, setType] = useState(null);
  const [purpose, setPurpose] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault(); setBusy(true);
    try {
      await api.post('/student/certificates', { certType: type, purpose });
      toast.success('Request sent to the office.');
      setType(null); setPurpose(''); reload();
    } catch (err) { toast.error(err); } finally { setBusy(false); }
  };
  const waiting = (t) => (data?.requests || []).some((r) => r.certType === t && r.status === 'requested');

  return (
    <>
      <PageBanner icon={FileText} title="Certificates" subtitle="Ask the office for a certificate and download it once it is issued" />
      <DataBoundary loading={loading} error={error} data={data} reload={reload}>
        {data && (
          <>
            <div className="cert-types">
              {Object.entries(data.types).map(([id, label]) => (
                <div key={id} className="cert-type">
                  <div><h3>{label}</h3><p>{INFO[id]}</p></div>
                  <button type="button" className="btn btn--primary btn--sm" disabled={waiting(id)} onClick={() => { setType(id); setPurpose(''); }}>{waiting(id) ? 'Request waiting' : 'Request'}</button>
                </div>
              ))}
            </div>
            <Card title="My requests">
              {data.requests.length === 0 ? <EmptyState title="No requests yet" hint="Choose a certificate above." /> : (
                <div className="table-wrap">
                  <table className="table">
                    <thead><tr><th>Certificate</th><th>Purpose</th><th>Asked on</th><th>Status</th><th /></tr></thead>
                    <tbody>
                      {data.requests.map((r) => (
                        <tr key={r.id}>
                          <td><strong>{r.certLabel}</strong>{r.certificateNo && <div className="muted">{r.certificateNo}</div>}</td>
                          <td>{r.purpose}{r.status === 'rejected' && r.remark && <div className="muted">Reason: {r.remark}</div>}</td>
                          <td className="muted">{fmtDate(String(r.requestedAt).slice(0, 10))}</td>
                          <td><Badge tone={TONE[r.status]}>{WORD[r.status]}</Badge></td>
                          <td>{r.status === 'issued' && <a className="btn btn--outline btn--sm" href={`/api/student/certificates/${r.id}/pdf`} target="_blank" rel="noreferrer"><Download size={13} /> Download</a>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </>
        )}
      </DataBoundary>
      <Modal open={!!type} title={type ? `Request: ${data?.types[type]}` : ''} onClose={() => setType(null)}>
        <form onSubmit={submit}>
          <label className="form-field">
            <span className="label">{type === 'transfer' ? 'Reason for leaving *' : 'What is it needed for? *'}</span>
            <input className="input" value={purpose} onChange={(e) => setPurpose(e.target.value)} maxLength={300} required autoFocus />
          </label>
          <div className="form-actions">
            <button type="button" className="btn btn--outline" onClick={() => setType(null)}>Cancel</button>
            <button className="btn btn--primary" disabled={busy}>{busy ? 'Sending...' : 'Send request'}</button>
          </div>
        </form>
      </Modal>
    </>
  );
}

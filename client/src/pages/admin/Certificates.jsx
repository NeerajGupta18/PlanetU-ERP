import { useEffect, useState } from 'react';
import { FileText, Plus, Search } from 'lucide-react';
import { useFetch } from '../../hooks/useFetch.js';
import { useTabParam } from '../../hooks/useTabParam.js';
import { api } from '../../api/http.js';
import { Badge, Card, PageBanner, Tabs } from '../../components/ui/Ui.jsx';
import { DataBoundary, EmptyState } from '../../components/ui/Feedback.jsx';
import Modal from '../../components/ui/Modal.jsx';
import { useDialogs } from '../../components/ui/Dialogs.jsx';
import { fmtDate, todayISO } from '../../utils/dates.js';

const TABS = [{ id: 'requested', label: 'Waiting' }, { id: 'issued', label: 'Issued' }, { id: 'rejected', label: 'Not issued' }];
const TONE = { requested: 'amber', issued: 'green', rejected: 'red' };

function StudentPicker({ value, onPick }) {
  const [text, setText] = useState('');
  const [found, setFound] = useState([]);
  useEffect(() => {
    if (text.trim().length < 2 || value) { setFound([]); return undefined; }
    const h = setTimeout(() => api.get(`/admin/students?search=${encodeURIComponent(text.trim())}`).then((r) => setFound(r.students.slice(0, 8))).catch(() => setFound([])), 250);
    return () => clearTimeout(h);
  }, [text, value]);
  if (value) return <div><strong>{value.name}</strong> <span className="muted">({value.studentCode})</span> <button type="button" className="btn btn--outline btn--sm" onClick={() => { onPick(null); setText(''); }}>Change</button></div>;
  return (
    <div className="picker">
      <input className="input" placeholder="Type a name, email or ID" value={text} onChange={(e) => setText(e.target.value)} />
      {found.length > 0 && (
        <div className="picker__list">
          {found.map((s) => <button key={s.id} type="button" className="picker__item" onClick={() => onPick(s)}><strong>{s.name}</strong> <span className="muted">{s.studentCode} - {s.course}</span></button>)}
        </div>
      )}
    </div>
  );
}

/** Issue (from a request) or issue directly (request = null, student chosen here). */
function IssueModal({ request, types, onClose, onDone }) {
  const { confirm, toast } = useDialogs();
  const direct = !request;
  const [student, setStudent] = useState(null);
  const [certType, setCertType] = useState(request?.certType || 'bonafide');
  const [purpose, setPurpose] = useState(request?.purpose || '');
  const [conduct, setConduct] = useState('Good');
  const [leavingDate, setLeavingDate] = useState(todayISO());
  const [reason, setReason] = useState(request?.purpose || '');
  const [remark, setRemark] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const send = async (force) => {
    const details = certType === 'transfer' ? { leavingDate, reason, conduct } : certType === 'character' ? { conduct } : {};
    const body = direct ? { studentId: student?.id, certType, purpose, details, remark, force } : { decision: 'issue', details, remark, force };
    if (direct && !student) { setErr('Choose a student.'); return; }
    setBusy(true); setErr('');
    try {
      const r = direct ? await api.post('/admin/certificates', body) : await api.put(`/admin/certificates/${request.id}`, body);
      toast.success(`Issued ${r.request.certificateNo}.`);
      window.open(`/api/admin/certificates/${r.request.id}/pdf`, '_blank');
      onDone();
    } catch (x) {
      if (x.data?.code === 'HAS_DUES') {
        if (await confirm(`${x.message}`, { title: 'Fees are pending', confirmLabel: 'Issue anyway' })) { setBusy(false); return send(true); }
      } else setErr(x.message);
    } finally { setBusy(false); }
  };

  return (
    <Modal open title={direct ? 'Issue a certificate' : `Issue: ${request.certLabel}`} onClose={onClose} width={540}>
      <form onSubmit={(e) => { e.preventDefault(); send(false); }}>
        {err && <p className="form-error">{err}</p>}
        <div className="fields">
          {direct ? (
            <>
              <div className="form-field form-field--full"><label className="label">Student *</label><StudentPicker value={student} onPick={setStudent} /></div>
              <label className="form-field"><span className="label">Certificate *</span>
                <select className="input" value={certType} onChange={(e) => setCertType(e.target.value)}>{Object.entries(types).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
              <label className="form-field"><span className="label">{certType === 'transfer' ? 'Reason for leaving *' : 'Purpose *'}</span><input className="input" value={purpose} onChange={(e) => { setPurpose(e.target.value); if (certType === 'transfer') setReason(e.target.value); }} required /></label>
            </>
          ) : (
            <div className="form-field form-field--full"><strong>{request.studentName}</strong> <span className="muted">({request.studentCode}) - {request.purpose}</span></div>
          )}
          {certType === 'transfer' && (
            <>
              <label className="form-field"><span className="label">Date of leaving</span><input className="input" type="date" value={leavingDate} onChange={(e) => setLeavingDate(e.target.value)} /></label>
              <label className="form-field"><span className="label">Reason shown on the TC</span><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={150} /></label>
            </>
          )}
          {(certType === 'transfer' || certType === 'character') && (
            <label className="form-field"><span className="label">Conduct</span>
              <select className="input" value={conduct} onChange={(e) => setConduct(e.target.value)}><option>Excellent</option><option>Very good</option><option>Good</option><option>Satisfactory</option></select></label>
          )}
          <label className="form-field form-field--full"><span className="label">Note to the student (optional)</span><input className="input" value={remark} onChange={(e) => setRemark(e.target.value)} maxLength={300} /></label>
        </div>
        <div className="form-actions">
          <button type="button" className="btn btn--outline" onClick={onClose}>Cancel</button>
          <button className="btn btn--primary" disabled={busy}>{busy ? 'Issuing...' : 'Issue and open PDF'}</button>
        </div>
      </form>
    </Modal>
  );
}

export default function Certificates() {
  const { prompt, toast } = useDialogs();
  const [tab, setTab] = useTabParam('requested', TABS.map((t) => t.id));
  const [search, setSearch] = useState('');
  const [issuing, setIssuing] = useState(null); // request, or {} for direct
  const list = useFetch(`/admin/certificates?status=${tab}${search ? `&search=${encodeURIComponent(search)}` : ''}`);
  const counts = list.data?.counts || {};

  const reject = async (r) => {
    const remark = await prompt(`Why can't ${r.studentName} get this ${r.certLabel}? The student sees this reason.`, { required: true, title: 'Not issuing', confirmLabel: 'Send', danger: true });
    if (!remark) return;
    try { await api.put(`/admin/certificates/${r.id}`, { decision: 'reject', remark }); list.reload(); } catch (err) { toast.error(err); }
  };

  return (
    <>
      <PageBanner
        icon={FileText} title="Certificates" subtitle="Bonafide, character, NOC and transfer certificates"
        actions={<button type="button" className="btn btn--primary" onClick={() => setIssuing({})}><Plus size={15} /> Issue a certificate</button>}
      />
      <Tabs tabs={TABS.map((t) => ({ id: t.id, label: `${t.label}${counts[t.id] ? ` (${counts[t.id]})` : ''}` }))} active={tab} onChange={setTab} />
      <Card>
        <div className="toolbar">
          <div className="input-wrap" style={{ minWidth: 240 }}>
            <Search size={14} /><input className="input input--icon" placeholder="Student or certificate number" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>
        <DataBoundary loading={list.loading} error={list.error} data={list.data} reload={list.reload}>
          {list.data && (list.data.requests.length === 0 ? <EmptyState title="Nothing here" hint="Requests from students appear under Waiting." /> : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Student</th><th>Certificate</th><th>Purpose</th><th>Asked on</th><th>Status</th><th /></tr></thead>
                <tbody>
                  {list.data.requests.map((r) => (
                    <tr key={r.id}>
                      <td><strong>{r.studentName}</strong><div className="muted">{r.studentCode} - {r.course}</div></td>
                      <td>{r.certLabel}{r.certificateNo && <div className="muted">{r.certificateNo}</div>}</td>
                      <td>{r.purpose}{r.remark && <div className="muted">{r.remark}</div>}</td>
                      <td className="muted">{fmtDate(String(r.requestedAt).slice(0, 10))}</td>
                      <td><Badge tone={TONE[r.status]}>{r.status === 'requested' ? 'Waiting' : r.status === 'issued' ? 'Issued' : 'Not issued'}</Badge></td>
                      <td className="row-actions">
                        {r.status === 'requested' && (<>
                          <button type="button" className="btn btn--primary btn--sm" onClick={() => setIssuing(r)}>Issue</button>
                          <button type="button" className="btn btn--outline btn--sm" onClick={() => reject(r)}>Reject</button>
                        </>)}
                        {r.status === 'issued' && <a className="btn btn--outline btn--sm" href={`/api/admin/certificates/${r.id}/pdf`} target="_blank" rel="noreferrer">PDF</a>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </DataBoundary>
      </Card>
      {issuing && <IssueModal request={issuing.id ? issuing : null} types={list.data?.types || {}} onClose={() => setIssuing(null)} onDone={() => { setIssuing(null); list.reload(); }} />}
    </>
  );
}

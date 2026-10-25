import { useRef, useState } from 'react';
import { CheckCircle2, Download, Eye, Upload, XCircle } from 'lucide-react';
import { useFetch } from '../../hooks/useFetch.js';
import { api } from '../../api/http.js';
import { Badge } from '../ui/Ui.jsx';
import { DataBoundary } from '../ui/Feedback.jsx';
import Modal from '../ui/Modal.jsx';
import { useDialogs } from '../ui/Dialogs.jsx';
import DocumentViewer from '../ui/DocumentViewer.jsx';
import StepBar from '../ui/StepBar.jsx';
import { DOC_LABEL, DOC_TONE, FEE_STATUS, STATUS, inr } from './status.js';
import { fmtDate } from '../../utils/dates.js';

const OPEN = ['submitted', 'documents_pending'];
const UPLOADABLE = ['photo', 'signature', 'id_proof', 'marksheet', 'other'];

const REQUIRED = ['photo', 'id_proof', 'marksheet'];

/** Where this application stands in the admissions process, for the step bar at the top. */
function stepOf(app) {
  const verified = REQUIRED.every((t) => app.documents.some((d) => d.docType === t && d.status === 'verified'));
  if (app.status === 'enrolled') return { current: 'enrolled', done: ['enquiry', 'application', 'documents', 'decision', 'offer', 'fee', 'enrolled'], waitingOn: null };
  if (app.status === 'accepted') return { current: 'fee', waitingOn: 'Admissions office: take the enrolment fee and enrol' };
  if (app.status === 'rejected') return { current: 'decision', blocked: ['offer', 'fee', 'enrolled'], waitingOn: 'Nobody: this application was not accepted' };
  if (app.status === 'waitlisted') return { current: 'decision', waitingOn: 'Admissions office: decide when a seat is free' };
  if (app.status === 'documents_pending') return { current: 'documents', waitingOn: 'The applicant: a document was sent back to replace' };
  if (verified) return { current: 'decision', waitingOn: 'Admissions office: accept, waitlist or reject' };
  return { current: 'documents', waitingOn: 'Admissions office: verify each required document below' };
}

/** One application in full: where it stands, details, documents, application fee, merit score and the decision buttons. */
export default function AdminApplicationDetail({ id, onClose, onChanged, onSecret, onEnrol }) {
  const { confirm, prompt, toast } = useDialogs();
  const { data, loading, error, reload } = useFetch(`/admin/admissions/${id}`);
  const [err, setErr] = useState('');
  const [viewing, setViewing] = useState(null);
  const [uploading, setUploading] = useState('');
  const fileRef = useRef(null);
  const pendingType = useRef('other');
  const app = data?.application;

  const run = async (fn) => {
    setErr('');
    try { await fn(); reload(); onChanged(); } catch (e) { setErr(e.message); }
  };
  const review = async (d, status) => {
    const remark = status === 'rejected' ? await prompt('Why is this document rejected? The applicant will see this.', { required: true, title: 'Reject document', confirmLabel: 'Reject', danger: true }) : '';
    if (status === 'rejected' && !remark) return;
    run(() => api.put(`/admin/admissions/${id}/documents/${d.id}`, { status, remark }));
  };
  const decide = async (decision) => {
    const note = decision === 'accept' ? '' : await prompt(decision === 'reject' ? 'Reason for rejection (shown to the applicant):' : 'Note for the waitlist (shown to the applicant):', { required: true, title: decision === 'reject' ? 'Reject application' : 'Waitlist application', confirmLabel: decision === 'reject' ? 'Reject' : 'Waitlist', danger: decision === 'reject' });
    if (decision !== 'accept' && !note) return;
    run(() => api.post(`/admin/admissions/${id}/decision`, { decision, note }));
  };
  const enroll = async () => {
    if (onEnrol) { onEnrol(app); return; }
    if (!(await confirm('Enrol this applicant? A PRN and a student login will be created.', { confirmLabel: 'Enrol student' }))) return;
    run(async () => { const r = await api.post(`/admin/admissions/${id}/enroll`); onSecret(r.student); });
  };
  const markFee = async (action) => {
    const reference = await prompt(action === 'paid' ? 'Receipt number or note (optional):' : 'Why is the fee being waived?', {
      required: action === 'waived', multiline: false, title: action === 'paid' ? `Record ${inr(app.feeAmount)} as paid` : 'Waive the application fee', confirmLabel: action === 'paid' ? 'Mark as paid' : 'Waive',
    });
    if (reference === null) return;
    run(async () => { await api.put(`/admin/admissions/${id}/fee`, { action, reference }); toast.success(action === 'paid' ? 'Fee recorded as paid.' : 'Fee waived.'); });
  };
  const setMerit = async () => {
    const v = await prompt('Merit score for the merit list (0 to 1000). Leave empty to use the qualifying percentage.', { multiline: false, title: 'Merit score', defaultValue: app.meritScore ?? '', confirmLabel: 'Save' });
    if (v === null) return;
    run(() => api.put(`/admin/admissions/${id}/merit`, { meritScore: v === '' ? null : Number(v) }));
  };
  const upload = async (file) => {
    if (!file) return;
    const t = pendingType.current;
    setUploading(t); setErr('');
    const form = new FormData(); form.set('docType', t); form.set('file', file);
    try { await api.post(`/admin/admissions/${id}/documents`, form); toast.success(`${DOC_LABEL[t]} added and marked verified.`); reload(); onChanged(); }
    catch (e) { setErr(e.message); } finally { setUploading(''); }
  };

  const p = app?.personal || {}; const g = app?.guardian || {}; const e = app?.previousEducation || {}; const x = app?.entrance || {};
  const fee = app && FEE_STATUS[app.feeStatus];
  return (
    <Modal open title={app ? `${app.applicationNo} - ${app.name}` : 'Application'} onClose={onClose} width={820}>
      <DataBoundary loading={loading && !data} error={error} data={data} reload={reload}>
        {app && (
          <>
            <StepBar process="admissions" {...stepOf(app)} />
            {err && <p className="form-error">{err}</p>}
            <div className="fields fields--3" style={{ marginTop: 12 }}>
              <div><span className="muted">Status</span><br /><Badge tone={STATUS[app.status].tone}>{STATUS[app.status].label}</Badge>{app.source === 'walk_in' && <span className="tag">Walk-in</span>}</div>
              <div><span className="muted">Course</span><br />{app.course}</div>
              <div><span className="muted">Date of birth</span><br />{app.dob ? fmtDate(app.dob) : '-'}</div>
              <div><span className="muted">Email</span><br />{app.email}</div>
              <div><span className="muted">Phone</span><br />{app.phone || '-'}</div>
              <div><span className="muted">Gender</span><br />{app.gender || '-'}</div>
              <div><span className="muted">Nationality</span><br />{p.nationality || '-'}</div>
              <div><span className="muted">Category</span><br />{p.category || '-'}</div>
              <div><span className="muted">Blood group</span><br />{p.bloodGroup || '-'}</div>
              <div style={{ gridColumn: '1 / -1' }}><span className="muted">Address</span><br />{app.address || '-'}</div>
              <div><span className="muted">Father / Mother</span><br />{[g.fatherName, g.motherName].filter(Boolean).join(' / ') || '-'}</div>
              <div><span className="muted">Guardian</span><br />{g.name || '-'} {g.relation && `(${g.relation})`}<br />{g.phone}{g.email && <><br />{g.email}</>}</div>
              <div><span className="muted">Occupation</span><br />{g.occupation || '-'}</div>
              <div style={{ gridColumn: 'span 2' }}><span className="muted">Last qualification</span><br />
                {[e.qualification, e.institution, e.board, e.year, e.percentage && `${e.percentage}%`].filter(Boolean).join(' - ') || '-'}</div>
              <div><span className="muted">10th</span><br />{[e.tenth?.board, e.tenth?.year, e.tenth?.percentage && `${e.tenth.percentage}%`].filter(Boolean).join(' - ') || '-'}</div>
              <div style={{ gridColumn: 'span 2' }}><span className="muted">Entrance exam</span><br />{[x.exam, x.rollNo && `Roll ${x.rollNo}`, x.score && `Score ${x.score}`].filter(Boolean).join(' - ') || '-'}</div>
              <div><span className="muted">Merit</span><br />
                <strong>{app.meritValue ?? '-'}</strong>{app.meritScore !== null && <span className="muted"> (set by office)</span>}{' '}
                <button type="button" className="btn btn--outline btn--sm" onClick={setMerit}>Set score</button></div>
            </div>

            {app.feeStatus !== 'none' && (
              <div className={`fee-box ${app.feeStatus === 'pending' ? '' : 'fee-box--paid'}`} style={{ marginTop: 14 }}>
                <div>
                  <strong>Application fee</strong> <Badge tone={fee.tone}>{fee.label}</Badge>
                  <div className="fee-box__amount">{inr(app.feeAmount)}</div>
                  {app.feeStatus !== 'pending' && <span className="muted">{app.feeReference}{app.feePaidAt ? ` - ${fmtDate(String(app.feePaidAt).slice(0, 10))}` : ''}</span>}
                </div>
                {app.feeStatus === 'pending' && app.status !== 'rejected' && app.status !== 'enrolled' && (
                  <div className="row-actions">
                    <button type="button" className="btn btn--primary btn--sm" onClick={() => markFee('paid')}>Mark as paid</button>
                    <button type="button" className="btn btn--outline btn--sm" onClick={() => markFee('waived')}>Waive</button>
                  </div>
                )}
              </div>
            )}

            <h4 style={{ margin: '18px 0 8px' }}>Documents</h4>
            {app.documents.length === 0 ? <p className="muted">Nothing uploaded yet.</p> : (
              <table className="table">
                <tbody>
                  {app.documents.map((d) => (
                    <tr key={d.id}>
                      <td><strong>{DOC_LABEL[d.docType]}</strong><div className="muted">{d.name}</div></td>
                      <td><Badge tone={DOC_TONE[d.status]}>{d.status}</Badge>{d.remark && <div className="muted">{d.remark}</div>}</td>
                      <td>
                        <div className="row-actions">
                          <button type="button" className="btn btn--primary btn--sm" onClick={() => setViewing(app.documents.findIndex((y) => y.id === d.id))}><Eye size={13} /> View</button>
                          <a className="icon-btn" href={`/api/files/${d.fileId}?download=1`} aria-label={`Download ${DOC_LABEL[d.docType]}`} title="Download a copy"><Download size={15} /></a>
                          {OPEN.includes(app.status) && (
                            <>
                              <button type="button" className="btn btn--outline btn--sm" onClick={() => review(d, 'verified')}><CheckCircle2 size={13} /> Verify</button>
                              <button type="button" className="btn btn--outline btn--sm" onClick={() => review(d, 'rejected')}><XCircle size={13} /> Reject</button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {OPEN.includes(app.status) && (
              <div style={{ marginTop: 10 }}>
                <span className="muted">Received a document at the office? Scan it and add it here - it is marked verified.</span>
                <div className="doc-slots" style={{ marginTop: 6 }}>
                  {UPLOADABLE.map((t) => (
                    <button key={t} type="button" className="btn btn--outline btn--sm" disabled={!!uploading}
                      onClick={() => { pendingType.current = t; fileRef.current?.click(); }}>
                      <Upload size={13} /> {uploading === t ? 'Uploading...' : DOC_LABEL[t]}
                    </button>
                  ))}
                  <input ref={fileRef} type="file" hidden accept="application/pdf,image/png,image/jpeg" onChange={(ev) => { upload(ev.target.files[0]); ev.target.value = ''; }} />
                </div>
              </div>
            )}
            {viewing !== null && (
              <DocumentViewer
                docs={app.documents.map((d) => ({ fileId: d.fileId, name: d.name, title: DOC_LABEL[d.docType] }))}
                index={viewing} onIndex={setViewing} onClose={() => setViewing(null)}
                actions={() => {
                  const d = app.documents[viewing];
                  return (
                    <>
                      <span><Badge tone={DOC_TONE[d.status]}>{d.status}</Badge>{d.remark && <span className="muted"> {d.remark}</span>}</span>
                      {OPEN.includes(app.status) && (
                        <span style={{ display: 'flex', gap: 8 }}>
                          <button type="button" className="btn btn--outline btn--sm" onClick={() => review(d, 'rejected')}><XCircle size={13} /> Reject</button>
                          <button type="button" className="btn btn--primary btn--sm" onClick={() => { review(d, 'verified'); if (viewing < app.documents.length - 1) setViewing(viewing + 1); else setViewing(null); }}><CheckCircle2 size={13} /> Verify{viewing < app.documents.length - 1 ? ' and next' : ''}</button>
                        </span>
                      )}
                    </>
                  );
                }}
              />
            )}
            {app.decisionNote && <p style={{ marginTop: 12 }}><strong>Decision note:</strong> {app.decisionNote}</p>}

            <div className="form-actions">
              {['submitted', 'waitlisted'].includes(app.status) && (
                <>
                  <button type="button" className="btn btn--outline" onClick={() => decide('reject')}>Reject</button>
                  {app.status === 'submitted' && <button type="button" className="btn btn--outline" onClick={() => decide('waitlist')}>Waitlist</button>}
                  <button type="button" className="btn btn--primary" onClick={() => decide('accept')}>Accept</button>
                </>
              )}
              {app.status === 'accepted' && <button type="button" className="btn btn--primary" onClick={enroll}>Take fee and enrol</button>}
              {app.status === 'enrolled' && <Badge tone="green">Enrolled</Badge>}
            </div>
          </>
        )}
      </DataBoundary>
    </Modal>
  );
}

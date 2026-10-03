import { useState } from 'react';
import { CheckCircle2, ClipboardCheck, Download, Eye, Search, XCircle } from 'lucide-react';
import { useFetch } from '../../hooks/useFetch.js';
import { useTenantConfig } from '../../hooks/useTenantConfig.js';
import { api } from '../../api/http.js';
import { Badge, Card, PageBanner, Tabs } from '../../components/ui/Ui.jsx';
import { DataBoundary, EmptyState } from '../../components/ui/Feedback.jsx';
import Modal from '../../components/ui/Modal.jsx';
import DocumentViewer from '../../components/ui/DocumentViewer.jsx';
import { DOC_LABEL, DOC_TONE, STATUS } from '../../components/admissions/status.js';
import { fmtDate } from '../../utils/dates.js';

const TABS = [
  { id: '', label: 'All' }, { id: 'submitted', label: 'To review' }, { id: 'documents_pending', label: 'Awaiting documents' },
  { id: 'accepted', label: 'Accepted' }, { id: 'waitlisted', label: 'Waitlisted' }, { id: 'rejected', label: 'Rejected' }, { id: 'enrolled', label: 'Enrolled' },
];

export default function Admissions() {
  const { t, tenant } = useTenantConfig();
  const [status, setStatus] = useState('submitted');
  const [search, setSearch] = useState('');
  const [openId, setOpenId] = useState(null);
  const [secret, setSecret] = useState(null);
  const qs = new URLSearchParams();
  if (status) qs.set('status', status);
  if (search) qs.set('search', search);
  const list = useFetch(`/admin/admissions?${qs}`);
  const applyLink = `${window.location.origin}/apply/${tenant?.code}`;

  return (
    <>
      <PageBanner icon={ClipboardCheck} title={t('admission', 'Admissions')} subtitle="Review applications, verify documents, decide and enrol" />
      <Card>
        <p style={{ margin: 0 }}>Public application link: <a href={applyLink} target="_blank" rel="noreferrer"><strong>{applyLink}</strong></a> <span className="muted">- share it on your website or posters.</span></p>
      </Card>
      <Card>
        <div className="toolbar">
          <Tabs tabs={TABS.map((x) => ({ ...x, label: `${x.label}${x.id && list.data?.counts?.[x.id] ? ` (${list.data.counts[x.id]})` : ''}` }))} active={status} onChange={setStatus} />
          <div className="input-wrap" style={{ minWidth: 220 }}>
            <Search size={14} /><input className="input input--icon" placeholder="Name, email or number" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>
        <DataBoundary loading={list.loading} error={list.error} data={list.data} reload={list.reload}>
          {list.data && (list.data.applications.length === 0 ? <EmptyState title="No applications here" /> : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Number</th><th>Applicant</th><th>{t('course', 'Course')}</th><th>Submitted</th><th>Status</th><th /></tr></thead>
                <tbody>
                  {list.data.applications.map((a) => (
                    <tr key={a.id}>
                      <td>{a.applicationNo}</td>
                      <td><strong>{a.name}</strong><div className="muted">{a.email}</div></td>
                      <td>{a.course}</td>
                      <td className="muted">{a.submittedAt ? fmtDate(a.submittedAt.slice(0, 10)) : '-'}</td>
                      <td><Badge tone={STATUS[a.status].tone}>{STATUS[a.status].label}</Badge></td>
                      <td><button type="button" className="btn btn--outline btn--sm" onClick={() => setOpenId(a.id)}>Review</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </DataBoundary>
      </Card>

      {openId && <Detail id={openId} onClose={() => setOpenId(null)} onChanged={list.reload} onSecret={setSecret} />}
      <Modal open={!!secret} title="Student enrolled" onClose={() => setSecret(null)} width={460}>
        {secret && (
          <>
            <div className="secret-box">
              <div>PRN / login ID: <strong>{secret.prn}</strong></div>
              <div>Email: <strong>{secret.email}</strong></div>
              <div>One-time password:<br /><code>{secret.temporaryPassword}</code></div>
            </div>
            <p className="muted" style={{ marginTop: 12 }}>Shown only once. Give it to the student; they sign in with the institute code <strong>{tenant?.code}</strong>.</p>
            <div className="form-actions"><button type="button" className="btn btn--primary" onClick={() => setSecret(null)}>Done</button></div>
          </>
        )}
      </Modal>
    </>
  );
}

function Detail({ id, onClose, onChanged, onSecret }) {
  const { data, loading, error, reload } = useFetch(`/admin/admissions/${id}`);
  const [err, setErr] = useState('');
  const app = data?.application;

  const [viewing, setViewing] = useState(null); // index into the application's documents
  const run = async (fn) => {
    setErr('');
    try { await fn(); reload(); onChanged(); } catch (e) { setErr(e.message); }
  };
  const review = (d, status) => {
    const remark = status === 'rejected' ? prompt('Why is this document rejected? The applicant will see this.') : '';
    if (status === 'rejected' && !remark) return;
    run(() => api.put(`/admin/admissions/${id}/documents/${d.id}`, { status, remark }));
  };
  const decide = (decision) => {
    const note = decision === 'accept' ? '' : prompt(decision === 'reject' ? 'Reason for rejection (shown to the applicant):' : 'Note for the waitlist (shown to the applicant):');
    if (decision !== 'accept' && !note) return;
    run(() => api.post(`/admin/admissions/${id}/decision`, { decision, note }));
  };
  const enroll = () => {
    if (!confirm('Enrol this applicant? A PRN and a student login will be created.')) return;
    run(async () => { const r = await api.post(`/admin/admissions/${id}/enroll`); onSecret(r.student); });
  };

  return (
    <Modal open title={app ? `${app.applicationNo} - ${app.name}` : 'Application'} onClose={onClose} width={780}>
      <DataBoundary loading={loading && !data} error={error} data={data} reload={reload}>
        {app && (
          <>
            {err && <p className="form-error">{err}</p>}
            <div className="fields fields--3">
              <div><span className="muted">Status</span><br /><Badge tone={STATUS[app.status].tone}>{STATUS[app.status].label}</Badge></div>
              <div><span className="muted">Course</span><br />{app.course}</div>
              <div><span className="muted">Date of birth</span><br />{fmtDate(app.dob)}</div>
              <div><span className="muted">Email</span><br />{app.email}</div>
              <div><span className="muted">Phone</span><br />{app.phone || '-'}</div>
              <div><span className="muted">Gender</span><br />{app.gender || '-'}</div>
              <div style={{ gridColumn: '1 / -1' }}><span className="muted">Address</span><br />{app.address || '-'}</div>
              <div><span className="muted">Guardian</span><br />{app.guardian.name || '-'} {app.guardian.relation && `(${app.guardian.relation})`}<br />{app.guardian.phone}</div>
              <div style={{ gridColumn: 'span 2' }}><span className="muted">Previous education</span><br />
                {[app.previousEducation.institution, app.previousEducation.qualification, app.previousEducation.year, app.previousEducation.percentage && `${app.previousEducation.percentage}%`].filter(Boolean).join(' - ') || '-'}</div>
            </div>

            <h4 style={{ margin: '18px 0 8px' }}>Documents</h4>
            <table className="table">
              <tbody>
                {app.documents.map((d) => (
                  <tr key={d.id}>
                    <td><strong>{DOC_LABEL[d.docType]}</strong><div className="muted">{d.name}</div></td>
                    <td><Badge tone={DOC_TONE[d.status]}>{d.status}</Badge>{d.remark && <div className="muted">{d.remark}</div>}</td>
                    <td>
                      <div className="row-actions">
                        <button type="button" className="btn btn--primary btn--sm" onClick={() => setViewing(app.documents.findIndex((x) => x.id === d.id))}><Eye size={13} /> View</button>
                        <a className="icon-btn" href={`/api/files/${d.fileId}?download=1`} aria-label={`Download ${DOC_LABEL[d.docType]}`} title="Download a copy"><Download size={15} /></a>
                        {['submitted', 'documents_pending'].includes(app.status) && (
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
            {viewing !== null && (
              <DocumentViewer
                docs={app.documents.map((d) => ({ fileId: d.fileId, name: d.name, title: DOC_LABEL[d.docType] }))}
                index={viewing} onIndex={setViewing} onClose={() => setViewing(null)}
                actions={(v) => {
                  const d = app.documents[viewing];
                  const open = ['submitted', 'documents_pending'].includes(app.status);
                  return (
                    <>
                      <span><Badge tone={DOC_TONE[d.status]}>{d.status}</Badge>{d.remark && <span className="muted"> {d.remark}</span>}</span>
                      {open && (
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
              {app.status === 'accepted' && <button type="button" className="btn btn--primary" onClick={enroll}>Enrol student (generate PRN)</button>}
              {app.status === 'enrolled' && <Badge tone="green">Enrolled</Badge>}
            </div>
          </>
        )}
      </DataBoundary>
    </Modal>
  );
}

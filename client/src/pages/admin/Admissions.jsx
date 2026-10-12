import { useEffect, useState } from 'react';
import { BarChart3, ClipboardCheck, Plus, Search, Settings2 } from 'lucide-react';
import { useFetch } from '../../hooks/useFetch.js';
import { useTabParam } from '../../hooks/useTabParam.js';
import { useTenantConfig } from '../../hooks/useTenantConfig.js';
import { api } from '../../api/http.js';
import { Badge, Card, PageBanner } from '../../components/ui/Ui.jsx';
import { DataBoundary, EmptyState } from '../../components/ui/Feedback.jsx';
import Modal from '../../components/ui/Modal.jsx';
import { useDialogs } from '../../components/ui/Dialogs.jsx';
import AdminApplicationDetail from '../../components/admissions/AdminApplicationDetail.jsx';
import WalkInModal from '../../components/admissions/WalkInModal.jsx';
import AdmissionSettings from '../../components/admissions/AdmissionSettings.jsx';
import MeritListModal from '../../components/admissions/MeritListModal.jsx';
import { FEE_STATUS, STATUS } from '../../components/admissions/status.js';
import { fmtDate } from '../../utils/dates.js';

const PIPE = [
  { id: 'submitted', label: 'To review' },
  { id: 'documents_pending', label: 'Awaiting documents' },
  { id: 'accepted', label: 'Ready to enrol' },
  { id: 'waitlisted', label: 'Waitlisted' },
  { id: 'enrolled', label: 'Enrolled' },
  { id: 'rejected', label: 'Rejected' },
  { id: 'fee', label: 'Fee pending', warn: true },
  { id: 'all', label: 'All' },
];
const PIPE_IDS = PIPE.map((p) => p.id);

export default function Admissions() {
  const { t, tenant } = useTenantConfig();
  const { confirm, prompt, toast } = useDialogs();
  const [tab, setTab] = useTabParam('submitted', PIPE_IDS);
  const [search, setSearch] = useState('');
  const [courseId, setCourseId] = useState('');
  const [openId, setOpenId] = useState(null);
  const [secret, setSecret] = useState(null);
  const [panel, setPanel] = useState(null); // 'walkin' | 'settings' | 'merit'
  const [picked, setPicked] = useState(() => new Set());
  const [outcome, setOutcome] = useState(null);

  const qs = new URLSearchParams();
  if (tab === 'fee') qs.set('fee', 'pending'); else if (tab !== 'all') qs.set('status', tab);
  if (courseId) qs.set('courseId', courseId);
  if (search) qs.set('search', search);
  const list = useFetch(`/admin/admissions?${qs}`);
  const courses = useFetch('/admin/courses');
  const settings = useFetch('/admin/admissions/settings');
  const applyLink = `${window.location.origin}/apply/${tenant?.code}`;
  const counts = list.data?.counts || {};
  const rows = list.data?.applications || [];
  const courseList = courses.data?.courses || [];
  const one = t('course', 'Course');

  useEffect(() => { setPicked(new Set()); }, [tab, courseId, search]);

  const countOf = (id) => (id === 'fee' ? counts.feePending : id === 'all' ? undefined : counts[id]) ?? 0;
  const allPicked = rows.length > 0 && rows.every((a) => picked.has(a.id));
  const toggle = (id) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const bulk = async (decision) => {
    const verb = { accept: 'Accept', waitlist: 'Waitlist', reject: 'Reject' }[decision];
    const note = decision === 'accept' ? '' : await prompt(`${verb} ${picked.size} application${picked.size === 1 ? '' : 's'}. This note is sent to each applicant:`, { required: true, title: `${verb} applications`, confirmLabel: verb, danger: decision === 'reject' });
    if (decision !== 'accept' && !note) return;
    if (decision === 'accept' && !(await confirm(`Accept ${picked.size} application${picked.size === 1 ? '' : 's'}? Each applicant is emailed. Applications with unverified documents or an unpaid fee are skipped.`, { confirmLabel: 'Accept' }))) return;
    try {
      const r = await api.post('/admin/admissions/bulk-decision', { ids: [...picked], decision, note });
      setPicked(new Set());
      list.reload();
      if (r.failed.length) setOutcome(r); else toast.success(`${r.done.length} application${r.done.length === 1 ? '' : 's'} updated.`);
    } catch (err) { toast.error(err); }
  };

  return (
    <>
      <PageBanner
        icon={ClipboardCheck} title={t('admission', 'Admissions')} subtitle="Review applications, verify documents, decide and enrol"
        actions={(
          <div className="row-actions">
            <button type="button" className="btn btn--outline btn--sm" onClick={() => setPanel("walkin")}><Plus size={14} /> Walk-in application</button>
            <button type="button" className="btn btn--outline btn--sm" onClick={() => setPanel('merit')}><BarChart3 size={14} /> Merit list</button>
            <button type="button" className="btn btn--outline btn--sm" onClick={() => setPanel('settings')}><Settings2 size={14} /> Settings</button>
          </div>
        )}
      />
      <Card>
        <p style={{ margin: 0 }}>
          Public application link: <a href={applyLink} target="_blank" rel="noreferrer"><strong>{applyLink}</strong></a> <span className="muted">- share it on your website or posters.</span>
          {settings.data && (
            <> {settings.data.settings.accepting ? <Badge tone="green">Open</Badge> : <Badge tone="red">Closed</Badge>}
              {settings.data.settings.applicationFee > 0 && <> <Badge tone="blue">Fee ₹{settings.data.settings.applicationFee}</Badge></>}</>
          )}
          {counts.drafts > 0 && <span className="muted"> - {counts.drafts} started but not submitted.</span>}
        </p>
      </Card>

      <div className="pipeline" role="tablist" aria-label="Application stages">
        {PIPE.map((p) => (
          <button key={p.id} type="button" role="tab" aria-selected={tab === p.id} className={`pipe ${tab === p.id ? 'is-active' : ''} ${p.warn && countOf(p.id) > 0 ? 'pipe--warn' : ''}`} onClick={() => setTab(p.id)}>
            <span className="pipe__n">{p.id === 'all' ? '' : countOf(p.id)}{p.id === 'all' && <Search size={18} />}</span>
            <span className="pipe__l">{p.label}</span>
          </button>
        ))}
      </div>

      <Card>
        <div className="toolbar">
          <div className="toolbar__filters">
            <select aria-label={one} value={courseId} onChange={(e) => setCourseId(e.target.value)}>
              <option value="">All {t('courses', 'Courses').toLowerCase()}</option>
              {courseList.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <div className="input-wrap" style={{ minWidth: 220 }}>
              <Search size={14} /><input className="input input--icon" placeholder="Name, email or number" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          </div>
        </div>
        {picked.size > 0 && (
          <div className="bulkbar" role="region" aria-label="Actions for selected applications">
            <strong>{picked.size} selected</strong>
            <button type="button" className="btn btn--primary btn--sm" onClick={() => bulk('accept')}>Accept</button>
            <button type="button" className="btn btn--outline btn--sm" onClick={() => bulk('waitlist')}>Waitlist</button>
            <button type="button" className="btn btn--outline btn--sm" onClick={() => bulk('reject')}>Reject</button>
            <button type="button" className="btn btn--outline btn--sm" onClick={() => setPicked(new Set())}>Clear</button>
          </div>
        )}
        <DataBoundary loading={list.loading} error={list.error} data={list.data} reload={list.reload}>
          {list.data && (rows.length === 0 ? <EmptyState title="No applications here" hint="Try another stage above, or clear the filters." /> : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th className="col-check"><input type="checkbox" aria-label="Select all" checked={allPicked} onChange={() => setPicked(allPicked ? new Set() : new Set(rows.map((a) => a.id)))} /></th>
                    <th>Number</th><th>Applicant</th><th>{one}</th><th>Merit</th><th>Fee</th><th>Submitted</th><th>Status</th><th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((a) => (
                    <tr key={a.id}>
                      <td className="col-check"><input type="checkbox" aria-label={`Select ${a.name}`} checked={picked.has(a.id)} onChange={() => toggle(a.id)} /></td>
                      <td>{a.applicationNo}</td>
                      <td><strong>{a.name}</strong>{a.source === 'walk_in' && <span className="tag">Walk-in</span>}<div className="muted">{a.email}</div></td>
                      <td>{a.course}</td>
                      <td>{a.meritValue ?? '-'}</td>
                      <td>{a.feeStatus === 'none' ? <span className="muted">-</span> : <Badge tone={FEE_STATUS[a.feeStatus].tone}>{FEE_STATUS[a.feeStatus].label}</Badge>}</td>
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

      {openId && <AdminApplicationDetail id={openId} onClose={() => setOpenId(null)} onChanged={list.reload} onSecret={setSecret} />}
      {panel === 'walkin' && (
        <WalkInModal
          courses={courseList} courseLabel={one} fee={settings.data?.settings.applicationFee || 0} onClose={() => setPanel(null)}
          onCreated={(id, open) => { list.reload(); if (open) { setPanel(null); setOpenId(id); } }}
        />
      )}
      {panel === 'settings' && <AdmissionSettings onClose={() => { setPanel(null); settings.reload(); }} />}
      {panel === 'merit' && <MeritListModal courseLabel={one} onClose={() => setPanel(null)} />}

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

      <Modal open={!!outcome} title="Some could not be updated" onClose={() => setOutcome(null)} width={560}>
        {outcome && (
          <>
            <p><strong>{outcome.done.length}</strong> updated. <strong>{outcome.failed.length}</strong> left as they were:</p>
            <ul className="todo">{outcome.failed.map((f) => <li key={f.id}><strong>{f.applicationNo}</strong> - {f.reason}</li>)}</ul>
            <div className="form-actions"><button type="button" className="btn btn--primary" onClick={() => setOutcome(null)}>Close</button></div>
          </>
        )}
      </Modal>
    </>
  );
}

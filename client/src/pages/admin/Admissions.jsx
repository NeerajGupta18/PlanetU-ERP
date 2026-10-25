import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { BarChart3, ClipboardCheck, Columns3, List, Plus, Search, Settings2, UserPlus } from 'lucide-react';
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
import Board from '../../components/admissions/Board.jsx';
import EnquiryModal from '../../components/admissions/EnquiryModal.jsx';
import EnrolModal from '../../components/admissions/EnrolModal.jsx';
import ShareMessage from '../../components/ui/ShareMessage.jsx';
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

/** The header's "Next:" line: the step with work waiting that is closest to a seat being filled. */
function nextStep(counts) {
  const n = (k) => counts[k] || 0;
  const s = (k) => (n(k) === 1 ? '' : 's');
  if (n('offer')) return `${n('offer')} accepted applicant${s('offer')} to enrol`;
  if (n('fee')) return `${n('fee')} enrolled student${s('fee')} still to pay the enrolment fee`;
  if (n('documents')) return `${n('documents')} application${s('documents')} checked and waiting for a decision`;
  if (n('application')) return `${n('application')} application${s('application')} with documents to check`;
  if (n('enquiry')) return `${n('enquiry')} enquir${n('enquiry') === 1 ? 'y' : 'ies'} to turn into applications`;
  return 'Add an enquiry, or share the application link below';
}

export default function Admissions() {
  const { t, tenant } = useTenantConfig();
  const { confirm, prompt, toast } = useDialogs();
  const [tab, setTab] = useTabParam('submitted', PIPE_IDS);
  const [params, setParams] = useSearchParams();
  const view = params.get('view') === 'list' ? 'list' : 'board';
  const setView = (v) => setParams((p) => { const x = new URLSearchParams(p); if (v === 'board') x.delete('view'); else x.set('view', v); return x; }, { replace: true });
  const [enquiry, setEnquiry] = useState(null); // an enquiry being filled in at the desk
  const [enrolling, setEnrolling] = useState(null); // the full application being enrolled
  const [shared, setShared] = useState(null); // { name, invite } after "Send form link"
  const [search, setSearch] = useState('');
  const [courseId, setCourseId] = useState('');
  // ?open=<id> (from Approvals or a notification) opens that item straight away
  const [openId, setOpenId] = useState(() => new URLSearchParams(window.location.search).get('open'));
  const [secret, setSecret] = useState(null);
  const [panel, setPanel] = useState(null); // 'walkin' | 'settings' | 'merit'
  const [picked, setPicked] = useState(() => new Set());
  const [outcome, setOutcome] = useState(null);

  const qs = new URLSearchParams();
  if (tab === 'fee') qs.set('fee', 'pending'); else if (tab !== 'all') qs.set('status', tab);
  if (courseId) qs.set('courseId', courseId);
  if (search) qs.set('search', search);
  const list = useFetch(view === 'list' ? `/admin/admissions?${qs}` : null);
  const bq = new URLSearchParams();
  if (courseId) bq.set('courseId', courseId);
  if (search) bq.set('search', search);
  const boardData = useFetch(`/admin/admissions/board?${bq}`);
  const reloadAll = () => { boardData.reload(); if (view === 'list') list.reload(); };
  const courses = useFetch('/admin/courses');
  const settings = useFetch('/admin/admissions/settings');
  const applyLink = `${window.location.origin}/apply/${tenant?.code}`;
  const counts = list.data?.counts || {};
  const rows = list.data?.applications || [];
  const courseList = courses.data?.courses || [];
  const one = t('course', 'Course');

  useEffect(() => { setPicked(new Set()); }, [tab, courseId, search]);

  const fill = async (card) => {
    try { setEnquiry((await api.get(`/admin/admissions/enquiries/${card.id}`)).enquiry); } catch (err) { toast.error(err); }
  };
  const sendLink = async (card) => {
    try { const r = await api.post(`/admin/admissions/enquiries/${card.id}/form-link`); setShared({ name: card.name, invite: r.invite }); } catch (err) { toast.error(err); }
  };
  const removeEnquiry = async (card) => {
    if (!(await confirm(`Remove the enquiry from ${card.name}? Their started application is deleted.`, { danger: true, confirmLabel: 'Remove' }))) return;
    try { await api.del(`/admin/admissions/enquiries/${card.id}`); toast.success('Enquiry removed.'); boardData.reload(); } catch (err) { toast.error(err); }
  };
  const enrol = async (cardOrApp) => {
    try { setEnrolling(cardOrApp.guardian ? cardOrApp : (await api.get(`/admin/admissions/${cardOrApp.id}`)).application); } catch (err) { toast.error(err); }
  };
  const bc = boardData.data?.counts || {};

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
      reloadAll();
      if (r.failed.length) setOutcome(r); else toast.success(`${r.done.length} application${r.done.length === 1 ? '' : 's'} updated.`);
    } catch (err) { toast.error(err); }
  };

  return (
    <>
      <PageBanner
        icon={ClipboardCheck} title={t('admission', 'Admissions')} subtitle="From the first enquiry to an enrolled student"
        next={boardData.data ? nextStep(bc) : undefined}
        primary={{ label: 'Add enquiry', icon: UserPlus, onClick: () => setPanel('enquiry') }}
        actions={(
          <>
            <button type="button" className="btn btn--outline btn--sm" onClick={() => setPanel('walkin')}><Plus size={14} /> Walk-in application</button>
            <button type="button" className="btn btn--outline btn--sm" onClick={() => setPanel('merit')}><BarChart3 size={14} /> Merit list</button>
            <button type="button" className="btn btn--outline btn--sm" onClick={() => setPanel('settings')}><Settings2 size={14} /> Settings</button>
          </>
        )}
      />
      <Card>
        <p style={{ margin: 0 }}>
          Public application link: <a href={applyLink} target="_blank" rel="noreferrer"><strong>{applyLink}</strong></a> <span className="muted">- share it on your website or posters.</span>
          {settings.data && (
            <> {settings.data.settings.accepting ? <Badge tone="green">Open</Badge> : <Badge tone="red">Closed</Badge>}
              {settings.data.settings.applicationFee > 0 && <> <Badge tone="blue">Fee ₹{settings.data.settings.applicationFee}</Badge></>}</>
          )}
          {bc.rejected > 0 && <span className="muted"> - {bc.rejected} not accepted (see the list view).</span>}
        </p>
      </Card>

      <div className="toolbar board-toolbar">
        <div className="toolbar__filters">
          <select className="input" aria-label={one} value={courseId} onChange={(e) => setCourseId(e.target.value)}>
            <option value="">All {t('courses', 'Courses').toLowerCase()}</option>
            {courseList.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <div className="input-wrap" style={{ minWidth: 220 }}>
            <Search size={14} /><input className="input input--icon" placeholder="Name, email, phone or number" aria-label="Search applications" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>
        <div className="segmented" role="group" aria-label="View">
          <button type="button" className={`segmented__item ${view === 'board' ? 'is-active' : ''}`} aria-pressed={view === 'board'} onClick={() => setView('board')}><Columns3 size={15} aria-hidden="true" /> Board</button>
          <button type="button" className={`segmented__item ${view === 'list' ? 'is-active' : ''}`} aria-pressed={view === 'list'} onClick={() => setView('list')}><List size={15} aria-hidden="true" /> List</button>
        </div>
      </div>

      {view === 'board' && (
        <DataBoundary loading={boardData.loading} error={boardData.error} data={boardData.data} reload={boardData.reload}>
          {boardData.data && (
            <Board cards={boardData.data.cards} counts={bc} onOpen={setOpenId} onFill={fill} onSendLink={sendLink} onRemove={removeEnquiry} onEnrol={enrol} />
          )}
        </DataBoundary>
      )}

      {view === 'list' && (<>

      <div className="pipeline" role="tablist" aria-label="Application stages">
        {PIPE.map((p) => (
          <button key={p.id} type="button" role="tab" aria-selected={tab === p.id} className={`pipe ${tab === p.id ? 'is-active' : ''} ${p.warn && countOf(p.id) > 0 ? 'pipe--warn' : ''}`} onClick={() => setTab(p.id)}>
            <span className="pipe__n">{p.id === 'all' ? '' : countOf(p.id)}{p.id === 'all' && <Search size={18} />}</span>
            <span className="pipe__l">{p.label}</span>
          </button>
        ))}
      </div>

      <Card>
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
      </>)}

      {openId && <AdminApplicationDetail id={openId} onClose={() => setOpenId(null)} onChanged={reloadAll} onSecret={setSecret} onEnrol={(a) => { setOpenId(null); enrol(a); }} />}
      {panel === 'walkin' && (
        <WalkInModal
          courses={courseList} courseLabel={one} fee={settings.data?.settings.applicationFee || 0} onClose={() => setPanel(null)}
          onCreated={(id, open) => { reloadAll(); if (open) { setPanel(null); setOpenId(id); } }}
        />
      )}
      {enquiry && (
        <WalkInModal
          enquiry={enquiry} courses={courseList} courseLabel={one} fee={settings.data?.settings.applicationFee || 0} onClose={() => setEnquiry(null)}
          onCreated={(id, open) => { reloadAll(); if (open) { setEnquiry(null); setOpenId(id); } }}
        />
      )}
      {panel === 'enquiry' && <EnquiryModal courses={courseList} courseLabel={one} onClose={() => setPanel(null)} onCreated={reloadAll} />}
      {enrolling && <EnrolModal app={enrolling} onClose={() => setEnrolling(null)} onDone={reloadAll} />}
      <Modal open={!!shared} title={shared ? `Form link sent to ${shared.name}` : ''} onClose={() => setShared(null)} width={520}>
        {shared && (
          <>
            <p className="muted" style={{ marginTop: 0 }}>A new access code was emailed (the old one no longer works). To send it on WhatsApp too:</p>
            <ShareMessage message={shared.invite.message} whatsapp={shared.invite.whatsapp} />
            <div className="form-actions"><button type="button" className="btn btn--primary" onClick={() => setShared(null)}>Done</button></div>
          </>
        )}
      </Modal>
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

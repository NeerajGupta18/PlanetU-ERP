import { useState } from 'react';
import { Megaphone, Pencil, Pin, Plus, Search, Trash2 } from 'lucide-react';
import { useFetch } from '../../hooks/useFetch.js';
import { useTabParam } from '../../hooks/useTabParam.js';
import { api } from '../../api/http.js';
import { Badge, Card, PageBanner, Tabs } from '../../components/ui/Ui.jsx';
import { DataBoundary, EmptyState } from '../../components/ui/Feedback.jsx';
import Modal from '../../components/ui/Modal.jsx';
import { useDialogs } from '../../components/ui/Dialogs.jsx';
import { fmtDate, todayISO } from '../../utils/dates.js';

const STATES = [
  { id: 'live', label: 'Live' },
  { id: 'scheduled', label: 'Scheduled' },
  { id: 'draft', label: 'Drafts' },
  { id: 'expired', label: 'Expired' },
];
const AUDIENCE = { all: 'Everyone', students: 'Students', employees: 'Staff' };
const STATE_TONE = { live: 'green', scheduled: 'blue', draft: 'gray', expired: 'gray' };

function Editor({ notice, categories, courses, onClose, onSaved }) {
  const { toast } = useDialogs();
  const editing = !!notice.id;
  const [f, setF] = useState({
    title: notice.title || '', body: notice.body || '', category: notice.category || 'General', audience: notice.audience || 'all',
    courseId: notice.courseId || '', priority: notice.priority || 'normal', pinned: !!notice.pinned,
    noticeDate: notice.noticeDate ? String(notice.noticeDate).slice(0, 10) : todayISO(),
    expiresOn: notice.expiresOn ? String(notice.expiresOn).slice(0, 10) : '', status: notice.status || 'published', notify: false,
  });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const flag = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.checked }));

  const save = async (e) => {
    e.preventDefault(); setErr(''); setBusy(true);
    const body = { ...f, courseId: f.audience === 'students' ? f.courseId || null : null, expiresOn: f.expiresOn || null };
    try {
      const r = editing ? await api.put(`/admin/notices/${notice.id}`, body) : await api.post('/admin/notices', body);
      toast.success(r.emailed ? `Saved. Emailed ${r.emailed} ${r.emailed === 1 ? 'person' : 'people'}.` : 'Notice saved.');
      onSaved();
    } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };

  return (
    <Modal open title={editing ? 'Edit notice' : 'New notice'} onClose={onClose} width={680}>
      <form onSubmit={save}>
        {err && <p className="form-error">{err}</p>}
        <div className="fields">
          <label className="form-field form-field--full"><span className="label">Title *</span><input className="input" value={f.title} onChange={set('title')} maxLength={150} required /></label>
          <label className="form-field form-field--full"><span className="label">Message</span><textarea className="input" rows={5} value={f.body} onChange={set('body')} maxLength={5000} /></label>
          <label className="form-field"><span className="label">Category</span>
            <select className="input" value={f.category} onChange={set('category')}>{categories.map((c) => <option key={c}>{c}</option>)}</select></label>
          <label className="form-field"><span className="label">For</span>
            <select className="input" value={f.audience} onChange={set('audience')}>{Object.entries(AUDIENCE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          {f.audience === 'students' && (
            <label className="form-field"><span className="label">Only one course (optional)</span>
              <select className="input" value={f.courseId} onChange={set('courseId')}><option value="">All courses</option>{courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          )}
          <label className="form-field"><span className="label">Priority</span>
            <select className="input" value={f.priority} onChange={set('priority')}><option value="normal">Normal</option><option value="important">Important</option></select></label>
          <label className="form-field"><span className="label">Show from</span><input className="input" type="date" value={f.noticeDate} onChange={set('noticeDate')} required /></label>
          <label className="form-field"><span className="label">Last date (optional)</span><input className="input" type="date" min={f.noticeDate} value={f.expiresOn} onChange={set('expiresOn')} /></label>
          <label className="form-field"><span className="label">Status</span>
            <select className="input" value={f.status} onChange={set('status')}><option value="published">Published</option><option value="draft">Draft (only the office sees it)</option></select></label>
          <div className="form-field form-field--full" style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
            <label><input type="checkbox" checked={f.pinned} onChange={flag('pinned')} /> Pin to the top</label>
            {f.status === 'published' && (!editing || notice.status === 'draft') && (
              <label><input type="checkbox" checked={f.notify} onChange={flag('notify')} /> Also email the audience</label>
            )}
          </div>
        </div>
        <div className="form-actions">
          <button type="button" className="btn btn--outline" onClick={onClose}>Cancel</button>
          <button className="btn btn--primary" disabled={busy}>{busy ? 'Saving...' : f.status === 'draft' ? 'Save draft' : editing ? 'Save' : 'Publish'}</button>
        </div>
      </form>
    </Modal>
  );
}

export default function Notices() {
  const { confirm, toast } = useDialogs();
  const [tab, setTab] = useTabParam('live', STATES.map((s) => s.id));
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(null);
  const list = useFetch(`/admin/notices?state=${tab}${search ? `&search=${encodeURIComponent(search)}` : ''}`);
  const courses = useFetch('/admin/courses');
  const counts = list.data?.counts || {};

  const remove = async (n) => {
    if (!(await confirm(`Delete "${n.title}"? It disappears for everyone.`, { danger: true, confirmLabel: 'Delete' }))) return;
    try { await api.del(`/admin/notices/${n.id}`); list.reload(); } catch (err) { toast.error(err); }
  };

  return (
    <>
      <PageBanner
        icon={Megaphone} title="Notice board" subtitle="Announcements for students and staff"
        actions={<button type="button" className="btn btn--primary" onClick={() => setEditing({})}><Plus size={15} /> New notice</button>}
      />
      <Tabs tabs={STATES.map((s) => ({ id: s.id, label: `${s.label}${counts[s.id] ? ` (${counts[s.id]})` : ''}` }))} active={tab} onChange={setTab} />
      <Card>
        <div className="toolbar">
          <div className="input-wrap" style={{ minWidth: 220 }}>
            <Search size={14} /><input className="input input--icon" placeholder="Search notices" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>
        <DataBoundary loading={list.loading} error={list.error} data={list.data} reload={list.reload}>
          {list.data && (list.data.notices.length === 0 ? <EmptyState title="Nothing here" hint="Notices reach students, parents and staff on their dashboard." action={{ label: 'Post a notice', onClick: () => setEditing({}) }} /> : (
            <div className="table-wrap">
              <table className="table table--stack">
                <thead><tr><th>Notice</th><th>For</th><th>Shows</th><th>Read by</th><th>State</th><th /></tr></thead>
                <tbody>
                  {list.data.notices.map((n) => (
                    <tr key={n.id}>
                      <td>
                        <strong>{n.title}</strong> {n.pinned && <Pin size={12} aria-label="Pinned" />}
                        <div className="muted">{n.category}{n.priority === 'important' && ' - important'}</div>
                      </td>
                      <td>{AUDIENCE[n.audience]}{n.course && <div className="muted">{n.course}</div>}</td>
                      <td className="muted">{fmtDate(String(n.noticeDate).slice(0, 10))}{n.expiresOn && <> to {fmtDate(String(n.expiresOn).slice(0, 10))}</>}</td>
                      <td>{n.reads}</td>
                      <td><Badge tone={STATE_TONE[n.state]}>{n.state}</Badge></td>
                      <td className="row-actions">
                        <button type="button" className="btn btn--outline btn--sm" onClick={() => setEditing(n)} aria-label={`Edit ${n.title}`}><Pencil size={13} /></button>
                        <button type="button" className="btn btn--outline btn--sm" onClick={() => remove(n)} aria-label={`Delete ${n.title}`}><Trash2 size={13} /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </DataBoundary>
      </Card>
      {editing && (
        <Editor
          notice={editing} categories={list.data?.categories || ['General']} courses={courses.data?.courses || []}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); list.reload(); }}
        />
      )}
    </>
  );
}

import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, FileText, NotebookPen, Paperclip, Plus } from 'lucide-react';
import { api } from '../../api/http.js';
import { useFetch } from '../../hooks/useFetch.js';
import { Badge, Card, PageBanner } from '../../components/ui/Ui.jsx';
import { DataBoundary, EmptyState } from '../../components/ui/Feedback.jsx';
import Modal from '../../components/ui/Modal.jsx';
import { useDialogs } from '../../components/ui/Dialogs.jsx';
import { cr, fileHref, fmtDateTime, fromLocalInput, toLocalInput } from '../../utils/learning.js';
import { uploadFile } from '../../utils/upload.js';

const STATUS = { draft: { label: 'Draft', tone: 'amber' }, published: { label: 'Published', tone: 'green' }, closed: { label: 'Closed', tone: 'gray' } };
const SUB = { pending: { label: 'Not submitted', tone: 'gray' }, submitted: { label: 'To grade', tone: 'amber' }, graded: { label: 'Graded', tone: 'green' }, returned: { label: 'Sent back', tone: 'red' } };

/** Assignments for faculty and the office. `role` is 'admin' or 'employee'. */
export default function Assignments({ role }) {
  const { data, loading, error, reload } = useFetch(`/${role}/assignments`);
  const [editing, setEditing] = useState(null);
  return (
    <>
      <PageBanner icon={NotebookPen} title="Assignments" subtitle="Set work for a class, collect answers and files, and give marks and feedback."
        actions={<button type="button" className="btn btn--primary btn--sm" onClick={() => setEditing({})}><Plus size={14} /> New assignment</button>} />
      <Card>
        <DataBoundary loading={loading} error={error} data={data} reload={reload}>
          {data && (data.assignments.length === 0 ? <EmptyState title="No assignments yet" hint="Create one, then publish it so the class can see it." action={{ label: 'New assignment', onClick: () => setEditing({}) }} /> : (
            <div className="table-wrap"><table className="table">
              <thead><tr><th>Assignment</th><th>Class</th><th>Due</th><th className="num">Handed in</th><th className="num">To grade</th><th>Status</th><th /></tr></thead>
              <tbody>{data.assignments.map((a) => (
                <tr key={a.id}>
                  <td><strong>{a.title}</strong><br /><small className="muted">{a.subject} · {cr(a.maxMarks)} marks</small></td>
                  <td>{a.className}{a.section ? <><br /><small className="muted">Section {a.section}</small></> : null}</td>
                  <td>{fmtDateTime(a.dueAt)}</td>
                  <td className="num">{a.submitted} / {a.roster}</td>
                  <td className="num">{a.toGrade || '-'}</td>
                  <td><Badge tone={STATUS[a.status].tone}>{STATUS[a.status].label}</Badge></td>
                  <td style={{ whiteSpace: 'nowrap' }}><Link className="btn btn--primary btn--sm" to={`/${role}/assignments/${a.id}`}>Open</Link></td>
                </tr>
              ))}</tbody>
            </table></div>
          ))}
        </DataBoundary>
      </Card>
      {editing && <Editor role={role} item={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
    </>
  );
}

function Editor({ role, item, onClose, onSaved }) {
  const { toast } = useDialogs();
  const scope = useFetch(`/${role}/assignments/scope`);
  const [f, setF] = useState({
    courseId: item.courseId || '', subject: item.subject || '', section: item.section || '', title: item.title || '', description: item.description || '',
    dueAt: toLocalInput(item.dueAt), maxMarks: item.maxMarks ?? 10, allowLate: item.allowLate !== false,
  });
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value, ...(k === 'courseId' ? { subject: '' } : {}) }));
  const subjects = [...new Set((scope.data?.scope || []).filter((s) => s.courseId === f.courseId).map((s) => s.subject))];
  const save = async (publish) => {
    if (!f.courseId || !f.subject.trim() || !f.title.trim() || !f.dueAt) { toast.error('Choose a class, subject, title and due date.'); return; }
    setBusy(true);
    try {
      const attachmentFileId = file ? await uploadFile(file) : undefined;
      const body = { ...f, dueAt: fromLocalInput(f.dueAt), maxMarks: Number(f.maxMarks), ...(attachmentFileId ? { attachmentFileId } : {}), publish };
      if (item.id) { await api.put(`/${role}/assignments/${item.id}`, body); if (publish) await api.post(`/${role}/assignments/${item.id}/publish`); } else await api.post(`/${role}/assignments`, body);
      toast.success(publish ? 'Assignment published.' : 'Saved.');
      onSaved();
    } catch (err) { toast.error(err); } finally { setBusy(false); }
  };
  return (
    <Modal open title={item.id ? 'Edit assignment' : 'New assignment'} onClose={onClose} width={620}>
      <div className="fields">
        <div className="form-field"><label className="label" htmlFor="as-course">Class *</label>
          <select id="as-course" className="input" value={f.courseId} onChange={set('courseId')} disabled={!!item.id}><option value="">Choose...</option>{(scope.data?.classes || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        <div className="form-field"><label className="label" htmlFor="as-subject">Subject *</label>
          <input id="as-subject" className="input" list="as-subjects" value={f.subject} maxLength={100} onChange={set('subject')} disabled={!!item.id} /><datalist id="as-subjects">{subjects.map((s) => <option key={s} value={s} />)}</datalist></div>
        <div className="form-field form-field--full"><label className="label" htmlFor="as-title">Title *</label><input id="as-title" className="input" value={f.title} maxLength={150} onChange={set('title')} /></div>
        <div className="form-field form-field--full"><label className="label" htmlFor="as-desc">Instructions</label><textarea id="as-desc" className="input" rows={4} value={f.description} maxLength={5000} onChange={set('description')} /></div>
        <div className="form-field"><label className="label" htmlFor="as-due">Due *</label><input id="as-due" type="datetime-local" className="input" value={f.dueAt} onChange={set('dueAt')} /></div>
        <div className="form-field"><label className="label" htmlFor="as-marks">Maximum marks</label><input id="as-marks" type="number" min="1" max="1000" step="0.5" className="input" value={f.maxMarks} onChange={set('maxMarks')} /></div>
        <div className="form-field"><label className="label" htmlFor="as-sec">Section (optional)</label><input id="as-sec" className="input" value={f.section} maxLength={20} onChange={set('section')} placeholder="Whole class" /></div>
        <div className="form-field"><label className="label" htmlFor="as-file">Attachment (PDF, PNG, JPEG, up to 5 MB)</label><input id="as-file" type="file" accept="application/pdf,image/png,image/jpeg" onChange={(e) => setFile(e.target.files[0] || null)} />
          {item.attachmentFileId && !file && <small className="muted">A file is already attached. Choose another to replace it.</small>}</div>
        <div className="form-field form-field--full"><label><input type="checkbox" checked={f.allowLate} onChange={(e) => setF({ ...f, allowLate: e.target.checked })} /> Accept work after the due date (marked late)</label></div>
      </div>
      <div className="form-actions">
        <button type="button" className="btn btn--outline" onClick={onClose}>Cancel</button>
        <button type="button" className="btn btn--outline" disabled={busy} onClick={() => save(false)}>Save</button>
        {item.status !== 'published' && <button type="button" className="btn btn--primary" disabled={busy} onClick={() => save(true)}>Save and publish</button>}
      </div>
    </Modal>
  );
}

/** One assignment: roster of who handed in what, with grading. */
export function AssignmentDetail({ role }) {
  const { id } = useParams();
  const nav = useNavigate();
  const { confirm, toast } = useDialogs();
  const { data, loading, error, reload } = useFetch(`/${role}/assignments/${id}`);
  const [grading, setGrading] = useState(null);
  const [editing, setEditing] = useState(false);
  const act = async (verb) => {
    try { await api.post(`/${role}/assignments/${id}/${verb}`); reload(); } catch (err) { toast.error(err); }
  };
  const remove = async () => {
    if (!await confirm('Delete this assignment and everything handed in for it?', { title: 'Delete assignment', confirmLabel: 'Delete', danger: true })) return;
    try { await api.del(`/${role}/assignments/${id}`); nav(`/${role}/assignments`); } catch (err) { toast.error(err); }
  };
  return (
    <DataBoundary loading={loading} error={error} data={data} reload={reload}>
      {data && (() => {
        const a = data.assignment; const handed = data.students.filter((s) => s.status !== 'pending').length;
        return (
          <>
            <PageBanner icon={NotebookPen} title={a.title} subtitle={`${a.className} · ${a.subject} · due ${fmtDateTime(a.dueAt)} · ${cr(a.maxMarks)} marks`}
              actions={<Link to={`/${role}/assignments`} className="btn btn--outline btn--sm"><ArrowLeft size={14} /> Back</Link>} />
            <Card title="Details" action={<Badge tone={STATUS[a.status].tone}>{STATUS[a.status].label}</Badge>}>
              {a.description && <p style={{ whiteSpace: 'pre-wrap' }}>{a.description}</p>}
              {a.attachmentFileId && <p><a href={fileHref(a.attachmentFileId)} target="_blank" rel="noreferrer"><Paperclip size={14} /> Attached file</a></p>}
              <p className="muted">{handed} of {data.students.length} students have handed in. {a.allowLate ? 'Late work is accepted.' : 'Late work is not accepted.'}</p>
              <div className="form-actions" style={{ justifyContent: 'flex-start' }}>
                {a.status === 'draft' && <button type="button" className="btn btn--primary btn--sm" onClick={() => act('publish')}>Publish</button>}
                {a.status === 'published' && <button type="button" className="btn btn--outline btn--sm" onClick={() => act('close')}>Close</button>}
                {a.status === 'closed' && <button type="button" className="btn btn--outline btn--sm" onClick={() => act('reopen')}>Reopen</button>}
                <button type="button" className="btn btn--outline btn--sm" onClick={() => setEditing(true)}>Edit</button>
                <button type="button" className="btn btn--outline btn--sm" onClick={remove}>Delete</button>
              </div>
            </Card>
            <Card title="Students">
              <div className="table-wrap"><table className="table">
                <thead><tr><th>Roll no.</th><th>Student</th><th>Status</th><th className="num">Marks</th><th /></tr></thead>
                <tbody>{data.students.map((s) => (
                  <tr key={s.studentId}>
                    <td className="muted">{s.rollNo || '-'}</td>
                    <td><strong>{s.name}</strong> <span className="muted">({s.studentCode})</span>{s.late && <> <Badge tone="amber">Late</Badge></>}</td>
                    <td><Badge tone={SUB[s.status].tone}>{SUB[s.status].label}</Badge>{s.submittedAt && <><br /><small className="muted">{fmtDateTime(s.submittedAt)}</small></>}</td>
                    <td className="num">{s.marks != null ? `${cr(s.marks)} / ${cr(a.maxMarks)}` : '-'}</td>
                    <td>{s.status !== 'pending' && <button type="button" className="btn btn--primary btn--sm" onClick={() => setGrading(s)}>{s.status === 'graded' ? 'Review' : 'Grade'}</button>}</td>
                  </tr>
                ))}</tbody>
              </table></div>
            </Card>
            {grading && <Grade role={role} a={a} s={grading} onClose={() => setGrading(null)} onSaved={() => { setGrading(null); reload(); }} />}
            {editing && <Editor role={role} item={a} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); reload(); }} />}
          </>
        );
      })()}
    </DataBoundary>
  );
}

function Grade({ role, a, s, onClose, onSaved }) {
  const { toast } = useDialogs();
  const [marks, setMarks] = useState(s.marks ?? '');
  const [feedback, setFeedback] = useState(s.feedback || '');
  const [busy, setBusy] = useState(false);
  const send = async (action) => {
    setBusy(true);
    try { await api.put(`/${role}/assignments/${a.id}/submissions/${s.studentId}`, { action, marks, feedback }); toast.success(action === 'return' ? 'Sent back to the student.' : 'Marks saved.'); onSaved(); } catch (err) { toast.error(err); } finally { setBusy(false); }
  };
  return (
    <Modal open title={`${s.name}'s work`} onClose={onClose} width={560}>
      {s.answer ? <p style={{ whiteSpace: 'pre-wrap' }}>{s.answer}</p> : <p className="muted">No written answer.</p>}
      {s.fileId && <p><a href={fileHref(s.fileId)} target="_blank" rel="noreferrer"><FileText size={14} /> Open the file they attached</a></p>}
      <div className="fields">
        <div className="form-field"><label className="label" htmlFor="g-marks">Marks (out of {cr(a.maxMarks)})</label><input id="g-marks" type="number" min="0" max={a.maxMarks} step="0.5" className="input" value={marks} onChange={(e) => setMarks(e.target.value)} /></div>
        <div className="form-field form-field--full"><label className="label" htmlFor="g-fb">Feedback</label><textarea id="g-fb" className="input" rows={3} maxLength={2000} value={feedback} onChange={(e) => setFeedback(e.target.value)} /></div>
      </div>
      <div className="form-actions">
        <button type="button" className="btn btn--outline" disabled={busy} onClick={() => send('return')}>Send back to redo</button>
        <button type="button" className="btn btn--primary" disabled={busy} onClick={() => send('grade')}>Save marks</button>
      </div>
    </Modal>
  );
}

import { useState } from 'react';
import { BarChart3, Pencil, Plus, Star, Trash2 } from 'lucide-react';
import { useFetch } from '../../hooks/useFetch.js';
import { api } from '../../api/http.js';
import { Badge, Card, PageBanner } from '../../components/ui/Ui.jsx';
import { DataBoundary, EmptyState } from '../../components/ui/Feedback.jsx';
import Modal from '../../components/ui/Modal.jsx';
import { useDialogs } from '../../components/ui/Dialogs.jsx';
import { fmtDate } from '../../utils/dates.js';

const TONE = { draft: 'gray', open: 'green', closed: 'amber' };
const WORD = { draft: 'Draft', open: 'Open', closed: 'Closed' };

function Editor({ id, courses, employees, onClose, onSaved }) {
  const existing = useFetch(id ? `/admin/feedback/${id}` : null);
  if (id && !existing.data) return <Modal open title="Feedback form" onClose={onClose}><DataBoundary loading={existing.loading} error={existing.error} data={existing.data} reload={existing.reload}>{null}</DataBoundary></Modal>;
  return <EditorForm base={existing.data} courses={courses} employees={employees} onClose={onClose} onSaved={onSaved} />;
}

function EditorForm({ base, courses, employees, onClose, onSaved }) {
  const { toast } = useDialogs();
  const form = base?.form;
  const locked = (form?.responses || 0) > 0;
  const [f, setF] = useState({
    title: form?.title || '', description: form?.description || '', audience: form?.audience || 'students', courseId: form?.courseId || '',
    aboutEmployeeId: form?.aboutEmployeeId || '', closesOn: form?.closesOn || '', status: form?.status || 'draft',
  });
  const [qs, setQs] = useState(base?.questions?.map((x) => ({ text: x.text, kind: x.kind, required: x.required })) || [{ text: '', kind: 'rating', required: true }]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const setQ = (i, patch) => setQs((a) => a.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  const save = async (e) => {
    e.preventDefault(); setErr(''); setBusy(true);
    const body = { ...f, courseId: f.audience === 'students' ? f.courseId || null : null, aboutEmployeeId: f.aboutEmployeeId || null, closesOn: f.closesOn || null, ...(locked ? {} : { questions: qs }) };
    try {
      if (form) await api.put(`/admin/feedback/${form.id}`, body); else await api.post('/admin/feedback', body);
      toast.success('Feedback form saved.'); onSaved();
    } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };

  return (
    <Modal open title={form ? 'Edit feedback form' : 'New feedback form'} onClose={onClose} width={720}>
      <form onSubmit={save}>
        {err && <p className="form-error">{err}</p>}
        <div className="fields">
          <label className="form-field form-field--full"><span className="label">Title *</span><input className="input" maxLength={150} value={f.title} onChange={set('title')} required /></label>
          <label className="form-field form-field--full"><span className="label">Short note for the people answering</span><input className="input" maxLength={1000} value={f.description} onChange={set('description')} /></label>
          <label className="form-field"><span className="label">Who answers</span>
            <select className="input" value={f.audience} onChange={set('audience')}><option value="students">Students</option><option value="employees">Staff</option></select></label>
          {f.audience === 'students' && (
            <label className="form-field"><span className="label">Only one course (optional)</span>
              <select className="input" value={f.courseId} onChange={set('courseId')}><option value="">All courses</option>{courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          )}
          <label className="form-field"><span className="label">About one faculty member (optional)</span>
            <select className="input" value={f.aboutEmployeeId} onChange={set('aboutEmployeeId')}><option value="">Nobody in particular</option>{employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
          <label className="form-field"><span className="label">Last date (optional)</span><input className="input" type="date" value={f.closesOn} onChange={set('closesOn')} /></label>
          <label className="form-field"><span className="label">Status</span>
            <select className="input" value={f.status} onChange={set('status')}><option value="draft">Draft (not shown yet)</option><option value="open">Open</option><option value="closed">Closed</option></select></label>
        </div>
        <h4 style={{ margin: '16px 0 8px' }}>Questions</h4>
        {locked && <p className="muted">People have already answered, so the questions can no longer change.</p>}
        <div style={{ display: 'grid', gap: 8 }}>
          {qs.map((x, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span className="muted" style={{ width: 20 }}>{i + 1}.</span>
              <input className="input" style={{ flex: 1, minWidth: 200 }} maxLength={300} placeholder="Question" value={x.text} disabled={locked} onChange={(e) => setQ(i, { text: e.target.value })} />
              <select className="input" style={{ width: 130 }} value={x.kind} disabled={locked} onChange={(e) => setQ(i, { kind: e.target.value })}><option value="rating">Rating 1-5</option><option value="text">Comment</option></select>
              <label style={{ whiteSpace: 'nowrap' }}><input type="checkbox" checked={x.required} disabled={locked} onChange={(e) => setQ(i, { required: e.target.checked })} /> Required</label>
              {!locked && qs.length > 1 && <button type="button" className="icon-btn" aria-label={`Remove question ${i + 1}`} onClick={() => setQs((a) => a.filter((_, j) => j !== i))}><Trash2 size={15} /></button>}
            </div>
          ))}
        </div>
        {!locked && <button type="button" className="btn btn--outline btn--sm" style={{ marginTop: 10 }} onClick={() => setQs((a) => [...a, { text: '', kind: 'rating', required: true }])}><Plus size={13} /> Add question</button>}
        <p className="muted">Answers are anonymous: the office sees combined results and comments, never who wrote them.</p>
        <div className="form-actions"><button type="button" className="btn btn--outline" onClick={onClose}>Cancel</button><button className="btn btn--primary" disabled={busy}>{busy ? 'Saving...' : 'Save'}</button></div>
      </form>
    </Modal>
  );
}

function Results({ id, onClose }) {
  const r = useFetch(`/admin/feedback/${id}/results`);
  return (
    <Modal open title={r.data ? `Results: ${r.data.form.title}` : 'Results'} onClose={onClose} width={720}>
      <DataBoundary loading={r.loading} error={r.error} data={r.data} reload={r.reload}>
        {r.data && (
          <>
            <p style={{ marginTop: 0 }}><strong>{r.data.form.responses}</strong> answered{r.data.eligible ? <> out of <strong>{r.data.eligible}</strong> ({Math.round((r.data.form.responses / r.data.eligible) * 100)}%)</> : ''}.</p>
            {r.data.form.responses === 0 ? <EmptyState title="No answers yet" hint="Results appear as people answer." /> : (
              <div style={{ display: 'grid', gap: 16 }}>
                {r.data.questions.map((x) => (
                  <div key={x.id}>
                    <strong>{x.text}</strong>
                    {x.kind === 'rating' ? (
                      <div style={{ marginTop: 6 }}>
                        <div>{x.average === null ? 'No ratings' : <><span style={{ fontSize: 22, fontWeight: 700 }}>{x.average}</span> <span className="muted">out of 5 from {x.answered}</span></>}</div>
                        {x.answered > 0 && (
                          <div style={{ display: 'grid', gap: 3, marginTop: 6 }}>
                            {[5, 4, 3, 2, 1].map((n) => (
                              <div key={n} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                                <span style={{ width: 14 }}>{n}</span>
                                <div style={{ flex: 1, background: '#eef0f6', borderRadius: 4, height: 10 }}><div style={{ width: `${(x.distribution[n - 1] / x.answered) * 100}%`, background: 'var(--brand-500, #4f46e5)', height: 10, borderRadius: 4 }} /></div>
                                <span style={{ width: 24, textAlign: 'right' }}>{x.distribution[n - 1]}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : (
                      <ul className="todo" style={{ marginTop: 6 }}>{x.comments.length === 0 ? <li className="muted">No comments</li> : x.comments.map((c, i) => <li key={i}>{c.text}</li>)}</ul>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </DataBoundary>
    </Modal>
  );
}

export default function Feedback() {
  const { confirm, toast } = useDialogs();
  const list = useFetch('/admin/feedback');
  const courses = useFetch('/admin/courses');
  const employees = useFetch('/admin/employees');
  const [editing, setEditing] = useState(null); // {} new, {id}
  const [viewing, setViewing] = useState(null);

  const setStatus = async (f, status) => {
    try { await api.put(`/admin/feedback/${f.id}/status`, { status }); list.reload(); } catch (err) { toast.error(err); }
  };
  const remove = async (f) => {
    if (!(await confirm(`Delete "${f.title}" and all its answers?`, { danger: true, confirmLabel: 'Delete' }))) return;
    try { await api.del(`/admin/feedback/${f.id}`); list.reload(); } catch (err) { toast.error(err); }
  };

  return (
    <>
      <PageBanner
        icon={Star} title="Feedback" subtitle="Anonymous feedback from students and staff"
        actions={<button type="button" className="btn btn--primary" onClick={() => setEditing({})}><Plus size={15} /> New form</button>}
      />
      <Card>
        <DataBoundary loading={list.loading} error={list.error} data={list.data} reload={list.reload}>
          {list.data && (list.data.forms.length === 0 ? <EmptyState title="No feedback forms yet" hint="Create a form, open it, and read the combined results here." /> : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Form</th><th>For</th><th>Questions</th><th>Answers</th><th>Last date</th><th>Status</th><th /></tr></thead>
                <tbody>
                  {list.data.forms.map((f) => (
                    <tr key={f.id}>
                      <td><strong>{f.title}</strong>{f.aboutName && <div className="muted">About {f.aboutName}</div>}</td>
                      <td>{f.audience === 'students' ? 'Students' : 'Staff'}{f.course && <div className="muted">{f.course}</div>}</td>
                      <td>{f.questionCount}</td><td>{f.responses}</td>
                      <td className="muted">{f.closesOn ? fmtDate(f.closesOn) : '-'}</td>
                      <td><Badge tone={TONE[f.status]}>{WORD[f.status]}</Badge></td>
                      <td className="row-actions">
                        <button type="button" className="btn btn--outline btn--sm" onClick={() => setViewing(f.id)}><BarChart3 size={13} /> Results</button>
                        {f.status !== 'open' && <button type="button" className="btn btn--primary btn--sm" onClick={() => setStatus(f, 'open')}>Open</button>}
                        {f.status === 'open' && <button type="button" className="btn btn--outline btn--sm" onClick={() => setStatus(f, 'closed')}>Close</button>}
                        <button type="button" className="btn btn--outline btn--sm" onClick={() => setEditing({ id: f.id })} aria-label={`Edit ${f.title}`}><Pencil size={13} /></button>
                        <button type="button" className="btn btn--outline btn--sm" onClick={() => remove(f)} aria-label={`Delete ${f.title}`}><Trash2 size={13} /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </DataBoundary>
      </Card>
      {editing && <Editor id={editing.id} courses={courses.data?.courses || []} employees={employees.data?.employees || []} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); list.reload(); }} />}
      {viewing && <Results id={viewing} onClose={() => setViewing(null)} />}
    </>
  );
}

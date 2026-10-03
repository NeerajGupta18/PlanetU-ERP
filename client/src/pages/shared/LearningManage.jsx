import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { BookOpenCheck, ExternalLink, Plus, Trash2, ArrowUp, ArrowDown } from 'lucide-react';
import { useFetch } from '../../hooks/useFetch.js';
import { api } from '../../api/http.js';
import { Badge, Card, PageBanner, Tabs } from '../../components/ui/Ui.jsx';
import { DataBoundary, EmptyState } from '../../components/ui/Feedback.jsx';
import Modal from '../../components/ui/Modal.jsx';
import { fmtDate, toISO, addDays } from '../../utils/dates.js';
import { PROVIDER_TONE, STANDING, cr, fileHref } from '../../utils/learning.js';

/** Learning platform for admins and faculty. `role` is 'admin' or 'employee'; the server decides what each may do. */
export default function LearningManage({ role }) {
  const [tab, setTab] = useState('assignments');
  const queue = useFetch(`/${role}/learning/review`);
  const pending = queue.data?.queue.length || 0;
  return (
    <>
      <PageBanner icon={BookOpenCheck} title="Learning platform" subtitle="Assign online courses to your classes for compulsory credits, and verify certificates" />
      <Card>
        <Tabs
          tabs={[{ id: 'assignments', label: 'Assignments' }, { id: 'review', label: `To review${pending ? ` (${pending})` : ''}` }, { id: 'courses', label: 'Course catalogue' }, { id: 'credits', label: 'Credits' }]}
          active={tab} onChange={setTab}
        />
        {tab === 'assignments' && <Assignments role={role} />}
        {tab === 'review' && <Review role={role} queue={queue} />}
        {tab === 'courses' && <Courses role={role} />}
        {tab === 'credits' && <Credits role={role} />}
      </Card>
    </>
  );
}

/* ---------------------------------------------------------------- assignments */
function Assignments({ role }) {
  const { data, loading, error, reload } = useFetch(`/${role}/learning/assignments`);
  const [open, setOpen] = useState(false);
  return (
    <DataBoundary loading={loading} error={error} data={data} reload={reload}>
      <div className="form-actions" style={{ justifyContent: 'flex-end', margin: '0 0 10px' }}><button type="button" className="btn btn--primary btn--sm" onClick={() => setOpen(true)}><Plus size={14} /> Assign a course</button></div>
      {data && (data.assignments.length === 0 ? <EmptyState title="Nothing assigned yet" hint="Choose a course from the catalogue, a class and a subject, and set the credits and the due date." /> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Course</th><th>Class</th><th>Subject</th><th className="num">Credits</th><th>Due</th><th>Progress</th><th /></tr></thead>
          <tbody>{data.assignments.map((a) => (
            <tr key={a.id}>
              <td><strong>{a.courseTitle}</strong><br /><Badge tone={PROVIDER_TONE[a.provider]}>{a.provider}</Badge> <Badge tone={a.mandatory ? 'purple' : 'gray'}>{a.mandatory ? 'Compulsory' : 'Optional'}</Badge></td>
              <td>{a.className}<br /><small className="muted">Sem {a.semester}{a.section ? ` · Sec ${a.section}` : ''}</small></td>
              <td>{a.subject}</td><td className="num">{cr(a.credits)}</td>
              <td>{a.dueDate ? fmtDate(a.dueDate) : '-'}{a.overdue > 0 && <><br /><Badge tone="red">{a.overdue} overdue</Badge></>}</td>
              <td>{a.completed} / {a.total} done{a.submitted > 0 && <><br /><Badge tone="amber">{a.submitted} to review</Badge></>}</td>
              <td><Link className="btn btn--outline btn--sm" to={`/${role}/learning/assignments/${a.id}`}>Open</Link></td>
            </tr>
          ))}</tbody>
        </table></div>
      ))}
      <AssignModal role={role} open={open} onClose={() => setOpen(false)} onDone={() => { setOpen(false); reload(); }} />
    </DataBoundary>
  );
}

function AssignModal({ role, open, onClose, onDone }) {
  const scope = useFetch(open ? `/${role}/learning/subjects` : null);
  const courses = useFetch(open ? `/${role}/learning/courses?status=published` : null);
  const [f, setF] = useState({ learningCourseId: '', courseId: '', semester: '1', section: '', subject: '', credits: '', mandatory: true, dueDate: toISO(addDays(new Date(), 30)), note: '' });
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((c) => ({ ...c, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const chosen = courses.data?.courses.find((c) => c.id === f.learningCourseId);
  const subjects = useMemo(() => [...new Set((scope.data?.scope || []).filter((s) => !f.courseId || s.courseId === f.courseId).map((s) => s.subject))], [scope.data, f.courseId]);

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    try {
      await api.post(`/${role}/learning/assignments`, { ...f, semester: Number(f.semester), credits: f.credits === '' ? undefined : Number(f.credits), dueDate: f.dueDate || undefined });
      onDone();
    } catch (ex) { setErr(ex.message); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} title="Assign a course" onClose={onClose} width={620}>
      <form onSubmit={submit}>
        {err && <p className="form-error" role="alert">{err}</p>}
        <div className="fields">
          <div className="form-field form-field--full"><label className="label" htmlFor="as-course">Course</label>
            <select id="as-course" className="input" required value={f.learningCourseId} onChange={set('learningCourseId')}>
              <option value="">Choose from the catalogue...</option>
              {(courses.data?.courses || []).map((c) => <option key={c.id} value={c.id}>{c.title} ({c.provider}, {cr(c.credits)} credits)</option>)}
            </select>
          </div>
          <div className="form-field"><label className="label" htmlFor="as-class">Class</label>
            <select id="as-class" className="input" required value={f.courseId} onChange={set('courseId')}><option value="">Choose...</option>{(scope.data?.classes || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
          <div className="form-field"><label className="label" htmlFor="as-sem">Semester</label><input id="as-sem" className="input" type="number" min="1" max="20" required value={f.semester} onChange={set('semester')} /></div>
          <div className="form-field"><label className="label" htmlFor="as-sub">Subject</label><input id="as-sub" className="input" list="as-subjects" required value={f.subject} onChange={set('subject')} placeholder={chosen?.subject || 'The subject the credits count towards'} /><datalist id="as-subjects">{subjects.map((s) => <option key={s} value={s} />)}</datalist></div>
          <div className="form-field"><label className="label" htmlFor="as-sec">Section (blank = all)</label><input id="as-sec" className="input" value={f.section} onChange={set('section')} maxLength={20} /></div>
          <div className="form-field"><label className="label" htmlFor="as-cr">Credits</label><input id="as-cr" className="input" type="number" min="0" max="20" step="0.5" value={f.credits} onChange={set('credits')} placeholder={chosen ? String(chosen.credits) : ''} /></div>
          <div className="form-field"><label className="label" htmlFor="as-due">Due date</label><input id="as-due" className="input" type="date" value={f.dueDate} onChange={set('dueDate')} min={toISO(new Date())} /></div>
          <div className="form-field form-field--full"><label className="label" htmlFor="as-note">Note to students (optional)</label><input id="as-note" className="input" value={f.note} onChange={set('note')} maxLength={300} /></div>
          <label className="check-row form-field--full"><input type="checkbox" checked={f.mandatory} onChange={set('mandatory')} /> Compulsory: its credits count towards what every student must earn</label>
        </div>
        {role === 'employee' && <p className="note">You can assign only for subjects you teach in that class.</p>}
        <div className="form-actions"><button type="button" className="btn btn--outline" onClick={onClose}>Cancel</button><button className="btn btn--primary" disabled={busy}>{busy ? 'Assigning...' : 'Assign to students'}</button></div>
      </form>
    </Modal>
  );
}

/* ---------------------------------------------------------------- review queue */
function Review({ role, queue }) {
  const [reject, setReject] = useState(null);
  const [note, setNote] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState('');
  const act = async (item, decision) => {
    setBusy(item.id); setErr('');
    try { await api.post(`/${role}/learning/enrollments/${item.id}/review`, { decision, note: decision === 'reject' ? note : undefined }); setReject(null); setNote(''); queue.reload(); } catch (e) { setErr(e.message); } finally { setBusy(''); }
  };
  return (
    <DataBoundary loading={queue.loading} error={queue.error} data={queue.data} reload={queue.reload}>
      {err && <p className="form-error" role="alert">{err}</p>}
      {queue.data && (queue.data.queue.length === 0 ? <EmptyState title="Nothing to review" hint="Certificates students submit appear here for you to approve or send back." /> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Student</th><th>Course</th><th>Evidence</th><th className="num">Credits</th><th /></tr></thead>
          <tbody>{queue.data.queue.map((x) => (
            <tr key={x.id}>
              <td><strong>{x.student}</strong><br /><small className="muted">{x.code}</small></td>
              <td>{x.courseTitle}<br /><small className="muted">{x.className} · {x.subject}</small></td>
              <td>
                {x.evidenceUrl && <a href={x.evidenceUrl} target="_blank" rel="noreferrer noopener"><ExternalLink size={12} /> verification link</a>}
                {x.evidenceFileId && <><br /><a href={fileHref(x.evidenceFileId)} target="_blank" rel="noreferrer">uploaded certificate</a></>}
                {x.certificateId && <><br /><small>ID: {x.certificateId}</small></>}{x.score !== null && <><br /><small>Score: {x.score}%</small></>}
                {x.evidenceNote && <><br /><small className="muted">&ldquo;{x.evidenceNote}&rdquo;</small></>}
              </td>
              <td className="num">{cr(x.credits)}</td>
              <td style={{ whiteSpace: 'nowrap' }}>
                <button type="button" className="btn btn--primary btn--sm" disabled={busy === x.id} onClick={() => act(x, 'approve')}>Approve</button>{' '}
                <button type="button" className="btn btn--outline btn--sm" onClick={() => { setReject(x); setNote(''); }}>Send back</button>
              </td>
            </tr>
          ))}</tbody>
        </table></div>
      ))}
      <Modal open={Boolean(reject)} title={`Send back ${reject?.student || ''}'s submission`} onClose={() => setReject(null)}>
        <label className="label" htmlFor="rj-note">Tell the student what to fix</label>
        <textarea id="rj-note" className="input" rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
        <div className="form-actions"><button type="button" className="btn btn--outline" onClick={() => setReject(null)}>Cancel</button><button type="button" className="btn btn--primary" disabled={!note.trim() || busy === reject?.id} onClick={() => act(reject, 'reject')}>Send back</button></div>
      </Modal>
    </DataBoundary>
  );
}

/* ---------------------------------------------------------------- course catalogue */
function Courses({ role }) {
  const { data, loading, error, reload } = useFetch(`/${role}/learning/courses`);
  const [edit, setEdit] = useState(null);
  return (
    <DataBoundary loading={loading} error={error} data={data} reload={reload}>
      <div className="form-actions" style={{ justifyContent: 'flex-end', margin: '0 0 10px' }}><button type="button" className="btn btn--primary btn--sm" onClick={() => setEdit({})}><Plus size={14} /> New course</button></div>
      {data && (data.courses.length === 0 ? <EmptyState title="The catalogue is empty" hint="Add an online course (NPTEL, SWAYAM, Coursera...) or build a short in-house course with lessons." /> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Course</th><th>Subject</th><th className="num">Credits</th><th>Completed by</th><th>Status</th><th /></tr></thead>
          <tbody>{data.courses.map((c) => (
            <tr key={c.id}>
              <td><strong>{c.title}</strong><br /><Badge tone={PROVIDER_TONE[c.provider]}>{c.provider}</Badge> {c.url && <a href={c.url} target="_blank" rel="noreferrer noopener" aria-label={`Open ${c.title}`}><ExternalLink size={12} /></a>}</td>
              <td>{c.subject || '-'}</td><td className="num">{cr(c.credits)}</td>
              <td>{c.completion === 'lessons' ? `${c.lessons} lessons` : 'Certificate'}<br /><small className="muted">{c.assignments} assignment{c.assignments === 1 ? '' : 's'}</small></td>
              <td><Badge tone={c.status === 'published' ? 'green' : c.status === 'draft' ? 'amber' : 'gray'}>{c.status}</Badge></td>
              <td>{c.canEdit && <button type="button" className="btn btn--outline btn--sm" onClick={async () => setEdit((await api.get(`/${role}/learning/courses/${c.id}`)).course)}>Edit</button>}</td>
            </tr>
          ))}</tbody>
        </table></div>
      ))}
      {edit && <CourseModal role={role} course={edit} onClose={() => setEdit(null)} onDone={() => { setEdit(null); reload(); }} />}
    </DataBoundary>
  );
}

const blankLesson = () => ({ title: '', kind: 'reading', url: '', body: '', durationMin: 0 });

function CourseModal({ role, course, onClose, onDone }) {
  const isNew = !course.id;
  const [f, setF] = useState({ title: '', description: '', provider: 'NPTEL', url: '', subject: '', credits: 1, durationHours: 0, level: 'beginner', completion: 'evidence', status: 'draft', ...course });
  const [lessons, setLessons] = useState(course.lessons || []);
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((c) => ({ ...c, [k]: e.target.value }));
  const setLesson = (i, k, v) => setLessons((l) => l.map((x, n) => (n === i ? { ...x, [k]: v } : x)));
  const move = (i, d) => setLessons((l) => { const a = [...l]; const j = i + d; if (j < 0 || j >= a.length) return a; [a[i], a[j]] = [a[j], a[i]]; return a; });
  const provider = (e) => setF((c) => ({ ...c, provider: e.target.value, completion: e.target.value === 'Internal' ? 'lessons' : 'evidence' }));

  const submit = async (e, status) => {
    e.preventDefault(); setBusy(true); setErr('');
    try {
      const body = { title: f.title, description: f.description, provider: f.provider, url: f.url, subject: f.subject, credits: Number(f.credits), durationHours: Number(f.durationHours), level: f.level, completion: f.completion, status: status || f.status };
      if (f.completion === 'lessons') body.lessons = lessons.map((l) => ({ ...l, durationMin: Number(l.durationMin) || 0 }));
      if (isNew) await api.post(`/${role}/learning/courses`, body); else await api.put(`/${role}/learning/courses/${course.id}`, body);
      onDone();
    } catch (ex) { setErr(ex.message); } finally { setBusy(false); }
  };

  return (
    <Modal open title={isNew ? 'New course' : 'Edit course'} onClose={onClose} width={720}>
      <form onSubmit={(e) => submit(e)}>
        {err && <p className="form-error" role="alert">{err}</p>}
        <div className="fields">
          <div className="form-field form-field--full"><label className="label" htmlFor="c-title">Title</label><input id="c-title" className="input" required value={f.title} onChange={set('title')} maxLength={150} /></div>
          <div className="form-field"><label className="label" htmlFor="c-prov">Provider</label>
            <select id="c-prov" className="input" value={f.provider} onChange={provider}>{['NPTEL', 'SWAYAM', 'Coursera', 'edX', 'Udemy', 'Internal', 'Other'].map((p) => <option key={p}>{p}</option>)}</select></div>
          <div className="form-field"><label className="label" htmlFor="c-comp">Students complete it by</label>
            <select id="c-comp" className="input" value={f.completion} onChange={set('completion')} disabled={!isNew && course.assignments > 0}><option value="evidence">Submitting a certificate</option><option value="lessons">Finishing its lessons here</option></select></div>
          {f.completion === 'evidence' && <div className="form-field form-field--full"><label className="label" htmlFor="c-url">Course link (where students take it)</label><input id="c-url" className="input" type="url" placeholder="https://" value={f.url} onChange={set('url')} /></div>}
          <div className="form-field"><label className="label" htmlFor="c-sub">Subject (optional)</label><input id="c-sub" className="input" value={f.subject} onChange={set('subject')} maxLength={80} /></div>
          <div className="form-field"><label className="label" htmlFor="c-cr">Credits</label><input id="c-cr" className="input" type="number" min="0" max="20" step="0.5" value={f.credits} onChange={set('credits')} /></div>
          <div className="form-field"><label className="label" htmlFor="c-hrs">Duration (hours)</label><input id="c-hrs" className="input" type="number" min="0" step="0.5" value={f.durationHours} onChange={set('durationHours')} /></div>
          <div className="form-field"><label className="label" htmlFor="c-lvl">Level</label><select id="c-lvl" className="input" value={f.level} onChange={set('level')}><option value="beginner">Beginner</option><option value="intermediate">Intermediate</option><option value="advanced">Advanced</option></select></div>
          <div className="form-field form-field--full"><label className="label" htmlFor="c-desc">Description</label><textarea id="c-desc" className="input" rows={3} value={f.description} onChange={set('description')} maxLength={2000} /></div>
        </div>
        {f.completion === 'lessons' && (
          <fieldset style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 12, marginTop: 8 }}>
            <legend style={{ padding: '0 6px', fontWeight: 600 }}>Lessons</legend>
            {lessons.map((l, i) => (
              <div key={l.id || i} style={{ display: 'grid', gap: 6, padding: '8px 0', borderTop: i ? '1px solid var(--border)' : 'none' }}>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input className="input" aria-label={`Lesson ${i + 1} title`} placeholder={`Lesson ${i + 1} title`} value={l.title} onChange={(e) => setLesson(i, 'title', e.target.value)} />
                  <select className="input" aria-label="Lesson type" style={{ maxWidth: 120 }} value={l.kind} onChange={(e) => setLesson(i, 'kind', e.target.value)}><option value="reading">Reading</option><option value="video">Video</option><option value="link">Link</option></select>
                  <input className="input" aria-label="Minutes" type="number" min="0" style={{ maxWidth: 80 }} value={l.durationMin} onChange={(e) => setLesson(i, 'durationMin', e.target.value)} title="Minutes" />
                  <button type="button" className="icon-btn" aria-label="Move up" onClick={() => move(i, -1)}><ArrowUp size={15} /></button>
                  <button type="button" className="icon-btn" aria-label="Move down" onClick={() => move(i, 1)}><ArrowDown size={15} /></button>
                  <button type="button" className="icon-btn" aria-label="Remove lesson" onClick={() => setLessons((x) => x.filter((_, n) => n !== i))}><Trash2 size={15} /></button>
                </div>
                {l.kind === 'reading' ? <textarea className="input" rows={2} aria-label="Lesson text" placeholder="Lesson text" value={l.body} onChange={(e) => setLesson(i, 'body', e.target.value)} /> : <input className="input" type="url" aria-label="Lesson link" placeholder="https://" value={l.url} onChange={(e) => setLesson(i, 'url', e.target.value)} />}
              </div>
            ))}
            <button type="button" className="btn btn--outline btn--sm" onClick={() => setLessons((l) => [...l, blankLesson()])}><Plus size={13} /> Add a lesson</button>
          </fieldset>
        )}
        <div className="form-actions">
          <button type="button" className="btn btn--outline" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn--outline" disabled={busy} onClick={(e) => submit(e, 'draft')}>Save as draft</button>
          <button type="button" className="btn btn--primary" disabled={busy} onClick={(e) => submit(e, 'published')}>{busy ? 'Saving...' : 'Save and publish'}</button>
        </div>
      </form>
    </Modal>
  );
}

/* ---------------------------------------------------------------- credits compliance */
function Credits({ role }) {
  const scope = useFetch(`/${role}/learning/subjects`);
  const [courseId, setCourseId] = useState(''); const [semester, setSemester] = useState('');
  const qs = new URLSearchParams({ ...(courseId && { courseId }), ...(semester && { semester }) }).toString();
  const { data, loading, error, reload } = useFetch(`/${role}/learning/compliance${qs ? `?${qs}` : ''}`);
  return (
    <>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '0 0 10px' }}>
        <select className="input" style={{ maxWidth: 220 }} aria-label="Class" value={courseId} onChange={(e) => setCourseId(e.target.value)}><option value="">All classes</option>{(scope.data?.classes || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <input className="input" style={{ maxWidth: 130 }} aria-label="Semester" type="number" min="1" max="20" placeholder="Semester" value={semester} onChange={(e) => setSemester(e.target.value)} />
        {role === 'admin' && <Link className="btn btn--outline btn--sm" to={`/admin/reports?report=learning-credits${courseId ? `&courseId=${courseId}` : ''}${semester ? `&semester=${semester}` : ''}`}>Export</Link>}
      </div>
      <DataBoundary loading={loading} error={error} data={data} reload={reload}>
        {data && (data.students.length === 0 ? <EmptyState title="No students to show" hint="Students appear once a course is assigned to their class." /> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Student</th><th>Class</th><th className="num">Required</th><th className="num">Earned</th><th className="num">Pending</th><th className="num">Overdue</th><th>Standing</th></tr></thead>
            <tbody>{data.students.map((s) => (
              <tr key={s.studentId}><td><strong>{s.name}</strong><br /><small className="muted">{s.code}</small></td><td>{s.class} · Sem {s.semester}</td>
                <td className="num">{cr(s.required)}</td><td className="num">{cr(s.earned)}</td><td className="num">{cr(s.pending)}</td><td className="num">{s.overdue || '-'}</td>
                <td><Badge tone={STANDING[s.standing].tone}>{STANDING[s.standing].label}</Badge>{s.pendingReview > 0 && <> <Badge tone="amber">{s.pendingReview} to review</Badge></>}</td></tr>
            ))}</tbody>
          </table></div>
        ))}
      </DataBoundary>
    </>
  );
}

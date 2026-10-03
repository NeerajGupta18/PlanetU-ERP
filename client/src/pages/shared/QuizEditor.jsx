import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowDown, ArrowLeft, ArrowUp, ClipboardCheck, Plus, Trash2 } from 'lucide-react';
import { api } from '../../api/http.js';
import { useFetch } from '../../hooks/useFetch.js';
import { Card, PageBanner } from '../../components/ui/Ui.jsx';
import { DataBoundary } from '../../components/ui/Feedback.jsx';
import { KIND_LABEL, SHOW_LABEL, fromLocalInput, toLocalInput } from '../../utils/learning.js';

const newQuestion = (kind = 'single') => ({
  kind, text: '', marks: 1, explanation: '', answers: '',
  options: kind === 'truefalse' ? [{ text: 'True', correct: true }, { text: 'False', correct: false }] : [{ text: '', correct: kind === 'single' }, { text: '', correct: false }, { text: '', correct: false }, { text: '', correct: false }],
});

export default function QuizEditor({ role }) {
  const { id } = useParams();
  const isNew = !id;
  const nav = useNavigate();
  const scope = useFetch(`/${role}/quizzes/scope`);
  const loaded = useFetch(isNew ? null : `/${role}/quizzes/${id}`);
  const [f, setF] = useState({ title: '', subject: '', courseId: '', semester: '1', section: '', instructions: '', durationMinutes: 30, openAt: '', closeAt: '', maxAttempts: 1, scoring: 'best', weightage: 10, negativeMarks: 0, shuffle: true, showResults: 'after_submit' });
  const [qs, setQs] = useState([newQuestion()]);
  const [quiz, setQuiz] = useState(null);
  const [err, setErr] = useState(''); const [msg, setMsg] = useState(''); const [busy, setBusy] = useState(false);

  useEffect(() => {
    const z = loaded.data?.quiz;
    if (!z) return;
    setQuiz(z);
    setF({ title: z.title, subject: z.subject, courseId: z.courseId, semester: String(z.semester), section: z.section, instructions: z.instructions, durationMinutes: z.durationMinutes, openAt: toLocalInput(z.openAt), closeAt: toLocalInput(z.closeAt), maxAttempts: z.maxAttempts, scoring: z.scoring, weightage: z.weightage, negativeMarks: z.negativeMarks, shuffle: z.shuffle, showResults: z.showResults });
    setQs(z.questions.map((x) => ({ id: x.id, kind: x.kind, text: x.text, marks: x.marks, explanation: x.explanation, answers: (x.answers || []).join('\n'), options: x.options.length ? x.options : newQuestion(x.kind).options })));
  }, [loaded.data]);

  const locked = Boolean(quiz && quiz.attempts > 0);
  const set = (k) => (e) => setF((c) => ({ ...c, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const setQ = (i, patch) => setQs((a) => a.map((x, n) => (n === i ? { ...x, ...patch } : x)));
  const setOpt = (i, j, patch) => setQs((a) => a.map((x, n) => (n === i ? { ...x, options: x.options.map((o, m) => (m === j ? { ...o, ...patch } : o)) } : x)));
  const markCorrect = (i, j) => setQs((a) => a.map((x, n) => (n === i ? { ...x, options: x.options.map((o, m) => ({ ...o, correct: x.kind === 'multiple' ? (m === j ? !o.correct : o.correct) : m === j })) } : x)));
  const move = (i, d) => setQs((a) => { const b = [...a]; const j = i + d; if (j < 0 || j >= b.length) return b; [b[i], b[j]] = [b[j], b[i]]; return b; });
  const changeKind = (i, kind) => setQs((a) => a.map((x, n) => (n === i ? { ...newQuestion(kind), id: x.id, text: x.text, marks: x.marks, explanation: x.explanation } : x)));
  const subjects = [...new Set((scope.data?.scope || []).filter((s) => s.courseId === f.courseId).map((s) => s.subject))];

  const body = () => ({
    ...f, semester: Number(f.semester), durationMinutes: Number(f.durationMinutes), maxAttempts: Number(f.maxAttempts), weightage: Number(f.weightage), negativeMarks: Number(f.negativeMarks),
    openAt: fromLocalInput(f.openAt), closeAt: fromLocalInput(f.closeAt),
    ...(locked ? {} : { questions: qs.map((x) => ({ kind: x.kind, text: x.text, marks: Number(x.marks), explanation: x.explanation, options: x.options, answers: x.answers })) }),
  });

  const save = async (then) => {
    setBusy(true); setErr(''); setMsg('');
    try {
      const r = isNew ? await api.post(`/${role}/quizzes`, body()) : await api.put(`/${role}/quizzes/${id}`, body());
      let z = r.quiz;
      if (then === 'publish') z = (await api.post(`/${role}/quizzes/${z.id}/publish`)).quiz;
      if (isNew) { nav(`/${role}/quizzes/${z.id}`, { replace: true }); return; }
      setQuiz(z); setMsg(then === 'publish' ? 'Published. Students of this class can see it now.' : 'Saved.');
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const act = async (path, confirmText) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true); setErr(''); setMsg('');
    try { const r = await api.post(`/${role}/quizzes/${id}/${path}`); setQuiz(r.quiz); setMsg('Done.'); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!window.confirm('Delete this quiz?')) return;
    try { await api.del(`/${role}/quizzes/${id}`); nav(`/${role}/quizzes`); } catch (e) { setErr(e.message); }
  };

  const total = qs.reduce((a, x) => a + (Number(x.marks) || 0), 0);
  return (
    <DataBoundary loading={isNew ? false : loaded.loading} error={loaded.error} data={isNew ? {} : loaded.data} reload={loaded.reload}>
      <PageBanner icon={ClipboardCheck} title={isNew ? 'New quiz' : quiz?.title || 'Quiz'} subtitle={quiz ? `${quiz.status === 'draft' ? 'Draft' : quiz.status === 'published' ? 'Published' : 'Closed'} · ${quiz.attempts} attempt${quiz.attempts === 1 ? '' : 's'} so far` : 'Set the questions, then publish'}
        actions={<Link to={`/${role}/quizzes`} className="btn btn--outline btn--sm"><ArrowLeft size={14} /> Quizzes</Link>} />
      {err && <p className="form-error" role="alert">{err}</p>}{msg && <p className="note" role="status">{msg}</p>}
      {locked && <p className="note">Students have attempted this quiz, so its questions, class and subject are locked. You can still change the title, instructions, timing and how results are shown.</p>}

      <Card title="Settings">
        <div className="fields">
          <div className="form-field form-field--full"><label className="label" htmlFor="q-title">Title</label><input id="q-title" className="input" value={f.title} onChange={set('title')} maxLength={150} /></div>
          <div className="form-field"><label className="label" htmlFor="q-class">Class</label>
            <select id="q-class" className="input" value={f.courseId} onChange={(e) => setF((c) => ({ ...c, courseId: e.target.value, subject: '' }))} disabled={locked}><option value="">Choose...</option>{(scope.data?.classes || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
          <div className="form-field"><label className="label" htmlFor="q-sem">Semester</label><input id="q-sem" className="input" type="number" min="1" max="20" value={f.semester} onChange={set('semester')} disabled={locked} /></div>
          <div className="form-field"><label className="label" htmlFor="q-sub">Subject</label><input id="q-sub" className="input" list="q-subjects" value={f.subject} onChange={set('subject')} disabled={locked} /><datalist id="q-subjects">{subjects.map((s) => <option key={s} value={s} />)}</datalist></div>
          <div className="form-field"><label className="label" htmlFor="q-sec">Section (blank = all)</label><input id="q-sec" className="input" value={f.section} onChange={set('section')} maxLength={20} disabled={locked} /></div>
          <div className="form-field"><label className="label" htmlFor="q-dur">Time limit (minutes)</label><input id="q-dur" className="input" type="number" min="1" max="300" value={f.durationMinutes} onChange={set('durationMinutes')} /></div>
          <div className="form-field"><label className="label" htmlFor="q-att">Attempts allowed</label><input id="q-att" className="input" type="number" min="1" max="10" value={f.maxAttempts} onChange={set('maxAttempts')} /></div>
          <div className="form-field"><label className="label" htmlFor="q-open">Opens</label><input id="q-open" className="input" type="datetime-local" value={f.openAt} onChange={set('openAt')} /></div>
          <div className="form-field"><label className="label" htmlFor="q-close">Closes</label><input id="q-close" className="input" type="datetime-local" value={f.closeAt} onChange={set('closeAt')} /></div>
          <div className="form-field"><label className="label" htmlFor="q-w">Internal marks this quiz is worth</label><input id="q-w" className="input" type="number" min="0.5" step="0.5" value={f.weightage} onChange={set('weightage')} /></div>
          <div className="form-field"><label className="label" htmlFor="q-neg">Negative marking (0 to 1)</label><input id="q-neg" className="input" type="number" min="0" max="1" step="0.05" value={f.negativeMarks} onChange={set('negativeMarks')} /></div>
          <div className="form-field"><label className="label" htmlFor="q-sc">With several attempts, count</label><select id="q-sc" className="input" value={f.scoring} onChange={set('scoring')}><option value="best">The best attempt</option><option value="latest">The latest attempt</option></select></div>
          <div className="form-field"><label className="label" htmlFor="q-show">Results</label><select id="q-show" className="input" value={f.showResults} onChange={set('showResults')}>{Object.entries(SHOW_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
          <div className="form-field form-field--full"><label className="label" htmlFor="q-ins">Instructions for students</label><textarea id="q-ins" className="input" rows={2} value={f.instructions} onChange={set('instructions')} maxLength={2000} /></div>
          <label className="check-row form-field--full"><input type="checkbox" checked={f.shuffle} onChange={set('shuffle')} /> Shuffle the questions and options for each student</label>
        </div>
      </Card>

      <Card title={`Questions (${qs.length}) · ${total} marks`}>
        {qs.map((x, i) => (
          <fieldset key={x.id || i} disabled={locked} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 12, margin: '0 0 12px' }}>
            <legend style={{ padding: '0 6px', fontWeight: 600 }}>Question {i + 1}</legend>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
              <select className="input" aria-label={`Question ${i + 1} type`} style={{ maxWidth: 190 }} value={x.kind} onChange={(e) => changeKind(i, e.target.value)}>{Object.entries(KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              <input className="input" aria-label={`Question ${i + 1} marks`} type="number" min="0.5" step="0.5" style={{ maxWidth: 100 }} value={x.marks} onChange={(e) => setQ(i, { marks: e.target.value })} title="Marks" />
              <span style={{ flex: 1 }} />
              <button type="button" className="icon-btn" aria-label="Move up" onClick={() => move(i, -1)}><ArrowUp size={15} /></button>
              <button type="button" className="icon-btn" aria-label="Move down" onClick={() => move(i, 1)}><ArrowDown size={15} /></button>
              <button type="button" className="icon-btn" aria-label={`Remove question ${i + 1}`} onClick={() => setQs((a) => a.filter((_, n) => n !== i))}><Trash2 size={15} /></button>
            </div>
            <textarea className="input" rows={2} aria-label={`Question ${i + 1} text`} placeholder="Write the question" value={x.text} onChange={(e) => setQ(i, { text: e.target.value })} />
            {x.kind === 'short' ? (
              <textarea className="input" rows={2} style={{ marginTop: 8 }} aria-label="Accepted answers" placeholder="Accepted answers, one per line (case and spacing are ignored)" value={x.answers} onChange={(e) => setQ(i, { answers: e.target.value })} />
            ) : (
              <div style={{ marginTop: 8, display: 'grid', gap: 6 }}>
                {x.options.map((o, j) => (
                  <div key={j} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input type={x.kind === 'multiple' ? 'checkbox' : 'radio'} name={`correct-${i}`} checked={o.correct} onChange={() => markCorrect(i, j)} aria-label={`Option ${j + 1} is correct`} title="Mark as correct" />
                    <input className="input" aria-label={`Option ${j + 1} text`} placeholder={`Option ${j + 1}`} value={o.text} readOnly={x.kind === 'truefalse'} onChange={(e) => setOpt(i, j, { text: e.target.value })} />
                    {x.kind !== 'truefalse' && x.options.length > 2 && <button type="button" className="icon-btn" aria-label={`Remove option ${j + 1}`} onClick={() => setQs((a) => a.map((q, n) => (n === i ? { ...q, options: q.options.filter((_, m) => m !== j) } : q)))}><Trash2 size={14} /></button>}
                  </div>
                ))}
                {x.kind !== 'truefalse' && x.options.length < 8 && <button type="button" className="btn btn--outline btn--sm" style={{ justifySelf: 'start' }} onClick={() => setQs((a) => a.map((q, n) => (n === i ? { ...q, options: [...q.options, { text: '', correct: false }] } : q)))}><Plus size={13} /> Add option</button>}
                <small className="muted">{x.kind === 'multiple' ? 'Tick every correct option. Students get partial credit for right picks; wrong picks cancel them.' : 'Select the one correct option.'}</small>
              </div>
            )}
            <input className="input" style={{ marginTop: 8 }} aria-label="Explanation" placeholder="Explanation shown with the answer (optional)" value={x.explanation} onChange={(e) => setQ(i, { explanation: e.target.value })} maxLength={500} />
          </fieldset>
        ))}
        {!locked && <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{Object.entries(KIND_LABEL).map(([k, v]) => <button key={k} type="button" className="btn btn--outline btn--sm" onClick={() => setQs((a) => [...a, newQuestion(k)])}><Plus size={13} /> {v}</button>)}</div>}
      </Card>

      <div className="form-actions" style={{ justifyContent: 'flex-start', flexWrap: 'wrap' }}>
        <button type="button" className="btn btn--primary" disabled={busy} onClick={() => save()}>{busy ? 'Saving...' : isNew ? 'Save as draft' : 'Save changes'}</button>
        {(isNew || quiz?.status === 'draft') && <button type="button" className="btn btn--primary" disabled={busy} onClick={() => save('publish')}>Save and publish</button>}
        {quiz?.status === 'published' && <button type="button" className="btn btn--outline" disabled={busy} onClick={() => act('close', 'Close the quiz now? Attempts in progress are submitted automatically.')}>Close quiz</button>}
        {quiz?.status === 'closed' && <button type="button" className="btn btn--outline" disabled={busy} onClick={() => act('reopen')}>Reopen</button>}
        {quiz && quiz.status !== 'draft' && <Link className="btn btn--outline" to={`/${role}/quizzes/${id}/results`}>View results</Link>}
        {quiz && !locked && <button type="button" className="btn btn--outline" onClick={remove}><Trash2 size={14} /> Delete</button>}
      </div>
    </DataBoundary>
  );
}

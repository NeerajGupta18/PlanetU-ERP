import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Clock, Send } from 'lucide-react';
import { api } from '../../api/http.js';
import { Badge, Card } from '../../components/ui/Ui.jsx';
import { DataBoundary } from '../../components/ui/Feedback.jsx';
import { KIND_LABEL, cr, mmss } from '../../utils/learning.js';

const answered = (v) => (Array.isArray(v) ? v.length > 0 : v !== undefined && v !== null && String(v).trim() !== '');

export default function QuizTake() {
  const { id } = useParams();
  const nav = useNavigate();
  const [view, setView] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    api.post(`/student/quizzes/${id}/start`).then((v) => live && setView(v)).catch((e) => live && setError(e.message)).finally(() => live && setLoading(false));
    return () => { live = false; };
  }, [id]);

  return (
    <DataBoundary loading={loading} error={error ? { message: error } : null} data={view} reload={() => nav("/student/quizzes")}>
      {view && <Runner view={view} id={id} onDone={() => nav(`/student/quizzes/${id}/result`, { replace: true })} />}
    </DataBoundary>
  );
}

function Runner({ view, id, onDone }) {
  const { quiz, attempt, questions } = view;
  // The server's clock decides when time is up; the browser's is only used to count down smoothly from it
  const offset = useMemo(() => new Date(view.serverNow).getTime() - Date.now(), [view.serverNow]);
  const deadline = new Date(attempt.deadlineAt).getTime();
  const [now, setNow] = useState(Date.now() + offset);
  const [answers, setAnswers] = useState(view.answers || {});
  const [idx, setIdx] = useState(0);
  const [status, setStatus] = useState('saved'); // saved | saving | error
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState('');
  const dirty = useRef({});
  const timer = useRef(null);
  const finished = useRef(false);

  const flush = useCallback(async () => {
    const pending = dirty.current;
    if (!Object.keys(pending).length || finished.current) return;
    dirty.current = {};
    setStatus('saving');
    try {
      const r = await api.put(`/student/quizzes/${id}/answers`, { answers: pending });
      if (r.timeUp) { finished.current = true; onDone(); return; }
      setStatus('saved');
    } catch (e) {
      dirty.current = { ...pending, ...dirty.current }; // keep them to try again
      setStatus('error'); setErr(e.message);
    }
  }, [id, onDone]);

  const change = (qid, value) => {
    setAnswers((a) => ({ ...a, [qid]: value }));
    dirty.current[qid] = answered(value) ? value : '';
    setStatus('saving');
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, 700);
  };

  const submit = useCallback(async (auto = false) => {
    if (finished.current) return;
    finished.current = true; setSubmitting(true); setErr('');
    clearTimeout(timer.current);
    try {
      // Send everything: the server keeps only what arrived before the deadline
      await api.post(`/student/quizzes/${id}/submit`, { answers: Object.fromEntries(Object.entries(answers).filter(([, v]) => answered(v))) });
      onDone();
    } catch (e) {
      finished.current = false; setSubmitting(false);
      setErr(auto ? `Time is up, but we could not submit: ${e.message}` : e.message);
    }
  }, [answers, id, onDone]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() + offset), 1000);
    return () => clearInterval(t);
  }, [offset]);
  useEffect(() => { if (now >= deadline && !finished.current) submit(true); }, [now, deadline, submit]);
  useEffect(() => {
    const warn = (e) => { if (!finished.current) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => { window.removeEventListener('beforeunload', warn); clearTimeout(timer.current); };
  }, []);

  const remaining = deadline - now;
  const q = questions[idx];
  const done = questions.filter((x) => answered(answers[x.id])).length;
  const low = remaining < 5 * 60000;

  const confirmSubmit = () => {
    const left = questions.length - done;
    if (window.confirm(left ? `You have ${left} unanswered question${left === 1 ? '' : 's'}. Submit anyway?` : 'Submit your answers now?')) submit(false);
  };

  return (
    <>
      <div className="card" style={{ position: 'sticky', top: 0, zIndex: 5, display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', padding: '10px 16px' }}>
        <div><strong>{quiz.title}</strong><div className="muted" style={{ fontSize: 13 }}>{quiz.subject} · {cr(quiz.totalMarks)} marks · attempt {attempt.no}</div></div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <span className="muted" style={{ fontSize: 12.5 }} role="status">{status === 'saving' ? 'Saving...' : status === 'error' ? 'Not saved: retrying' : 'All answers saved'}</span>
          <span aria-label="Time remaining" style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700, fontSize: 20, color: low ? 'var(--red, #dc2626)' : 'inherit' }}><Clock size={16} style={{ verticalAlign: '-2px' }} /> {mmss(remaining)}</span>
        </div>
      </div>
      {err && <p className="form-error" role="alert">{err}</p>}
      {idx === 0 && quiz.instructions && <p className="note">{quiz.instructions}{quiz.negativeMarks > 0 ? ` A wrong single-answer question loses ${quiz.negativeMarks * 100}% of its marks.` : ''}</p>}

      <div className="quiz-layout">
        <Card title={`Question ${idx + 1} of ${questions.length}`} action={<span className="badges"><Badge tone="gray">{KIND_LABEL[q.kind]}</Badge><Badge tone="blue">{cr(q.marks)} mark{q.marks === 1 ? '' : 's'}</Badge></span>}>
          <p style={{ fontSize: 16.5, marginTop: 0, whiteSpace: 'pre-wrap' }}>{q.text}</p>
          {q.kind === 'short' ? (
            <input className="input" aria-label="Your answer" value={answers[q.id] ?? ''} onChange={(e) => change(q.id, e.target.value)} maxLength={500} placeholder="Type your answer" autoComplete="off" />
          ) : (
            <div role={q.kind === 'multiple' ? 'group' : 'radiogroup'} aria-label="Options" style={{ display: 'grid', gap: 8 }}>
              {q.kind === 'multiple' && <small className="muted">Choose all that apply.</small>}
              {q.options.map((o) => {
                const sel = q.kind === 'multiple' ? (answers[q.id] || []).includes(o.i) : answers[q.id] === o.i;
                return (
                  <label key={o.i} className="card" style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '10px 14px', cursor: 'pointer', borderColor: sel ? 'var(--primary, #4f46e5)' : undefined, background: sel ? 'var(--primary-soft, #eef2ff)' : undefined }}>
                    <input
                      type={q.kind === 'multiple' ? 'checkbox' : 'radio'} name={`q-${q.id}`} checked={sel}
                      onChange={() => change(q.id, q.kind === 'multiple' ? (sel ? (answers[q.id] || []).filter((x) => x !== o.i) : [...(answers[q.id] || []), o.i].sort((a, b) => a - b)) : o.i)}
                    />
                    <span>{o.text}</span>
                  </label>
                );
              })}
              {q.kind !== 'multiple' && answered(answers[q.id]) && <button type="button" className="btn btn--outline btn--sm" style={{ justifySelf: 'start' }} onClick={() => change(q.id, '')}>Clear my answer</button>}
            </div>
          )}
          <div className="form-actions" style={{ justifyContent: 'space-between' }}>
            <button type="button" className="btn btn--outline" disabled={idx === 0} onClick={() => { setIdx(idx - 1); flush(); }}><ChevronLeft size={15} /> Previous</button>
            {idx < questions.length - 1
              ? <button type="button" className="btn btn--primary" onClick={() => { setIdx(idx + 1); flush(); }}>Next <ChevronRight size={15} /></button>
              : <button type="button" className="btn btn--primary" disabled={submitting} onClick={confirmSubmit}><Send size={15} /> {submitting ? 'Submitting...' : 'Submit quiz'}</button>}
          </div>
        </Card>
        <Card title={`Answered ${done} of ${questions.length}`}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(38px, 1fr))', gap: 6 }}>
            {questions.map((x, n) => (
              <button
                key={x.id} type="button" onClick={() => { setIdx(n); flush(); }} aria-label={`Question ${n + 1}${answered(answers[x.id]) ? ', answered' : ', not answered'}`} aria-current={n === idx ? 'step' : undefined}
                className={`btn btn--sm ${n === idx ? 'btn--primary' : 'btn--outline'}`} style={answered(answers[x.id]) && n !== idx ? { background: '#dcfce7', borderColor: '#86efac' } : undefined}
              >{n + 1}</button>
            ))}
          </div>
          <button type="button" className="btn btn--primary" style={{ width: '100%', marginTop: 12 }} disabled={submitting} onClick={confirmSubmit}><Send size={15} /> Submit quiz</button>
        </Card>
      </div>
    </>
  );
}

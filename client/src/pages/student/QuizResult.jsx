import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, Circle, MinusCircle, XCircle } from 'lucide-react';
import { useFetch } from '../../hooks/useFetch.js';
import { Badge, Card, PageBanner, StatCard } from '../../components/ui/Ui.jsx';
import { DataBoundary } from '../../components/ui/Feedback.jsx';
import { cr, fmtDateTime } from '../../utils/learning.js';

export default function QuizResult() {
  const { id } = useParams();
  const nav = useNavigate();
  const { data, loading, error, reload } = useFetch(`/student/quizzes/${id}/result`);
  return (
    <DataBoundary loading={loading} error={error} data={data} reload={reload}>
      {data && <Result d={data} nav={nav} id={id} />}
    </DataBoundary>
  );
}

const MARK = { true: { Icon: CheckCircle2, color: '#16a34a', label: 'Correct' }, partial: { Icon: MinusCircle, color: '#d97706', label: 'Partly correct' }, false: { Icon: XCircle, color: '#dc2626', label: 'Wrong' }, null: { Icon: Circle, color: '#94a3b8', label: 'Not answered' } };

function Result({ d, nav, id }) {
  const { quiz, counted, attempts, review } = d;
  const running = attempts.some((a) => a.status === 'in_progress');
  return (
    <>
      <PageBanner icon={CheckCircle2} title={quiz.title} subtitle={`${quiz.subject} · ${attempts.length} attempt${attempts.length === 1 ? '' : 's'}`} actions={<Link to="/student/quizzes" className="btn btn--outline btn--sm"><ArrowLeft size={14} /> All quizzes</Link>} />
      {running ? (
        <Card><p style={{ margin: 0 }}>You have an attempt in progress. <button type="button" className="btn btn--primary btn--sm" onClick={() => nav(`/student/quizzes/${id}/take`)}>Resume</button></p></Card>
      ) : counted ? (
        <div className="stats">
          <StatCard value={`${cr(counted.score)} / ${cr(counted.max)}`} label={`Your ${quiz.scoring === 'latest' ? 'latest' : 'best'} score (attempt ${counted.no})`} icon={CheckCircle2} tone="indigo" />
          <StatCard value={`${counted.pct}%`} label="Percentage" icon={CheckCircle2} tone="green" />
          <StatCard value={`${cr(counted.marks)} / ${cr(quiz.weightage)}`} label="Internal marks from this quiz" icon={CheckCircle2} tone="amber" />
        </div>
      ) : (
        <Card><p style={{ margin: 0 }}><strong>Submitted.</strong> {quiz.showResults === 'never' ? 'Your teacher will share your result.' : 'Your score will appear here once the quiz closes.'}</p></Card>
      )}
      {d.canRetry && <Card><p style={{ margin: 0 }}>You have {quiz.attemptsLeft} attempt{quiz.attemptsLeft === 1 ? '' : 's'} left. <button type="button" className="btn btn--primary btn--sm" onClick={() => nav(`/student/quizzes/${id}/take`)}>Try again</button></p></Card>}
      {attempts.length > 1 && (
        <Card title="Your attempts">
          <ul className="plain-list">{attempts.map((a) => <li key={a.no}>Attempt {a.no}: {a.status === 'in_progress' ? 'in progress' : a.score !== null ? `${cr(a.score)} / ${cr(a.max)}` : 'submitted'} {a.submittedAt && <span className="muted">· {fmtDateTime(a.submittedAt)}{a.auto ? ' (submitted automatically when time ran out)' : ''}</span>}</li>)}</ul>
        </Card>
      )}
      {review ? (
        <Card title="Review your answers">
          {review.map((x, n) => {
            const m = MARK[String(x.correct)];
            return (
              <div key={x.id} style={{ borderTop: n ? '1px solid var(--border)' : 'none', padding: '12px 0' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <strong>{n + 1}. {x.text}</strong>
                  <Badge tone={x.correct === true ? 'green' : x.correct === 'partial' ? 'amber' : x.correct === false ? 'red' : 'gray'}><m.Icon size={11} /> {m.label} · {cr(x.awarded)} / {cr(x.marks)}</Badge>
                </div>
                {x.kind === 'short' ? (
                  <p className="muted" style={{ margin: '6px 0 0' }}>Your answer: <strong>{x.answer || 'none'}</strong> · Accepted: {x.accepted.join(', ')}</p>
                ) : (
                  <ul className="plain-list" style={{ margin: '6px 0 0' }}>
                    {x.options.map((o, k) => <li key={k} style={{ color: o.correct ? '#15803d' : o.chosen ? '#b91c1c' : undefined, fontWeight: o.correct || o.chosen ? 600 : 400 }}>{o.chosen ? '● ' : '○ '}{o.text}{o.correct ? '  (correct)' : o.chosen ? '  (your answer)' : ''}</li>)}
                  </ul>
                )}
                {x.explanation && <p className="note" style={{ margin: '8px 0 0' }}>{x.explanation}</p>}
              </div>
            );
          })}
        </Card>
      ) : counted && quiz.attemptsLeft > 0 && quiz.showResults === 'after_submit' && <p className="note">The correct answers are shown once you have used all your attempts or the quiz closes.</p>}
    </>
  );
}

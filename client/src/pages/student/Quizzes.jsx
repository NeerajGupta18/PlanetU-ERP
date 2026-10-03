import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ClipboardCheck, Clock, Play } from 'lucide-react';
import { useFetch } from '../../hooks/useFetch.js';
import { Badge, Card, PageBanner, Tabs } from '../../components/ui/Ui.jsx';
import { DataBoundary, EmptyState } from '../../components/ui/Feedback.jsx';
import { QUIZ_STATE, cr, fmtDateTime } from '../../utils/learning.js';

export default function Quizzes() {
  const [tab, setTab] = useState('quizzes');
  return (
    <>
      <PageBanner icon={ClipboardCheck} title="Quizzes" subtitle="Timed quizzes set by your teachers. They count towards your internal marks." />
      <Card>
        <Tabs tabs={[{ id: 'quizzes', label: 'Quizzes' }, { id: 'marks', label: 'Internal marks' }]} active={tab} onChange={setTab} />
        {tab === 'quizzes' ? <List /> : <Marks />}
      </Card>
    </>
  );
}

function List() {
  const nav = useNavigate();
  const { data, loading, error, reload } = useFetch('/student/quizzes');
  return (
    <DataBoundary loading={loading} error={error} data={data} reload={reload}>
      {data && (data.quizzes.length === 0 ? <EmptyState title="No quizzes yet" hint="Quizzes your teachers publish for your class appear here." /> : (
        <div className="grid-2" style={{ alignItems: 'stretch' }}>
          {data.quizzes.map((z) => {
            const st = QUIZ_STATE[z.state];
            const canGo = ['open', 'retry', 'in_progress'].includes(z.state);
            return (
              <Card key={z.id} title={z.title} action={<Badge tone={st.tone}>{st.label}</Badge>}>
                <div className="badges" style={{ marginBottom: 8 }}>
                  <Badge tone="blue">{z.subject}</Badge><Badge tone="gray"><Clock size={11} /> {z.durationMinutes} min</Badge>
                  <Badge tone="gray">{z.questions} questions · {cr(z.totalMarks)} marks</Badge><Badge tone="purple">Worth {cr(z.weightage)} internal marks</Badge>
                </div>
                <p className="muted" style={{ margin: '0 0 8px', fontSize: 13.5 }}>
                  {z.openAt && z.window === 'upcoming' ? `Opens ${fmtDateTime(z.openAt)}. ` : ''}{z.closeAt ? `Closes ${fmtDateTime(z.closeAt)}.` : 'No closing date.'} Attempts used: {z.attemptsUsed} of {z.maxAttempts}.
                </p>
                {z.result && !z.result.hidden && <p style={{ margin: '0 0 8px' }}><strong>{cr(z.result.score)} / {cr(z.result.max)}</strong> <span className="muted">· {cr(z.result.marks)} of {cr(z.weightage)} internal marks</span></p>}
                {z.result?.hidden && <p className="muted" style={{ margin: '0 0 8px' }}>Your score will be shown {z.showResults === 'never' ? 'by your teacher' : 'after the quiz closes'}.</p>}
                <div className="form-actions" style={{ justifyContent: 'flex-start' }}>
                  {canGo && <button type="button" className="btn btn--primary btn--sm" onClick={() => nav(`/student/quizzes/${z.id}/take`)}><Play size={13} /> {z.state === 'in_progress' ? 'Resume' : z.state === 'retry' ? 'Try again' : 'Start quiz'}</button>}
                  {z.attemptsUsed > 0 && z.state !== 'in_progress' && <Link className="btn btn--outline btn--sm" to={`/student/quizzes/${z.id}/result`}>View result</Link>}
                </div>
              </Card>
            );
          })}
        </div>
      ))}
    </DataBoundary>
  );
}

function Marks() {
  const { data, loading, error, reload } = useFetch('/student/internal-marks');
  return (
    <DataBoundary loading={loading} error={error} data={data} reload={reload}>
      {data && (data.subjects.length === 0 ? <EmptyState title="No internal marks yet" hint="Your quiz marks appear here by subject." /> : data.subjects.map((s) => (
        <Card key={s.subject} title={s.subject} action={<strong>{cr(s.obtained)} / {cr(s.outOf)}{s.pct !== null ? ` (${s.pct}%)` : ''}</strong>}>
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Quiz</th><th className="num">Worth</th><th className="num">Score</th><th className="num">Internal marks</th></tr></thead>
            <tbody>{s.quizzes.map((q) => (
              <tr key={q.id}>
                <td>{q.title}</td><td className="num">{cr(q.weightage)}</td>
                <td className="num">{q.hidden ? 'Hidden' : q.score !== null ? `${cr(q.score)} / ${cr(q.max)}` : '-'}</td>
                <td className="num"><strong>{q.hidden ? 'Pending' : q.marks !== null ? cr(q.marks) : q.counted ? '0' : 'Pending'}</strong></td>
              </tr>
            ))}</tbody>
          </table></div>
        </Card>
      )))}
    </DataBoundary>
  );
}

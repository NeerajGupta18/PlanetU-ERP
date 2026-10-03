import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, ClipboardCheck } from 'lucide-react';
import { useFetch } from '../../hooks/useFetch.js';
import { api } from '../../api/http.js';
import { Badge, Card, PageBanner, StatCard } from '../../components/ui/Ui.jsx';
import { DataBoundary } from '../../components/ui/Feedback.jsx';
import { cr } from '../../utils/learning.js';

const STATUS = { done: { label: 'Submitted', tone: 'green' }, in_progress: { label: 'In progress', tone: 'amber' }, not_attempted: { label: 'Not attempted', tone: 'gray' } };

export default function QuizResults({ role }) {
  const { id } = useParams();
  const { data, loading, error, reload } = useFetch(`/${role}/quizzes/${id}/results`);
  const [err, setErr] = useState(''); const [msg, setMsg] = useState('');
  const extra = async (s) => {
    setErr(''); setMsg('');
    try { await api.post(`/${role}/quizzes/${id}/extra-attempts`, { studentId: s.id }); setMsg(`${s.name} can attempt the quiz once more.`); reload(); } catch (e) { setErr(e.message); }
  };
  return (
    <DataBoundary loading={loading} error={error} data={data} reload={reload}>
      {data && (() => {
        const { quiz: z, stats: st } = data;
        return (
          <>
            <PageBanner icon={ClipboardCheck} title={`${z.title}: results`} subtitle={`${z.subject} · ${z.className} · Sem ${z.semester} · ${cr(z.totalMarks)} marks · worth ${cr(z.weightage)} internal marks · counts the ${z.scoring} attempt`}
              actions={<Link to={`/${role}/quizzes/${id}`} className="btn btn--outline btn--sm"><ArrowLeft size={14} /> Quiz</Link>} />
            {err && <p className="form-error" role="alert">{err}</p>}{msg && <p className="note" role="status">{msg}</p>}
            <div className="stats">
              <StatCard value={`${st.attempted} / ${st.eligible}`} label="Have submitted" icon={ClipboardCheck} tone="indigo" />
              <StatCard value={st.average === null ? '-' : `${st.average}%`} label="Class average" icon={ClipboardCheck} tone="green" />
              <StatCard value={st.highest === null ? '-' : `${st.highest}%`} label="Highest" icon={ClipboardCheck} tone="amber" />
              <StatCard value={st.lowest === null ? '-' : `${st.lowest}%`} label="Lowest" icon={ClipboardCheck} tone="rose" />
            </div>
            <Card title="Students">
              <div className="table-wrap"><table className="table">
                <thead><tr><th>Student</th><th>Status</th><th className="num">Score</th><th className="num">%</th><th className="num">Internal marks</th><th>Attempts</th><th /></tr></thead>
                <tbody>{data.students.map((s) => (
                  <tr key={s.id}>
                    <td><strong>{s.name}</strong><br /><small className="muted">{s.code}{s.section ? ` · Sec ${s.section}` : ''}</small></td>
                    <td><Badge tone={STATUS[s.status].tone}>{STATUS[s.status].label}</Badge></td>
                    <td className="num">{s.score !== null ? `${cr(s.score)} / ${cr(s.max)}` : '-'}</td><td className="num">{s.pct !== null ? `${s.pct}%` : '-'}</td>
                    <td className="num"><strong>{s.marks !== null ? `${cr(s.marks)} / ${cr(z.weightage)}` : '-'}</strong></td>
                    <td><small>{s.attempts.length ? s.attempts.map((a) => `#${a.no}: ${a.status === 'submitted' ? `${cr(a.score)}${a.auto ? ' (auto)' : ''}` : 'running'}`).join(' · ') : '-'}{s.extra > 0 ? ` · +${s.extra} extra` : ''}</small></td>
                    <td>{s.attempts.some((a) => a.status === 'submitted') && s.status !== 'in_progress' && <button type="button" className="btn btn--outline btn--sm" onClick={() => extra(s)}>Allow another attempt</button>}</td>
                  </tr>
                ))}</tbody>
              </table></div>
            </Card>
            <Card title="Question analysis">
              <div className="table-wrap"><table className="table">
                <thead><tr><th>#</th><th>Question</th><th className="num">Marks</th><th className="num">Got it right</th></tr></thead>
                <tbody>{data.analytics.map((x) => (
                  <tr key={x.id}><td>{x.position}</td><td>{x.text}</td><td className="num">{cr(x.marks)}</td>
                    <td className="num">{x.pctRight === null ? '-' : <Badge tone={x.pctRight >= 70 ? 'green' : x.pctRight >= 40 ? 'amber' : 'red'}>{x.pctRight}% ({x.right}/{x.asked})</Badge>}</td></tr>
                ))}</tbody>
              </table></div>
              <p className="muted" style={{ marginBottom: 0 }}>Questions few students got right may be unclear or taught less well.</p>
            </Card>
          </>
        );
      })()}
    </DataBoundary>
  );
}

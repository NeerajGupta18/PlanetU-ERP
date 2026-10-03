import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ClipboardCheck, Plus } from 'lucide-react';
import { useFetch } from '../../hooks/useFetch.js';
import { Badge, Card, PageBanner, Tabs } from '../../components/ui/Ui.jsx';
import { DataBoundary, EmptyState } from '../../components/ui/Feedback.jsx';
import { cr, fmtDateTime } from '../../utils/learning.js';

const STATUS = { draft: { label: 'Draft', tone: 'amber' }, published: { label: 'Published', tone: 'green' }, closed: { label: 'Closed', tone: 'gray' } };

/** Quizzes for admins and faculty. `role` is 'admin' or 'employee'. */
export default function QuizManage({ role }) {
  const [tab, setTab] = useState('quizzes');
  const nav = useNavigate();
  return (
    <>
      <PageBanner icon={ClipboardCheck} title="Quizzes" subtitle="Set timed, auto-graded quizzes for a subject. Scores count towards internal marks."
        actions={<button type="button" className="btn btn--primary btn--sm" onClick={() => nav(`/${role}/quizzes/new`)}><Plus size={14} /> New quiz</button>} />
      <Card>
        <Tabs tabs={[{ id: 'quizzes', label: 'Quizzes' }, { id: 'marks', label: 'Internal marks' }]} active={tab} onChange={setTab} />
        {tab === 'quizzes' ? <List role={role} /> : <Marks role={role} />}
      </Card>
    </>
  );
}

function List({ role }) {
  const { data, loading, error, reload } = useFetch(`/${role}/quizzes`);
  return (
    <DataBoundary loading={loading} error={error} data={data} reload={reload}>
      {data && (data.quizzes.length === 0 ? <EmptyState title="No quizzes yet" hint="Create a quiz, add questions, and publish it to a class." /> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Quiz</th><th>Class</th><th className="num">Questions</th><th className="num">Worth</th><th>Window</th><th>Submitted</th><th>Status</th><th /></tr></thead>
          <tbody>{data.quizzes.map((z) => (
            <tr key={z.id}>
              <td><strong>{z.title}</strong><br /><small className="muted">{z.subject}</small></td>
              <td>{z.className}<br /><small className="muted">Sem {z.semester}{z.section ? ` · Sec ${z.section}` : ''}</small></td>
              <td className="num">{z.questions} <small className="muted">({cr(z.totalMarks)} marks)</small></td><td className="num">{cr(z.weightage)}</td>
              <td><small>{z.openAt ? fmtDateTime(z.openAt) : 'Any time'}<br />to {z.closeAt ? fmtDateTime(z.closeAt) : 'no end'}</small></td>
              <td>{z.submittedBy} / {z.eligible}</td>
              <td><Badge tone={STATUS[z.status].tone}>{STATUS[z.status].label}</Badge>{z.status === 'published' && z.window === 'upcoming' && <> <Badge tone="gray">opens later</Badge></>}</td>
              <td style={{ whiteSpace: 'nowrap' }}>{z.status !== 'draft' && <Link className="btn btn--primary btn--sm" to={`/${role}/quizzes/${z.id}/results`}>Results</Link>} <Link className="btn btn--outline btn--sm" to={`/${role}/quizzes/${z.id}`}>{z.status === 'draft' ? 'Edit' : 'Open'}</Link></td>
            </tr>
          ))}</tbody>
        </table></div>
      ))}
    </DataBoundary>
  );
}

function Marks({ role }) {
  const scope = useFetch(`/${role}/quizzes/scope`);
  const [pick, setPick] = useState({ courseId: '', semester: '', subject: '' });
  const ready = pick.courseId && pick.semester && pick.subject;
  const qs = new URLSearchParams(pick).toString();
  const { data, loading, error, reload } = useFetch(ready ? `/${role}/quizzes/internal-marks?${qs}` : null);
  const subjects = [...new Set((scope.data?.scope || []).filter((s) => s.courseId === pick.courseId).map((s) => s.subject))];
  const set = (k) => (e) => setPick((p) => ({ ...p, [k]: e.target.value, ...(k === 'courseId' ? { subject: '' } : {}) }));
  return (
    <>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '0 0 12px' }}>
        <select className="input" style={{ maxWidth: 220 }} aria-label="Class" value={pick.courseId} onChange={set('courseId')}><option value="">Choose a class...</option>{(scope.data?.classes || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <input className="input" style={{ maxWidth: 120 }} aria-label="Semester" type="number" min="1" max="20" placeholder="Semester" value={pick.semester} onChange={set('semester')} />
        <input className="input" style={{ maxWidth: 240 }} aria-label="Subject" list="im-subjects" placeholder="Subject" value={pick.subject} onChange={set('subject')} /><datalist id="im-subjects">{subjects.map((s) => <option key={s} value={s} />)}</datalist>
        {role === 'admin' && ready && <Link className="btn btn--outline btn--sm" to={`/admin/reports?report=internal-marks&courseId=${pick.courseId}&semester=${pick.semester}&subject=${encodeURIComponent(pick.subject)}`}>Export</Link>}
      </div>
      {!ready ? <EmptyState title="Choose a class, semester and subject" hint="You will see every student's marks from each quiz and their internal total." /> : (
        <DataBoundary loading={loading} error={error} data={data} reload={reload}>
          {data && (data.quizzes.length === 0 ? <EmptyState title="No published quizzes for this subject yet" /> : (
            <div className="table-wrap"><table className="table">
              <thead><tr><th>Student</th>{data.quizzes.map((z) => <th key={z.id} className="num">{z.title}<br /><small className="muted">/ {cr(z.weightage)}</small></th>)}<th className="num">Internal marks</th></tr></thead>
              <tbody>{data.students.map((s) => (
                <tr key={s.id}>
                  <td><strong>{s.name}</strong><br /><small className="muted">{s.code}</small></td>
                  {s.cells.map((c, i) => <td key={i} className="num">{!c.eligible ? <span className="muted">n/a</span> : c.attempted ? cr(c.marks) : c.pending ? <span className="muted">pending</span> : <span className="muted">0 (absent)</span>}</td>)}
                  <td className="num"><strong>{cr(s.obtained)} / {cr(s.outOf)}</strong></td>
                </tr>
              ))}</tbody>
            </table></div>
          ))}
          {data && data.quizzes.length > 0 && <p className="muted">A quiz still open is shown as pending and left out of the total until it closes or the student submits it.</p>}
        </DataBoundary>
      )}
    </>
  );
}

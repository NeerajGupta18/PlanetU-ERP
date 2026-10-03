import { Award, FileText, GraduationCap } from 'lucide-react';
import { useFetch } from '../../hooks/useFetch.js';
import { Badge, Card, PageBanner, StatCard } from '../../components/ui/Ui.jsx';
import { DataBoundary, EmptyState } from '../../components/ui/Feedback.jsx';
import { fmtDate } from '../../utils/dates.js';
import { KIND_LABEL, RESULT_LABEL, RESULT_TONE, gradeTone, num } from '../../utils/exams.js';

export default function Results() {
  const { data, loading, error, reload } = useFetch('/student/results');
  return (
    <>
      <PageBanner icon={GraduationCap} title="My results" subtitle="Marks, grades and GPA for every published exam" />
      <DataBoundary loading={loading} error={error} data={data} reload={reload}>
        {data && (data.exams.length === 0 ? (
          <Card><EmptyState title="No results published yet" hint="Your marks appear here as soon as your institute publishes an exam." /></Card>
        ) : (
          <>
            <div className="stats">
              <StatCard value={data.cgpa === null ? '-' : data.cgpa.toFixed(2)} label="CGPA (semester-end exams)" icon={Award} tone="indigo" />
              <StatCard value={data.exams.length} label={`Published exam${data.exams.length === 1 ? '' : 's'}`} icon={GraduationCap} tone="green" />
            </div>
            {data.exams.map((e) => <ExamCard key={e.id} e={e} />)}
          </>
        ))}
      </DataBoundary>
    </>
  );
}

function ExamCard({ e }) {
  return (
    <Card
      title={`${e.name} · semester ${e.semester}`}
      action={<a className="btn btn--outline btn--sm" href={`/api/student/results/${e.id}/report-card.pdf`} target="_blank" rel="noreferrer"><FileText size={13} /> Report card</a>}
    >
      <div className="badges" style={{ marginBottom: 12 }}>
        <Badge tone="blue">{KIND_LABEL[e.kind]}</Badge>
        <Badge tone={RESULT_TONE[e.result]}>{RESULT_LABEL[e.result]}</Badge>
        {e.gpa !== null && <Badge tone="purple">GPA {e.gpa.toFixed(2)}</Badge>}
        {e.pct !== null && <Badge tone="gray">{num(e.pct)}% · {num(e.total)} / {num(e.maxTotal)}</Badge>}
        {e.publishedAt && <Badge tone="gray">Published {fmtDate(String(e.publishedAt).slice(0, 10))}</Badge>}
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Subject</th><th>Credits</th><th>Marks</th><th>%</th><th>Grade</th><th>Result</th></tr></thead>
          <tbody>
            {e.subjects.map((s) => (
              <tr key={s.subject}>
                <td><strong>{s.subject}</strong></td>
                <td>{num(s.credits)}</td>
                <td>{s.absent ? 'Absent' : `${num(s.marks)} / ${num(s.maxMarks)}`}</td>
                <td>{s.absent ? '-' : `${num(s.pct)}%`}</td>
                <td><Badge tone={gradeTone(s)}>{s.grade}</Badge></td>
                <td><Badge tone={s.passed ? 'green' : 'red'}>{s.passed ? 'Pass' : s.absent ? 'Absent' : 'Fail'}</Badge></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {e.result === 'fail' && <p className="note">Not cleared: {e.failedSubjects.join(', ')}. Credits earned: {num(e.creditsEarned)} of {num(e.totalCredits)}.</p>}
    </Card>
  );
}

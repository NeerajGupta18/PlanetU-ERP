import { Link } from 'react-router-dom';
import { GraduationCap, PenLine } from 'lucide-react';
import { useFetch } from '../../hooks/useFetch.js';
import { Badge, Card, PageBanner } from '../../components/ui/Ui.jsx';
import { DataBoundary, EmptyState } from '../../components/ui/Feedback.jsx';
import { KIND_LABEL, num } from '../../utils/exams.js';

/** Faculty: every exam paper an admin assigned to them. Open ones come first. */
export default function Exams() {
  const { data, loading, error, reload } = useFetch('/employee/exams/papers');
  const papers = data?.papers || [];
  const open = papers.filter((p) => p.examStatus === 'draft');
  const done = papers.filter((p) => p.examStatus === 'published');

  const Table = ({ rows, action }) => (
    <div className="table-wrap">
      <table className="table">
        <thead><tr><th>Exam</th><th>Subject</th><th>Class</th><th>Out of</th><th>Progress</th><th /></tr></thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.id}>
              <td><strong>{p.examName}</strong><br /><small className="muted">{KIND_LABEL[p.kind]}</small></td>
              <td>{p.subject}</td>
              <td>{p.course}<br /><small className="muted">Semester {p.semester}</small></td>
              <td>{num(p.maxMarks)} <small className="muted">(pass {num(p.passMarks)})</small></td>
              <td><Badge tone={p.marksStatus === 'submitted' ? 'green' : p.entered ? 'amber' : 'gray'}>{p.marksStatus === 'submitted' ? 'Submitted' : p.entered ? 'Draft' : 'Not started'} · {p.entered}/{p.roster}</Badge></td>
              <td><Link className={`btn btn--sm ${action === 'Enter marks' && p.marksStatus !== 'submitted' ? 'btn--primary' : 'btn--outline'}`} to={`/employee/exams/${p.id}`}><PenLine size={13} /> {p.marksStatus === 'submitted' && action === 'Enter marks' ? 'Review / edit' : action}</Link></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <>
      <PageBanner icon={GraduationCap} title="Exam marks" subtitle="Enter the marks for the papers assigned to you" />
      <DataBoundary loading={loading} error={error} data={data} reload={reload}>
        {data && (papers.length === 0 ? (
          <Card><EmptyState title="No papers assigned" hint="When an admin assigns you an exam paper, it will appear here." /></Card>
        ) : (
          <>
            <Card title="Waiting for your marks">{open.length ? <Table rows={open} action="Enter marks" /> : <EmptyState title="All caught up" hint="Nothing is waiting for you right now." />}</Card>
            {done.length > 0 && <Card title="Published">{<Table rows={done} action="View" />}</Card>}
          </>
        ))}
      </DataBoundary>
    </>
  );
}

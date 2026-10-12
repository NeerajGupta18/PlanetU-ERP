import { Link } from 'react-router-dom';
import { BookOpen, CheckCircle2, ClipboardCheck, Clock, GraduationCap, LayoutDashboard, PenLine } from 'lucide-react';
import { useFetch } from '../../hooks/useFetch.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useTenantConfig } from '../../hooks/useTenantConfig.js';
import { Card, PageBanner, StatCard } from '../../components/ui/Ui.jsx';
import { DataBoundary } from '../../components/ui/Feedback.jsx';
import LectureList from '../../components/attendance/LectureList.jsx';
import { fmtLong, greeting } from '../../utils/dates.js';
import { KIND_LABEL } from '../../utils/exams.js';

export default function EmployeeDashboard() {
  const { user } = useAuth();
  const { hasModule } = useTenantConfig();
  const canMark = hasModule('attendance') && hasModule('timetable');
  const { data, loading, error, reload } = useFetch(canMark ? '/employee/attendance/today' : null);
  const showMarks = hasModule('exams');
  const papersFetch = useFetch(showMarks ? '/employee/exams/papers' : null);
  const waiting = (papersFetch.data?.papers || []).filter((p) => p.examStatus === 'draft' && p.marksStatus !== 'submitted');
  const lectures = data?.lectures || [];
  const pending = lectures.filter((l) => l.sessionStatus !== 'submitted').length;

  return (
    <>
      <PageBanner
        icon={LayoutDashboard} title={`${greeting()}, ${user.name.split(' ')[0]}`}
        subtitle={canMark && data ? fmtLong(data.date) : 'Welcome to your workspace'}
      />
      {showMarks && papersFetch.data && waiting.length > 0 && (
        <Card title="Marks still to enter" icon={GraduationCap} action={<Link to="/employee/exams" className="btn btn--outline btn--sm">All papers</Link>}>
          <ul className="todo">
            {waiting.slice(0, 5).map((p) => (
              <li key={p.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <span><strong>{p.subject}</strong> - {p.examName} ({KIND_LABEL[p.kind]}), {p.course} <span className="muted">{p.entered}/{p.roster} entered</span></span>
                <Link className="btn btn--primary btn--sm" to={`/employee/exams/${p.id}`}><PenLine size={13} /> Enter marks</Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {!canMark && !(showMarks && waiting.length > 0) ? (
        <Card title="Your workspace">
          <p className="muted">Your institute has not switched on any employee modules yet.</p>
        </Card>
      ) : !canMark ? null : (
        <DataBoundary loading={loading} error={error} data={data} reload={reload}>
          {data && (
            <>
              <div className="stats">
                <StatCard value={lectures.length} label="Lectures today" icon={BookOpen} tone="indigo" />
                <StatCard value={lectures.length - pending} label="Attendance submitted" icon={CheckCircle2} tone="green" />
                <StatCard value={pending} label="Still to mark" icon={Clock} tone="amber" />
              </div>
              <Card
                title="Today's lectures" icon={ClipboardCheck}
                action={<Link to="/employee/attendance" className="btn btn--outline btn--sm">Open attendance</Link>}
              >
                <LectureList lectures={lectures} holiday={data.holiday} markTo={(l) => `/employee/attendance/${l.slotId}`} />
              </Card>
            </>
          )}
        </DataBoundary>
      )}
    </>
  );
}

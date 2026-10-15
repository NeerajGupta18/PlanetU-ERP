import { Link } from 'react-router-dom';
import { BookOpen, CheckCircle2, ClipboardCheck, Clock, GraduationCap, CalendarOff, LayoutDashboard, Megaphone, PenLine } from 'lucide-react';
import { useFetch } from '../../hooks/useFetch.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useTenantConfig } from '../../hooks/useTenantConfig.js';
import { Badge, Card, PageBanner, StatCard } from '../../components/ui/Ui.jsx';
import { DataBoundary } from '../../components/ui/Feedback.jsx';
import LectureList from '../../components/attendance/LectureList.jsx';
import TodoCard from '../../components/campus/TodoCard.jsx';
import OfficeWorkCard from '../../components/campus/OfficeWorkCard.jsx';
import { firstName, fmtDate, fmtLong, greeting } from '../../utils/dates.js';
import { KIND_LABEL } from '../../utils/exams.js';

export default function EmployeeDashboard() {
  const { user, office } = useAuth();
  const { hasModule } = useTenantConfig();
  // Office staff with no lectures or exam papers (an accountant, a librarian) do not get the teaching sections
  const teaching = office?.teaching !== false;
  const canMark = teaching && hasModule('attendance') && hasModule('timetable');
  const { data, loading, error, reload } = useFetch(canMark ? '/employee/attendance/today' : null);
  const showMarks = teaching && hasModule('exams');
  const papersFetch = useFetch(showMarks ? '/employee/exams/papers' : null);
  const waiting = (papersFetch.data?.papers || []).filter((p) => p.examStatus === 'draft' && p.marksStatus !== 'submitted');
  const noticeFetch = useFetch(hasModule('notices') ? '/employee/notices' : null);
  const recent = (noticeFetch.data?.notices || []).slice(0, 3);
  const leaveFetch = useFetch(hasModule('leave') ? '/employee/leave' : null);
  const leaveBal = (leaveFetch.data?.balances || []).filter((b) => b.allowance !== null);
  const lectures = data?.lectures || [];
  const pending = lectures.filter((l) => l.sessionStatus !== 'submitted').length;

  return (
    <>
      <PageBanner
        icon={LayoutDashboard} title={`${greeting()}, ${firstName(user.name)}`}
        subtitle={canMark && data ? fmtLong(data.date) : 'Welcome to your workspace'}
      />
      <OfficeWorkCard />
      {teaching && <TodoCard path="/employee/todo" />}
      {recent.length > 0 && (
        <Card title={`Notices${noticeFetch.data.unread ? ` (${noticeFetch.data.unread} new)` : ''}`} icon={Megaphone} action={<Link to="/employee/notices" className="btn btn--outline btn--sm">All notices</Link>}>
          <ul className="notices">
            {recent.map((n) => (
              <li key={n.id}>
                <div className="notices__head"><strong>{!n.read && <span className="dot-new" aria-label="New" />}{n.title}</strong><Badge tone={n.priority === 'important' ? 'red' : 'blue'}>{n.priority === 'important' ? 'Important' : n.category}</Badge></div>
                <small className="muted">{fmtDate(n.date)}</small>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {leaveBal.length > 0 && (
        <Card title="My leave" icon={CalendarOff} action={<Link to="/employee/leave" className="btn btn--outline btn--sm">Apply or view</Link>}>
          <p style={{ margin: 0 }}>{leaveBal.map((b) => `${b.name}: ${b.left} left`).join('  -  ')}</p>
        </Card>
      )}
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
      {!teaching ? null : !canMark && !(showMarks && waiting.length > 0) ? (
        <Card title="Your workspace">
          <p className="muted">Your institute has not switched on any employee modules yet.</p>
        </Card>
      ) : !canMark ? null : (
        <DataBoundary loading={loading} error={error} data={data} reload={reload}>
          {data && (
            <>
              <div className="stats">
                <StatCard value={lectures.length} label="Lectures today" icon={BookOpen} to="/employee/attendance" />
                <StatCard value={lectures.length - pending} label="Attendance submitted" icon={CheckCircle2} to="/employee/attendance" {...(lectures.length && !pending ? { status: 'good', hint: 'All done' } : {})} />
                <StatCard value={pending} label="Still to mark" icon={Clock} to="/employee/attendance" {...(pending ? { status: 'warn', hint: 'Mark today' } : { status: 'clear', hint: 'Nothing left' })} />
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

import { Link } from 'react-router-dom';
import { AlertTriangle, CalendarCheck, CalendarOff, ClipboardCheck, FileCheck2, LayoutDashboard, Megaphone, PenLine } from 'lucide-react';
import { useFetch } from '../../hooks/useFetch.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useTenantConfig } from '../../hooks/useTenantConfig.js';
import { Badge, Card, PageBanner, StatCard, pending, CollapsibleCards } from '../../components/ui/Ui.jsx';
import { DataBoundary } from '../../components/ui/Feedback.jsx';
import LectureList from '../../components/attendance/LectureList.jsx';
import TodayStepBar from '../../components/attendance/TodayStepBar.jsx';
import TodoCard from '../../components/campus/TodoCard.jsx';
import OfficeWorkCard from '../../components/campus/OfficeWorkCard.jsx';
import { firstName, fmtDate, fmtLong, greeting, todayISO } from '../../utils/dates.js';
import { plural } from '../../utils/kpi.js';

export default function EmployeeDashboard() {
  const { user, office } = useAuth();
  const { hasModule } = useTenantConfig();
  // Office staff with no lectures or exam papers (an accountant, a librarian) do not get the teaching sections
  const teaching = office?.teaching !== false;
  const canMark = teaching && hasModule('attendance') && hasModule('timetable');
  const { data, loading, error, reload } = useFetch(canMark ? '/employee/attendance/today' : null);
  const todo = useFetch(teaching ? '/employee/todo' : null);
  const noticeFetch = useFetch(hasModule('notices') ? '/employee/notices' : null);
  const recent = (noticeFetch.data?.notices || []).slice(0, 3);
  const leaveFetch = useFetch(hasModule('leave') ? '/employee/leave' : null);
  const leaveBal = (leaveFetch.data?.balances || []).filter((b) => b.allowance !== null);
  const c = todo.data?.counts;
  const leaveLeft = leaveBal.reduce((a, b) => a + Number(b.left || 0), 0);

  return (
    <CollapsibleCards>
      <PageBanner icon={LayoutDashboard} title={`${greeting()}, ${firstName(user.name)}`} subtitle={fmtLong(todayISO())} />

      {/* A teacher's home is today's lectures: the next one to mark comes first */}
      {canMark && (
        <DataBoundary loading={loading} error={error} data={data} reload={reload}>
          {data && <TodayStepBar data={data} />}
          {data && (
            <Card
              title={`Today's lectures${data.lectures.length ? ` (${plural(data.lectures.length, 'lecture')})` : ''}`} icon={ClipboardCheck}
              action={<Link to="/employee/attendance" className="btn btn--outline btn--sm">Open attendance</Link>}
            >
              <LectureList lectures={data.lectures} holiday={data.holiday} daily={data.daily} date={data.date} markTo={(l) => `/employee/attendance/${l.slotId}`} />
            </Card>
          )}
        </DataBoundary>
      )}

      {teaching && c && (
        <div className="stats stats--3">
          {canMark && (
            <StatCard
              value={c.lecturesToday ? <>{c.lecturesToMark}<small>of {c.lecturesToday}</small></> : 0} label="Lectures to mark today" icon={CalendarCheck} to="/employee/attendance"
              {...(c.lecturesToday === 0 ? { status: 'clear', hint: 'No lectures today' } : pending(c.lecturesToMark, { act: 'Mark attendance', clear: 'All marked' }))}
            />
          )}
          {hasModule('assignments') && <StatCard value={c.toGrade} label="Answers to grade" icon={FileCheck2} to="/employee/assignments" {...pending(c.toGrade, { act: 'Grade now', clear: 'Nothing to grade' })} />}
          {hasModule('exams') && <StatCard value={c.papersPending} label="Papers with marks to enter" icon={PenLine} to="/employee/exams" {...pending(c.papersPending, { act: 'Enter marks', clear: 'All marks in' })} />}
          {hasModule('attendance') && (
            <StatCard value={c.lowAttendance} label={`My students below ${todo.data.threshold}%`} icon={AlertTriangle} to="/employee/attendance"
              sub={todo.data.lowAttendance[0] ? `Lowest: ${todo.data.lowAttendance[0].name}, ${todo.data.lowAttendance[0].pct}%` : undefined}
              {...(c.lowAttendance ? { status: 'info', hint: 'Talk to them' } : { status: 'clear', hint: 'Everyone above' })}
            />
          )}
          {hasModule('leave') && leaveBal.length > 0 && (
            <StatCard value={leaveLeft} label="Leave days left" icon={CalendarOff} to="/employee/leave" sub={leaveBal.map((b) => `${b.name} ${b.left}`).join(', ')} />
          )}
          {hasModule('notices') && noticeFetch.data && (
            <StatCard value={noticeFetch.data.unread} label="Unread notices" icon={Megaphone} to="/employee/notices" {...(noticeFetch.data.unread ? { status: 'info', hint: 'New' } : { status: 'clear', hint: 'All read' })} />
          )}
        </div>
      )}

      <OfficeWorkCard />

      {teaching && todo.data && <TodoCard data={todo.data} />}

      {!teaching && !office?.roles?.length && (
        <Card title="Your workspace"><p className="muted">Your institute has not switched on any employee modules yet.</p></Card>
      )}

      {recent.length > 0 && (
        <Card title={`Notices${noticeFetch.data.unread ? ` (${noticeFetch.data.unread} new)` : ''}`} icon={Megaphone} action={<Link to="/employee/notices" className="btn btn--outline btn--sm">All notices</Link>}>
          <ul className="notices">
            {recent.map((n) => (
              <li key={n.id}>
                <div className="notices__head"><strong>{!n.read && <span className="dot-new" role="img" aria-label="New" />}{n.title}</strong><Badge tone={n.priority === 'important' ? 'red' : 'blue'}>{n.priority === 'important' ? 'Important' : n.category}</Badge></div>
                <small className="muted">{fmtDate(n.date)}</small>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {!teaching && leaveBal.length > 0 && (
        <Card title="My leave" icon={CalendarOff} action={<Link to="/employee/leave" className="btn btn--outline btn--sm">Apply or view</Link>}>
          <p style={{ margin: 0 }}>{leaveBal.map((b) => `${b.name}: ${b.left} left`).join('  -  ')}</p>
        </Card>
      )}
    </CollapsibleCards>
  );
}

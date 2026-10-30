import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarOff, ClipboardCheck, Clock, LayoutDashboard, Megaphone, PenLine, PhoneCall } from 'lucide-react';
import { useFetch } from '../../hooks/useFetch.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { Badge, Card, PageBanner, CollapsibleCards } from '../../components/ui/Ui.jsx';
import { EmptyState, ErrorState } from '../../components/ui/Feedback.jsx';
import { Freshness, KpiCard, KpiGrid, KpiLoading } from '../../components/dash/KpiCard.jsx';
import TodayStepBar from '../../components/attendance/TodayStepBar.jsx';
import TodoCard from '../../components/campus/TodoCard.jsx';
import OfficeWorkCard from '../../components/campus/OfficeWorkCard.jsx';
import { firstName, fmtDate, fmtLong, fmtTime, greeting, todayISO } from '../../utils/dates.js';
import { numIn } from '../../utils/kpi.js';

const toMinutes = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; };
const nowMinutes = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
const inWords = (mins) => (mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)} h${mins % 60 ? ` ${mins % 60} min` : ''}`);

/** A lecture's place in the day, in words. Marked first: what the register says outranks the clock. */
function stateOf(l, now) {
  if (l.sessionStatus === 'submitted') return { tone: 'green', word: `Marked, ${l.attended} of ${l.marked} present`, done: true };
  if (l.sessionStatus === 'draft') return { tone: 'amber', word: 'Started, not submitted' };
  if (now < toMinutes(l.start)) return { tone: 'gray', word: 'Later today' };
  if (now < toMinutes(l.end)) return { tone: 'blue', word: 'On now' };
  return { tone: 'red', word: 'Over, not marked' };
}

/** The flagship: the day as a timeline with a countdown to the next lecture and a one-tap Mark on each. */
function MyDay({ lectures }) {
  const [now, setNow] = useState(nowMinutes);
  useEffect(() => {
    const t = setInterval(() => setNow(nowMinutes()), 30000);
    return () => clearInterval(t);
  }, []);
  const items = lectures.items;
  const next = items.find((l) => toMinutes(l.start) > now);
  const current = items.find((l) => toMinutes(l.start) <= now && now < toMinutes(l.end));
  return (
    <Card title="My Day" icon={ClipboardCheck} action={<Link to="/employee/attendance" className="btn btn--outline btn--sm">Open attendance</Link>}>
      {lectures.holiday ? <EmptyState compact title="Today is a holiday" hint="No lectures to take. Enjoy the day." />
        : items.length === 0 ? <EmptyState compact title="No lectures today" hint="Lectures on your timetable show here on the day." action={{ label: 'Open attendance', to: '/employee/attendance' }} />
          : (
            <>
              <p className="myday-line" aria-live="polite">
                <Clock size={15} aria-hidden="true" />
                {current ? <><strong>On now: {current.subject}</strong>{next ? `. Next in ${inWords(toMinutes(next.start) - now)}` : '. Last one today'}</>
                  : next ? <>Next: <strong>{next.subject}</strong> in <strong>{inWords(toMinutes(next.start) - now)}</strong></>
                    : 'All of today\'s lectures are over.'}
              </p>
              <ol className="timeline">
                {items.map((l) => {
                  const s = stateOf(l, now);
                  return (
                    <li key={l.slotId} className={`timeline__item ${s.done ? 'is-done' : ''} ${current?.slotId === l.slotId ? 'is-now' : ''}`}>
                      <span className="timeline__time">{fmtTime(l.start)}</span>
                      <div className="timeline__what">
                        <strong>{l.subject}</strong>
                        <small className="muted">{l.course}{l.location ? `, ${l.location}` : ''}{l.reassigned ? ', reassigned to you' : ''}</small>
                        <Badge tone={s.tone}>{s.word}</Badge>
                      </div>
                      {!s.done && <Link className="btn btn--outline timeline__mark" to={`/employee/attendance/${l.slotId}`} aria-label={`Mark attendance for ${l.subject}, ${l.course}`}>Mark</Link>}
                    </li>
                  );
                })}
              </ol>
            </>
          )}
    </Card>
  );
}

function MarksProgress({ papers }) {
  return (
    <Card title="Marks entry" icon={PenLine} action={<Link to="/employee/exams" className="btn btn--outline btn--sm">All papers</Link>}>
      {papers.length === 0 ? <EmptyState compact title="No papers to mark" hint="Papers an exam assigns to you show here." /> : (
        <ul className="setup-bars">
          {papers.map((p) => (
            <li key={p.id}>
              <Link className="setup-bars__name" to={`/employee/exams/${p.id}`}>{p.subject}</Link>
              <span className="progress" role="progressbar" aria-label={`${p.subject} marks entered`} aria-valuemin={0} aria-valuemax={p.roster} aria-valuenow={p.entered}><span className="progress__fill" style={{ width: `${p.roster ? Math.min(100, (p.entered / p.roster) * 100) : 0}%` }} /></span>
              <small>{p.entered} of {p.roster} entered, {p.course}{p.status === 'submitted' ? ', submitted' : ''}</small>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

const LEAVE_TONE = { approved: 'green', pending: 'amber', rejected: 'red', cancelled: 'gray' };

export default function EmployeeDashboard() {
  const { user, office } = useAuth();
  // Office staff with no lectures or exam papers (an accountant, a librarian) do not get the teaching sections
  const teaching = office?.teaching !== false;
  const { data: d, error, loading, reload } = useFetch('/employee/dashboard');
  const todo = useFetch(teaching ? '/employee/todo' : null);
  if (error && !d) return <ErrorState error={error} onRetry={reload} />;
  if (!d) return <KpiLoading />;
  const items = d.lectures?.items || [];
  const toMark = items.filter((l) => l.sessionStatus !== 'submitted').length;
  const pendingPapers = (d.papers || []).filter((p) => p.status !== 'submitted').length;
  const leaveBal = (d.leave?.balances || []).filter((b) => b.allowance !== null);
  const leaveLeft = leaveBal.reduce((a, b) => a + Number(b.left || 0), 0);
  const recent = d.notices?.latest || [];

  return (
    <div className="dash-page">
    <CollapsibleCards>
      <PageBanner icon={LayoutDashboard} title={`${greeting()}, ${firstName(user.name)}`} subtitle={fmtLong(todayISO())} />
      <Freshness at={d.generatedAt} loading={loading} onRefresh={reload} />

      {teaching && d.lectures && <TodayStepBar data={{ ...d.lectures, date: d.today, lectures: items }} />}
      {teaching && d.lectures && <MyDay lectures={d.lectures} />}

      <KpiGrid>
        {teaching && d.lectures && <KpiCard label="Lectures to mark today" value={items.length ? <>{toMark}<small>of {items.length}</small></> : 0} to="/employee/attendance" meaning="Today's lectures with no submitted register yet" sub={items.length ? undefined : 'No lectures today'} />}
        {teaching && d.papers && <KpiCard label="Papers with marks to enter" value={numIn(pendingPapers)} to="/employee/exams" meaning="Your exam papers whose marks are not submitted yet" />}
        {d.needCall && <KpiCard label="Students who need a call" value={numIn(d.needCall.count)} to="/employee/assistants" meaning="From Attendance watch: absent three days in a row, or close to the minimum, in your own class" />}
        {d.approvals && <KpiCard label="Waiting for your decision" value={numIn(d.approvals.count)} to={d.approvals.to} meaning="Requests your role decides" />}
        {d.leave && leaveBal.length > 0 && <KpiCard label="Leave days left" value={numIn(leaveLeft)} to="/employee/leave" meaning="Days left this year across your leave types" sub={leaveBal.map((b) => `${b.name} ${b.left}`).join(', ')} />}
        {d.notices && <KpiCard label="Unread notices" value={numIn(d.notices.unread)} to="/employee/notices" meaning="Notices you have not opened yet" />}
      </KpiGrid>

      <OfficeWorkCard />

      <div className="grid-2">
        {teaching && d.papers && <MarksProgress papers={d.papers} />}
        {d.needCall && (
          <Card title="Students who need a call" icon={PhoneCall} action={<Link to="/employee/assistants" className="btn btn--outline btn--sm">Attendance watch</Link>}>
            {d.needCall.students.length === 0 ? <EmptyState compact title="Nobody right now" hint="Students in your class who miss three days in a row, or fall near the minimum, show here." /> : (
              <ul className="myday__notices">
                {d.needCall.students.map((s) => <li key={s.id}><strong>{s.name}</strong><small className="muted">{s.percent}%{s.threeInARow ? ', absent 3 days in a row' : ''}</small></li>)}
              </ul>
            )}
          </Card>
        )}
        {d.leave && (
          <Card title="My leave" icon={CalendarOff} action={<Link to="/employee/leave" className="btn btn--outline btn--sm">Apply or view</Link>}>
            {leaveBal.length > 0 && <p style={{ margin: '0 0 8px' }}>{leaveBal.map((b) => `${b.name}: ${b.left} left`).join(', ')}</p>}
            {d.leave.requests.length === 0 ? <p className="muted" style={{ margin: 0 }}>No leave requests yet.</p> : (
              <ul className="myday__notices">
                {d.leave.requests.map((r) => <li key={r.id}><span>{r.type}, {fmtDate(r.fromDate)}{r.toDate !== r.fromDate ? ` to ${fmtDate(r.toDate)}` : ''}</span><Badge tone={LEAVE_TONE[r.status] || 'gray'}>{r.status}</Badge></li>)}
              </ul>
            )}
          </Card>
        )}
      </div>

      {teaching && todo.data && <TodoCard data={todo.data} />}

      {!teaching && !office?.roles?.length && (
        <Card title="Your workspace"><p className="muted">Your institute has not switched on any employee modules yet.</p></Card>
      )}

      {recent.length > 0 && (
        <Card title={`Notices${d.notices.unread ? ` (${d.notices.unread} new)` : ''}`} icon={Megaphone} action={<Link to="/employee/notices" className="btn btn--outline btn--sm">All notices</Link>}>
          <ul className="notices">
            {recent.map((n) => (
              <li key={n.id}>
                <div className="notices__head"><strong>{!n.read && <span className="dot-new" role="img" aria-label="New" />}{n.title}</strong>{n.priority === 'important' && <Badge tone="red">Important</Badge>}</div>
                <small className="muted">{fmtDate(n.date)}</small>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </CollapsibleCards>
    </div>
  );
}

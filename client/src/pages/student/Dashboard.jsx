import { Link } from 'react-router-dom';
import { AlertTriangle, Award, BookOpen, CalendarDays, Clock, FileText, GraduationCap, LayoutDashboard, MapPin, Megaphone, Percent, ScanLine, Video, Wallet } from 'lucide-react';
import { useFetch } from '../../hooks/useFetch.js';
import { useTenantConfig } from '../../hooks/useTenantConfig.js';
import { Badge, Card, PageBanner, StatCard, pending } from '../../components/ui/Ui.jsx';
import { DataBoundary, EmptyState } from '../../components/ui/Feedback.jsx';
import { EVENT_TYPES } from '../../utils/eventTypes.js';
import TodoCard from '../../components/campus/TodoCard.jsx';
import { daysBetween, firstName, todayISO, fmtDate, fmtEventDates, fmtRange, fmtTime, greeting, MONTHS, parseISO } from '../../utils/dates.js';
import { inr0, plural } from '../../utils/kpi.js';

const nowHHMM = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

// Red below the minimum, amber when within 5% of it, green otherwise
const attendanceTone = (pct, t = 75) => (pct >= t + 5 ? 'good' : pct >= t ? 'warn' : 'bad');

export default function Dashboard() {
  const { data, loading, error, reload } = useFetch('/student/dashboard');

  return (
    <DataBoundary loading={loading} error={error} data={data} reload={reload}>
      {data && <DashboardView d={data} />}
    </DataBoundary>
  );
}


function DashboardView({ d }) {
  const { hasModule } = useTenantConfig();
  const now = nowHHMM();
  const first = firstName(d.student.name);
  const low = d.attendance.filter((a) => a.pct < d.attendanceThreshold);
  const showFees = hasModule('fees') && d.fees;
  const showResult = hasModule('exams') && d.latestResult;
  const threshold = d.attendanceThreshold ?? 75;
  const g = d.attendanceGuide || { canMiss: 0, needToReach: 0, attended: 0, total: 0 };
  const attOk = d.stats.attendance >= threshold;
  const feeOverdue = d.fees?.next?.dueDate && String(d.fees.next.dueDate).slice(0, 10) < todayISO();
  const examIn = d.nextExam ? Math.max(0, daysBetween(todayISO(), String(d.nextExam.date).slice(0, 10))) : null;
  // The lecture going on now, or the next one today
  const lectures = d.today.filter((i) => i.type === 'lecture');
  const liveNow = lectures.find((i) => i.start <= now && now < i.end);
  const nextClass = liveNow ? { ...liveNow, live: true } : lectures.find((i) => i.start > now) || null;

  return (
    <>
      <PageBanner
        icon={LayoutDashboard}
        title={`${greeting()}, ${first}`}
        subtitle={`${d.student.course}, Semester ${d.student.semester}, Section ${d.student.section}  |  Roll no. ${d.student.rollNo}`}
        actions={hasModule('qr_checkin') && hasModule('attendance') ? <Link to="/student/checkin" className="btn btn--primary btn--sm"><ScanLine size={15} /> Scan attendance</Link> : null}
      />

      <div className="stats stats--3">
        <StatCard
          value={`${d.stats.attendance}%`} label="Overall attendance" icon={Percent} to="/student/attendance"
          status={attOk ? (g.canMiss <= 2 ? 'warn' : 'good') : 'bad'}
          hint={attOk ? (g.canMiss > 0 ? `You can miss ${plural(g.canMiss, 'more class', 'more classes')}` : 'Do not miss the next class') : g.needToReach ? `Attend the next ${plural(g.needToReach, 'class', 'classes')} to reach ${threshold}%` : `Below ${threshold}%`}
          sub={`${g.attended} of ${g.total} classes, minimum ${threshold}%`}
        />
        <StatCard
          value={nextClass ? fmtTime(nextClass.start) : d.today.length ? 'Done' : '-'} icon={Clock} to="/student/timetable"
          label={nextClass ? `${nextClass.live ? 'Now' : 'Next class'}: ${nextClass.title}` : d.today.length ? 'No more classes today' : 'No classes today'}
          status={nextClass?.live ? 'good' : nextClass ? 'info' : 'clear'}
          hint={nextClass ? `${nextClass.reassignedTo || nextClass.employee?.name || ''}${nextClass.location ? `, ${nextClass.location}` : ''}` : undefined}
        />
        {hasModule('assignments') && d.assignmentsDue !== null && (
          <StatCard value={d.assignmentsDue} label="Assignments due this week" icon={FileText} to="/student/assignments" {...pending(d.assignmentsDue, { act: 'Hand them in', clear: 'Nothing due' })} />
        )}
        {showFees && (
          <StatCard
            value={inr0(d.fees.outstanding)} label="Fees due" icon={Wallet} to="/student/fees"
            {...(d.fees.outstanding <= 0 ? { status: 'clear', hint: 'All paid up' } : feeOverdue ? { status: 'bad', hint: `Overdue since ${fmtDate(d.fees.next.dueDate)} - pay now` } : { status: 'warn', hint: d.fees.next?.dueDate ? `Next due ${fmtDate(d.fees.next.dueDate)} - pay now` : 'Pay now' })}
            sub={d.fees.next ? `${d.fees.next.label}: ${inr0(d.fees.next.balance)}` : undefined}
          />
        )}
        {hasModule('exams') && (
          <StatCard
            value={d.nextExam ? fmtDate(d.nextExam.date) : '-'} label={d.nextExam ? `Next exam: ${d.nextExam.name}` : 'No exam scheduled'} icon={GraduationCap} to="/student/calendar"
            {...(examIn === null ? { status: 'clear' } : examIn <= 7 ? { status: 'warn', hint: examIn === 0 ? 'Today' : `In ${plural(examIn, 'day')}` } : { status: 'info', hint: `In ${examIn} days` })}
          />
        )}
        {showResult ? (
          <StatCard
            value={d.latestResult.gpa === null ? `${d.latestResult.pct ?? '-'}%` : `GPA ${d.latestResult.gpa.toFixed(2)}`} label={`Latest result: ${d.latestResult.name}`} icon={Award} to="/student/results"
            status={d.latestResult.result === 'fail' ? 'bad' : 'neutral'} sub={d.latestResult.cgpa !== null && d.latestResult.cgpa !== undefined ? `CGPA ${d.latestResult.cgpa.toFixed(2)}` : undefined}
          />
        ) : (
          <StatCard value={d.stats.notices} label="Unread notices" icon={Megaphone} to="/student/notices" {...(d.stats.notices > 0 ? { status: 'info', hint: 'New' } : { status: 'clear', hint: 'All read' })} />
        )}
      </div>

      <TodoCard path="/student/todo" />

      {low.length > 0 && (
        <div className="alert alert--warn" role="alert">
          <AlertTriangle size={18} />
          <span>
            <strong>Low attendance:</strong> {low.map((a) => `${a.subject} (${a.pct}%)`).join(', ')} {low.length === 1 ? 'is' : 'are'} below the {d.attendanceThreshold}% minimum.{' '}
            {hasModule('attendance') && <Link to="/student/attendance">See details</Link>}
          </span>
        </div>
      )}

      <div className="grid-2">
        <Card title="Today's schedule" icon={Clock}>
          {d.today.length === 0 ? (
            <EmptyState title="No classes today" hint="Enjoy the day off, or check the Calendar for what is next." />
          ) : (
            <ul className="schedule">
              {d.today.map((i) => {
                const live = i.type === 'lecture' && i.start <= now && now < i.end;
                return (
                  <li key={i.id} className={`schedule__item ${live ? 'is-live' : ''}`}>
                    <div className="schedule__time">
                      <strong>{fmtTime(i.start)}</strong>
                      <small>{fmtTime(i.end)}</small>
                    </div>
                    <div className="schedule__body">
                      <div className="schedule__title">
                        {i.title}
                        {live && <Badge tone="green">Now</Badge>}
                        {i.type === 'duty' && <Badge tone="amber">Duty</Badge>}
                        {i.reassignedTo && <Badge tone="purple">Taken by {i.reassignedTo}</Badge>}
                      </div>
                      <div className="schedule__meta">
                        <span>{i.reassignedTo || i.employee.name}</span>
                        <span>{i.mode === 'Online' ? <Video size={12} /> : <MapPin size={12} />} {i.location}</span>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card title="Coming up" icon={CalendarDays}>
          {d.upcomingEvents.length === 0 ? (
            <EmptyState title="Nothing scheduled" hint="New exams, events and deadlines will show up here." />
          ) : (
            <ul className="upcoming">
              {d.upcomingEvents.map((e) => {
                const dt = parseISO(e.start);
                const type = EVENT_TYPES[e.type];
                return (
                  <li key={e.id} className="upcoming__item">
                    <div className={`datebox datebox--${type.tone}`}>
                      <strong>{dt.getDate()}</strong>
                      <small>{MONTHS[dt.getMonth()].slice(0, 3)}</small>
                    </div>
                    <div>
                      <div className="upcoming__title">{e.title} <Badge tone={type.tone}>{type.label}</Badge></div>
                      <div className="upcoming__meta">
                        {fmtEventDates(e.start, e.end)}
                        {e.startTime && `, ${fmtRange(e.startTime, e.endTime)}`}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid-2">
        <Card title="Attendance by subject" icon={Percent}>
          <ul className="bars">
            {d.attendance.map((a) => (
              <li key={a.subject}>
                <div className="bars__row">
                  <span>{a.subject}</span>
                  <span className={`bars__pct bars__pct--${attendanceTone(a.pct, d.attendanceThreshold)}`}>{a.pct}%</span>
                </div>
                <div className="bars__track" role="img" aria-label={`${a.subject}: ${a.attended} of ${a.total} classes attended`}>
                  <div className={`bars__fill bars__fill--${attendanceTone(a.pct, d.attendanceThreshold)}`} style={{ width: `${a.pct}%` }} />
                </div>
                <small className="muted">{a.attended} of {a.total} classes</small>
              </li>
            ))}
          </ul>
          <p className="note">Red: below the {d.attendanceThreshold}% minimum. Amber: within 5% of it.</p>
        </Card>

        <Card title="Notices" icon={Megaphone} action={hasModule('notices') ? <Link to="/student/notices" className="btn btn--outline btn--sm">All notices</Link> : null}>
          <ul className="notices">
            {d.notices.map((n) => (
              <li key={n.id}>
                <div className="notices__head"><strong>{n.read === false && <span className="dot-new" role="img" aria-label="New" />}{n.title}</strong><Badge tone={n.priority === 'important' ? 'red' : 'blue'}>{n.priority === 'important' ? 'Important' : n.category}</Badge></div>
                <p>{n.body}</p>
                <small className="muted">{fmtDate(n.date)}</small>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}

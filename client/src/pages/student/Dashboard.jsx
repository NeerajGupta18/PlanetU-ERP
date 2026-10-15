import { Link } from 'react-router-dom';
import { AlertTriangle, Award, BookOpen, CalendarDays, Clock, LayoutDashboard, MapPin, Megaphone, Percent, Video, Wallet } from 'lucide-react';
import { useFetch } from '../../hooks/useFetch.js';
import { useTenantConfig } from '../../hooks/useTenantConfig.js';
import { Badge, Card, PageBanner, StatCard } from '../../components/ui/Ui.jsx';
import { DataBoundary, EmptyState } from '../../components/ui/Feedback.jsx';
import { EVENT_TYPES } from '../../utils/eventTypes.js';
import { todayISO, fmtDate, fmtEventDates, fmtRange, fmtTime, greeting, MONTHS, parseISO } from '../../utils/dates.js';

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

const inr = (n) => `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function DashboardView({ d }) {
  const { hasModule } = useTenantConfig();
  const now = nowHHMM();
  const first = d.student.name.split(' ')[0];
  const low = d.attendance.filter((a) => a.pct < d.attendanceThreshold);
  const showFees = hasModule('fees') && d.fees;
  const showResult = hasModule('exams') && d.latestResult;

  return (
    <>
      <PageBanner
        icon={LayoutDashboard}
        title={`${greeting()}, ${first}`}
        subtitle={`${d.student.course}, Semester ${d.student.semester}, Section ${d.student.section}  |  Roll no. ${d.student.rollNo}`}
      />

      <div className="stats">
        <StatCard
          value={`${d.stats.attendance}%`} label="Overall attendance" icon={Percent} to="/student/attendance"
          status={d.stats.attendance >= (d.attendanceThreshold ?? 75) ? 'good' : 'bad'}
          hint={d.stats.attendance >= (d.attendanceThreshold ?? 75) ? `Above ${d.attendanceThreshold ?? 75}%` : `Below ${d.attendanceThreshold ?? 75}%`}
        />
        <StatCard value={d.stats.lecturesToday} label="Lectures today" icon={BookOpen} to="/student/timetable" />
        <StatCard value={d.stats.upcomingEvents} label="Events in the next 7 days" icon={CalendarDays} to="/student/calendar" />
        <StatCard value={d.stats.notices} label="Unread notices" icon={Megaphone} to="/student/notices" {...(d.stats.notices > 0 ? { status: 'info', hint: 'New' } : { status: 'clear', hint: 'All read' })} />
      </div>

      {low.length > 0 && (
        <div className="alert alert--warn" role="alert">
          <AlertTriangle size={18} />
          <span>
            <strong>Low attendance:</strong> {low.map((a) => `${a.subject} (${a.pct}%)`).join(', ')} {low.length === 1 ? 'is' : 'are'} below the {d.attendanceThreshold}% minimum.{' '}
            {hasModule('attendance') && <Link to="/student/attendance">See details</Link>}
          </span>
        </div>
      )}

      {(showFees || showResult) && (
        <div className="grid-2">
          {showFees && (
            <Card title="Fees" icon={Wallet} action={d.fees.outstanding > 0 && <Link to="/student/fees" className="btn btn--primary btn--sm">Pay now</Link>}>
              {d.fees.outstanding > 0 ? (
                <>
                  <div className={`bigfigure ${d.fees.next?.dueDate && String(d.fees.next.dueDate).slice(0, 10) < todayISO() ? 'bigfigure--bad' : 'bigfigure--warn'}`}>{inr(d.fees.outstanding)}</div>
                  <p className="muted">
                    {d.fees.next?.dueDate && String(d.fees.next.dueDate).slice(0, 10) < todayISO() ? <strong style={{ color: 'var(--danger)' }}>Overdue: </strong> : 'Outstanding'}
                    {d.fees.next?.dueDate ? ` - next due ${fmtDate(d.fees.next.dueDate)} (${d.fees.next.label})` : ''}
                  </p>
                </>
              ) : (
                <EmptyState title="No fees due" hint="You are all paid up." />
              )}
            </Card>
          )}
          {showResult && (
            <Card title="Latest result" icon={Award} action={<Link to="/student/results" className="btn btn--outline btn--sm">All results</Link>}>
              <div className="bigfigure">{d.latestResult.gpa === null ? '-' : `GPA ${d.latestResult.gpa.toFixed(2)}`}</div>
              <p className="muted">{d.latestResult.name}, semester {d.latestResult.semester}{d.latestResult.cgpa !== null ? ` - CGPA ${d.latestResult.cgpa.toFixed(2)}` : ''}</p>
            </Card>
          )}
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
                <div className="notices__head"><strong>{n.read === false && <span className="dot-new" aria-label="New" />}{n.title}</strong><Badge tone={n.priority === 'important' ? 'red' : 'blue'}>{n.priority === 'important' ? 'Important' : n.category}</Badge></div>
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

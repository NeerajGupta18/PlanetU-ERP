import { BookOpen, CalendarDays, Clock, LayoutDashboard, MapPin, Megaphone, Percent, Video } from 'lucide-react';
import { useFetch } from '../../hooks/useFetch.js';
import { Badge, Card, PageBanner, StatCard } from '../../components/ui/Ui.jsx';
import { DataBoundary, EmptyState } from '../../components/ui/Feedback.jsx';
import { EVENT_TYPES } from '../../utils/eventTypes.js';
import { fmtDate, fmtEventDates, fmtRange, fmtTime, greeting, MONTHS, parseISO } from '../../utils/dates.js';

const nowHHMM = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

const attendanceTone = (pct) => (pct >= 85 ? 'good' : pct >= 75 ? 'warn' : 'bad');

export default function Dashboard() {
  const { data, loading, error, reload } = useFetch('/student/dashboard');

  return (
    <DataBoundary loading={loading} error={error} data={data} reload={reload}>
      {data && <DashboardView d={data} />}
    </DataBoundary>
  );
}

function DashboardView({ d }) {
  const now = nowHHMM();
  const first = d.student.name.split(' ')[0];

  return (
    <>
      <PageBanner
        icon={LayoutDashboard}
        title={`${greeting()}, ${first}`}
        subtitle={`${d.student.course}, Semester ${d.student.semester}, Section ${d.student.section}  |  Roll no. ${d.student.rollNo}`}
      />

      <div className="stats">
        <StatCard value={`${d.stats.attendance}%`} label="Overall attendance" icon={Percent} tone="indigo" />
        <StatCard value={d.stats.lecturesToday} label="Lectures today" icon={BookOpen} tone="green" />
        <StatCard value={d.stats.upcomingEvents} label="Events in the next 7 days" icon={CalendarDays} tone="amber" />
        <StatCard value={d.stats.notices} label="Notices" icon={Megaphone} tone="rose" />
      </div>

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
                  <span className={`bars__pct bars__pct--${attendanceTone(a.pct)}`}>{a.pct}%</span>
                </div>
                <div className="bars__track" role="img" aria-label={`${a.subject}: ${a.attended} of ${a.total} classes attended`}>
                  <div className={`bars__fill bars__fill--${attendanceTone(a.pct)}`} style={{ width: `${a.pct}%` }} />
                </div>
                <small className="muted">{a.attended} of {a.total} classes</small>
              </li>
            ))}
          </ul>
          <p className="note">Subjects below 75% are shown in red.</p>
        </Card>

        <Card title="Notices" icon={Megaphone}>
          <ul className="notices">
            {d.notices.map((n) => (
              <li key={n.id}>
                <div className="notices__head"><strong>{n.title}</strong><Badge tone="blue">{n.category}</Badge></div>
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

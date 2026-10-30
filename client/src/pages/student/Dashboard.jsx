import { Link } from 'react-router-dom';
import { AlertTriangle, Award, CalendarDays, Clock, FileText, LayoutDashboard, MapPin, Megaphone, Percent, ScanLine, Video } from 'lucide-react';
import { useFetch } from '../../hooks/useFetch.js';
import { useTenantConfig } from '../../hooks/useTenantConfig.js';
import { Badge, Card, PageBanner, CollapsibleCards } from '../../components/ui/Ui.jsx';
import { EmptyState, ErrorState } from '../../components/ui/Feedback.jsx';
import { LineChart } from '../../components/ui/Charts.jsx';
import { Ring } from '../../components/dash/Charts.jsx';
import { Freshness, KpiCard, KpiGrid, KpiLoading } from '../../components/dash/KpiCard.jsx';
import WhatIfMeter from '../../components/dash/WhatIfMeter.jsx';
import { EVENT_TYPES } from '../../utils/eventTypes.js';
import TodoCard from '../../components/campus/TodoCard.jsx';
import { daysBetween, firstName, todayISO, fmtDate, fmtEventDates, fmtRange, fmtTime, greeting, MONTHS, parseISO } from '../../utils/dates.js';
import { inr0, inrCompact, numIn, plural } from '../../utils/kpi.js';

const nowHHMM = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

// Red below the minimum, amber when within 5% of it, green otherwise
const attendanceTone = (pct, t = 75) => (pct >= t + 5 ? 'good' : pct >= t ? 'warn' : 'bad');

export default function Dashboard() {
  const { data, loading, error, reload } = useFetch('/student/dashboard');
  if (error && !data) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <KpiLoading />;
  return <div className="dash-page"><DashboardView d={data} loading={loading} reload={reload} /></div>;
}


function DashboardView({ d, loading, reload }) {
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
    <CollapsibleCards>
      <PageBanner
        icon={LayoutDashboard}
        title={`${greeting()}, ${first}`}
        subtitle={`${d.student.course}, Semester ${d.student.semester}, Section ${d.student.section}  |  Roll no. ${d.student.rollNo}`}
        next={showFees && d.fees.outstanding > 0
          ? { text: `${feeOverdue ? 'Overdue: pay' : 'Pay'} ${inr0(d.fees.outstanding)} in fees`, to: '/student/fees' }
          : !attOk && g.needToReach ? { text: `Attend the next ${plural(g.needToReach, 'class', 'classes')} to reach ${threshold}%`, to: '/student/attendance' }
          : d.stats.notices > 0 ? { text: `Read ${plural(d.stats.notices, 'new notice')}`, to: '/student/notices' } : undefined}
        actions={hasModule('qr_checkin') && hasModule('attendance') ? <Link to="/student/checkin" className="btn btn--primary btn--sm"><ScanLine size={15} /> Scan attendance</Link> : null}
      />

      <Freshness at={d.generatedAt} loading={loading} onRefresh={reload} />

      <KpiGrid>
        <KpiCard
          value={nextClass ? fmtTime(nextClass.start) : d.today.length ? 'Done' : 'None'} to="/student/timetable" meaning="The lecture going on now, or your next one today"
          label={nextClass ? `${nextClass.live ? 'Now' : 'Next class'}: ${nextClass.title}` : d.today.length ? 'No more classes today' : 'No classes today'}
          sub={nextClass ? `${nextClass.reassignedTo || nextClass.employee?.name || ''}${nextClass.location ? `, ${nextClass.location}` : ''}` : undefined}
        />
        {hasModule('exams') && (
          <KpiCard
            value={examIn === null ? null : examIn === 0 ? 'Today' : plural(examIn, 'day')} to="/student/calendar" meaning="Days until your next exam" emptyHint="No exam scheduled yet."
            label={d.nextExam ? `Until ${d.nextExam.name}` : 'Next exam'} sub={d.nextExam ? fmtDate(d.nextExam.date) : undefined}
          />
        )}
        {showFees && (
          <KpiCard
            value={inrCompact(d.fees.outstanding)} full={inr0(d.fees.outstanding)} label={feeOverdue ? 'Fees overdue' : 'Fees due'} to="/student/fees" meaning="Fees still to pay"
            sub={`${inr0(d.fees.paid)} paid so far${d.fees.next ? `. ${d.fees.next.label}: ${inr0(d.fees.next.balance)}` : ''}`}
          />
        )}
        {showResult && (
          <KpiCard
            value={d.latestResult.gpa === null ? `${d.latestResult.pct ?? '-'}%` : `GPA ${d.latestResult.gpa.toFixed(2)}`} label={`Latest result: ${d.latestResult.name}`} to="/student/results" meaning="Your most recently published exam"
            spark={d.latestResult.trend.map((t) => t.pct)} sparkLabel="Your percentage in each published exam, oldest first"
            sub={d.latestResult.cgpa !== null && d.latestResult.cgpa !== undefined ? `CGPA ${d.latestResult.cgpa.toFixed(2)}` : undefined}
          />
        )}
        {hasModule('assignments') && d.assignmentsDue !== null && <KpiCard value={numIn(d.assignmentsDue)} label="Coursework due this week" to="/student/assignments" meaning="Work still to hand in within the next 7 days" />}
        {hasModule('notices') && <KpiCard value={numIn(d.stats.notices)} label="Unread notices" to="/student/notices" meaning="Notices you have not opened yet" />}
      </KpiGrid>

      <div className="grid-2">
        <Card title="Attendance" icon={Percent} action={hasModule('attendance') ? <Link to="/student/attendance" className="btn btn--outline btn--sm">Details</Link> : null}>
          <div className="myday__ring">
            <Ring value={g.total ? d.stats.attendance : null} label="Overall attendance" text={`${d.stats.attendance}%`} size={88} />
            <div>
              <strong className={attOk ? '' : 'is-bad'}>{attOk ? 'Above' : 'Below'} the {threshold}% minimum</strong>
              <p className="myday__hint" style={{ margin: '2px 0 0' }}>
                {g.attended} of {g.total} classes. {attOk ? (g.canMiss > 0 ? `You can miss ${plural(g.canMiss, 'more class', 'more classes')}.` : 'Do not miss the next class.') : g.needToReach ? `Attend the next ${plural(g.needToReach, 'class', 'classes')} to reach ${threshold}%.` : ''}
              </p>
            </div>
          </div>
          <ul className="bars" style={{ marginTop: 12 }}>
            {d.attendance.map((a) => (
              <li key={a.subject}>
                <div className="bars__row">
                  <span>{a.subject}</span>
                  <span className={`bars__pct bars__pct--${attendanceTone(a.pct, d.attendanceThreshold)}`}>{a.pct}%</span>
                </div>
                <div className="bars__track" role="img" aria-label={`${a.subject}: ${a.attended} of ${a.total} classes attended`}>
                  <div className={`bars__fill bars__fill--${attendanceTone(a.pct, d.attendanceThreshold)}`} style={{ width: `${a.pct}%` }} />
                </div>
              </li>
            ))}
          </ul>
          <p className="note">Red: below the {d.attendanceThreshold}% minimum. Amber: within 5% of it.</p>
          <WhatIfMeter attended={g.attended} total={g.total} threshold={threshold} you />
        </Card>
        <div style={{ display: 'grid', gap: 18 }}>
          {showResult && (
            <Card title="Marks trend" icon={Award} action={<Link to="/student/results" className="btn btn--outline btn--sm">All results</Link>}>
              {d.latestResult.trend.length < 2
                ? <p className="muted" style={{ margin: 0, fontSize: 13 }}>The trend appears after your next published exam.</p>
                : <LineChart data={d.latestResult.trend.map((t, i) => ({ label: `Exam ${i + 1}`, full: t.name, value: t.pct }))} format={(v) => `${v}%`} min={0} max={100} caption="Your percentage in each published exam, oldest first" height={140} />}
            </Card>
          )}
          {hasModule('assignments') && d.coursework && (
            <Card title="Coursework due" icon={FileText} action={<Link to="/student/assignments" className="btn btn--outline btn--sm">All work</Link>}>
              {d.coursework.length === 0 ? <EmptyState compact title="Nothing due this week" hint="Work your teachers set shows here." /> : (
                <ul className="myday__notices">
                  {d.coursework.map((c) => <li key={c.id}><Link to={`/student/assignments/${c.id}`}><strong>{c.title}</strong></Link><small className="muted">{c.subject}, due {fmtDate(String(c.dueAt).slice(0, 10))}</small></li>)}
                </ul>
              )}
            </Card>
          )}
        </div>
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

      <div>
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
    </CollapsibleCards>
  );
}

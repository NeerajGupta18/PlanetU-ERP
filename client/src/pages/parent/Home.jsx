import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Award, CalendarCheck, Clock, FileText, MapPin, Megaphone, Sun, Video, Wallet } from 'lucide-react';
import { useFetch } from '../../hooks/useFetch.js';
import { useTenantConfig } from '../../hooks/useTenantConfig.js';
import { api } from '../../api/http.js';
import { Badge, Card, PageHeader } from '../../components/ui/Ui.jsx';
import { DataBoundary, EmptyState } from '../../components/ui/Feedback.jsx';
import PayOnlineModal from '../../components/fees/PayOnlineModal.jsx';
import { firstName, fmtDate, fmtTime } from '../../utils/dates.js';
import { inr0, plural } from '../../utils/kpi.js';

// A class's mark, in words and a colour (the word is always shown, never only the colour)
const MARK = {
  present: { tone: 'green', label: 'Present' },
  late: { tone: 'amber', label: 'Late' },
  absent: { tone: 'red', label: 'Absent' },
  now: { tone: 'blue', label: 'In class now' },
  upcoming: { tone: 'gray', label: 'Later today' },
  not_marked: { tone: 'gray', label: 'Not marked yet' },
};

/** One line about today: present in every class so far, missed some, or nothing marked yet. */
function todayLine(t) {
  if (!t.marked) return `${plural(t.classes.length, 'class', 'classes')} today, none marked yet`;
  if (!t.absent) return `Present in ${t.marked === 1 ? 'the 1 class' : `all ${t.marked} classes`} marked so far${t.late ? `, late ${t.late === 1 ? 'once' : `${t.late} times`}` : ''}`;
  return `Absent in ${t.absent} of ${plural(t.marked, 'class', 'classes')} marked today`;
}

export default function ParentHome() {
  const kids = useFetch('/parent/children');
  const day = useFetch('/student/my-day');
  const [switching, setSwitching] = useState(false);

  const pick = async (id) => {
    setSwitching(true);
    // Reload, as the top bar's child picker does, so it and every page show the same child
    try { await api.post('/parent/child', { childId: id }); window.location.reload(); } catch { setSwitching(false); }
  };

  return (
    <DataBoundary loading={kids.loading && !kids.data} error={kids.error} data={kids.data} reload={kids.reload}>
      {kids.data && (kids.data.children.length === 0 ? (
        <>
          <PageHeader icon={Sun} title="My child today" subtitle="Attendance, fees, results and notices for your child" />
          <EmptyState title="No child linked to this account yet" hint="Ask the institute office to link your child to your email. You will then see their day here." />
        </>
      ) : (
        <DataBoundary loading={day.loading && !day.data} error={day.error} data={day.data} reload={day.reload}>
          {day.data && (
            <MyChildToday d={day.data} kids={kids.data.children} selected={kids.data.selected} onPick={pick} busy={switching || day.loading} reload={day.reload} />
          )}
        </DataBoundary>
      ))}
    </DataBoundary>
  );
}

function MyChildToday({ d, kids, selected, onPick, busy, reload }) {
  const { hasModule } = useTenantConfig();
  const [paying, setPaying] = useState(null);
  const name = firstName(d.student.name);
  const fees = hasModule('fees') ? d.fees : null;
  const owes = fees?.outstanding > 0;
  const payAll = () => setPaying({ label: 'All fees due', due: fees.outstanding });

  // The step bar's button is this screen's one primary action
  const next = d.next.action === 'pay'
    ? (fees?.payOnline
      ? { hint: d.next.hint, label: d.next.label, onClick: payAll }
      : { hint: `${d.next.hint}. Pay at the fee counter`, label: 'See fees to pay', to: '/student/fees' })
    : { hint: d.next.hint, label: d.next.label, to: d.next.to };

  return (
    <>
      {kids.length > 1 && (
        <div className="kid-switch" role="group" aria-label="Choose a child">
          {kids.map((k) => (
            <button key={k.id} type="button" className={`kid-switch__item ${k.id === selected ? 'is-active' : ''}`} aria-pressed={k.id === selected} disabled={busy} onClick={() => k.id !== selected && onPick(k.id)}>
              {firstName(k.name)}
            </button>
          ))}
        </div>
      )}

      <PageHeader
        icon={Sun}
        title={`${name} today`}
        subtitle={`${d.student.course || ''}${d.student.semester ? `, Sem ${d.student.semester}` : ''}${d.student.section ? ` / ${d.student.section}` : ''}  |  ${d.student.studentCode}`}
        steps={{ process: 'family', current: d.next.step, done: ['invite', 'signin', ...(d.next.step === 'today' ? [] : ['today'])], next }}
      />

      <div className="myday">
        <Card title="Today's classes" icon={Clock} action={hasModule('timetable') ? <Link to="/student/timetable" className="btn btn--outline btn--sm">Timetable</Link> : null}>
          {d.today.classes.length === 0 ? (
            <EmptyState compact title="No classes today" hint="Holidays and weekends show nothing here. The timetable shows the coming days." />
          ) : (
            <>
            <p className={`myday__line ${d.today.absent ? 'is-bad' : d.today.marked ? 'is-good' : ''}`}>{todayLine(d.today)}</p>
            <ul className="myday__classes">
              {d.today.classes.map((c) => (
                <li key={c.id}>
                  <span className="myday__time">{fmtTime(c.start)}</span>
                  <span className="myday__what">
                    <strong>{c.subject}</strong>
                    <small className="muted">{c.teacher}{c.location ? <> {c.mode === 'Online' ? <Video size={11} aria-hidden="true" /> : <MapPin size={11} aria-hidden="true" />} {c.location}</> : null}</small>
                  </span>
                  <Badge tone={MARK[c.status].tone}>{MARK[c.status].label}</Badge>
                </li>
              ))}
            </ul>
            </>
          )}
        </Card>

        {fees && (
          <Card title="Fees" icon={Wallet} action={<Link to="/student/fees" className="btn btn--outline btn--sm">All fees</Link>}>
            {owes ? (
              <div className="myday__fee">
                <strong className={`myday__big ${fees.next?.overdue ? 'is-bad' : ''}`}>{inr0(fees.outstanding)}</strong>
                <span className="muted">to pay{fees.next?.dueDate ? `. ${fees.next.label}: ${fees.next.overdue ? 'overdue since' : 'due'} ${fmtDate(fees.next.dueDate)}` : ''}</span>
                {!fees.payOnline && <p className="note" style={{ margin: '6px 0 0' }}>Pay at the institute's fee counter (cash, UPI, card or cheque). The receipt then shows here.</p>}
              </div>
            ) : (
              <p className="myday__line is-good">All fees paid. Thank you.</p>
            )}
            {fees.lastPayment && (
              <p className="myday__receipt">
                <span className="muted">Last paid {inr0(fees.lastPayment.amount)} on {fmtDate(String(fees.lastPayment.paidAt).slice(0, 10))}</span>
                <a className="btn btn--outline btn--sm" href={`/api/student/fees/payments/${fees.lastPayment.id}/receipt.pdf`} target="_blank" rel="noreferrer"><FileText size={13} aria-hidden="true" /> Receipt</a>
              </p>
            )}
          </Card>
        )}

        {d.attendance && (
          <Card title="Attendance" icon={CalendarCheck} action={<Link to="/student/attendance" className="btn btn--outline btn--sm">By subject</Link>}>
            <strong className={`myday__big ${d.attendance.overall < d.attendance.threshold ? 'is-bad' : ''}`}>{d.attendance.overall}%</strong>
            <span className="muted"> overall, minimum {d.attendance.threshold}%</span>
            <p className="myday__hint">
              {d.attendance.overall >= d.attendance.threshold
                ? (d.attendance.canMiss > 0 ? `${name} can miss ${plural(d.attendance.canMiss, 'more class', 'more classes')} and stay above the minimum.` : `${name} should not miss the next class.`)
                : d.attendance.needToReach ? `${name} needs to attend the next ${plural(d.attendance.needToReach, 'class', 'classes')} to reach ${d.attendance.threshold}%.` : `Below the ${d.attendance.threshold}% minimum. Please speak to the class teacher.`}
            </p>
          </Card>
        )}

        {hasModule('exams') && (
          <Card title="Results" icon={Award} action={d.latestResult ? <Link to="/student/results" className="btn btn--outline btn--sm">All results</Link> : null}>
            {d.latestResult ? (
              <>
                <strong className={`myday__big ${d.latestResult.result === 'fail' ? 'is-bad' : ''}`}>
                  {d.latestResult.gpa !== null && d.latestResult.gpa !== undefined ? `GPA ${d.latestResult.gpa.toFixed(2)}` : `${d.latestResult.pct ?? '-'}%`}
                </strong>
                <span className="muted"> {d.latestResult.name}</span>
              </>
            ) : (
              <EmptyState compact title="No results yet" hint="Results show here as soon as the institute publishes them." />
            )}
          </Card>
        )}

        {d.notices && (
          <Card title="Notices" icon={Megaphone} action={<Link to="/student/notices" className="btn btn--outline btn--sm">All notices</Link>}>
            {d.notices.latest.length === 0 ? (
              <EmptyState compact title="No notices" hint="Notices from the institute show here." />
            ) : (
              <ul className="myday__notices">
                {d.notices.latest.map((n) => (
                  <li key={n.id}>
                    <Link to="/student/notices">
                      {!n.read && <span className="dot-new" role="img" aria-label="New" />}
                      <strong>{n.title}</strong>
                      {n.priority === 'important' && <Badge tone="red">Important</Badge>}
                    </Link>
                    <small className="muted">{fmtDate(n.date)}</small>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
      </div>

      {paying && <PayOnlineModal scope={paying} onClose={() => setPaying(null)} onDone={() => { setPaying(null); reload(); }} />}
    </>
  );
}

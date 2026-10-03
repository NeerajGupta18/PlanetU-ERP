import { CalendarCheck, Clock, Percent } from 'lucide-react';
import { useFetch } from '../../hooks/useFetch.js';
import { Badge, Card, PageBanner, StatCard } from '../../components/ui/Ui.jsx';
import { DataBoundary, EmptyState } from '../../components/ui/Feedback.jsx';
import { fmtDay, fmtRange } from '../../utils/dates.js';

const toneFor = (pct, t) => (pct >= t + 10 ? 'good' : pct >= t ? 'warn' : 'bad');
const STATUS = { present: ['green', 'Present'], late: ['amber', 'Late'], absent: ['red', 'Absent'] };

export default function Attendance() {
  const { data, loading, error, reload } = useFetch('/student/attendance');
  return (
    <>
      <PageBanner icon={CalendarCheck} title="My attendance" subtitle="Subject by subject, from your faculty's submitted registers" />
      <DataBoundary loading={loading} error={error} data={data} reload={reload}>
        {data && <View d={data} />}
      </DataBoundary>
    </>
  );
}

function View({ d }) {
  const low = d.subjects.filter((s) => s.pct < d.threshold);
  return (
    <>
      <div className="stats">
        <StatCard value={`${d.overall}%`} label="Overall attendance" icon={Percent} tone={d.overall >= d.threshold ? 'green' : 'rose'} />
        <StatCard value={`${d.attended} / ${d.total}`} label="Classes attended" icon={CalendarCheck} tone="indigo" />
        <StatCard value={low.length} label={`Subjects below ${d.threshold}%`} icon={Clock} tone={low.length ? 'amber' : 'green'} />
      </div>

      <div className="grid-2">
        <Card title="By subject" icon={Percent}>
          {d.subjects.length === 0 ? <EmptyState title="No attendance yet" hint="It appears here once a faculty member submits a register." /> : (
            <ul className="bars">
              {d.subjects.map((a) => (
                <li key={a.subject}>
                  <div className="bars__row">
                    <span>{a.subject}</span>
                    <span className={`bars__pct bars__pct--${toneFor(a.pct, d.threshold)}`}>{a.pct}%</span>
                  </div>
                  <div className="bars__track" role="img" aria-label={`${a.subject}: ${a.attended} of ${a.total} classes attended`}>
                    <div className={`bars__fill bars__fill--${toneFor(a.pct, d.threshold)}`} style={{ width: `${a.pct}%` }} />
                  </div>
                  <small className="muted">
                    {a.attended} of {a.total} classes
                    {a.pct < d.threshold && a.needToReach > 0 && ` · attend the next ${a.needToReach} to reach ${d.threshold}%`}
                    {a.pct >= d.threshold && a.canMiss > 0 && ` · you can miss ${a.canMiss} and stay above ${d.threshold}%`}
                  </small>
                </li>
              ))}
            </ul>
          )}
          {!d.live && d.subjects.length > 0 && (
            <p className="note">These are the figures on file from before online marking began. They will be replaced as faculty submit registers.</p>
          )}
        </Card>

        <Card title="Recent classes" icon={Clock}>
          {d.recent.length === 0 ? <EmptyState title="Nothing marked yet" /> : (
            <div className="table-wrap">
              <table className="table">
                <tbody>
                  {d.recent.map((r, i) => (
                    <tr key={`${r.date}${r.start}${i}`}>
                      <td>{fmtDay(r.date)}<br /><small className="muted">{fmtRange(r.start, r.end)}</small></td>
                      <td>{r.subject}</td>
                      <td><Badge tone={STATUS[r.status][0]}>{STATUS[r.status][1]}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}

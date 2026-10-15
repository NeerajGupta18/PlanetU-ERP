import { AlertCircle, CheckCircle2, Clock, Users } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { useFetch } from '../../hooks/useFetch.js';
import { useTenantConfig } from '../../hooks/useTenantConfig.js';
import { api } from '../../api/http.js';
import { Badge, PageBanner } from '../../components/ui/Ui.jsx';
import { DataBoundary, EmptyState } from '../../components/ui/Feedback.jsx';
import { daysBetween, fmtDate, fmtEventDates, todayISO } from '../../utils/dates.js';
import { inr0, plural } from '../../utils/kpi.js';

/** Today, in one line: present in every class so far, missed some, or nothing marked yet. */
function Today({ t }) {
  if (!t) return <span className="child-card__today child-card__today--neutral"><Clock size={14} aria-hidden="true" /> Not marked yet today</span>;
  if (t.absent === 0) return <span className="child-card__today child-card__today--good"><CheckCircle2 size={14} aria-hidden="true" /> Present today{t.late ? ` (late ${t.late === 1 ? 'once' : `${t.late} times`})` : ''}</span>;
  return <span className="child-card__today child-card__today--bad"><AlertCircle size={14} aria-hidden="true" /> Absent in {t.absent} of {plural(t.marked, 'class', 'classes')} today</span>;
}

export default function ParentHome() {
  const { user } = useAuth();
  const { hasModule } = useTenantConfig();
  const { data, loading, error, reload } = useFetch('/parent/children');

  const open = async (id, to) => {
    await api.post('/parent/child', { childId: id });
    window.location.assign(to);
  };

  return (
    <>
      <PageBanner icon={Users} title={`Welcome, ${user.name}`} subtitle="Your children's day, attendance, results and fees in one place" />
      <DataBoundary loading={loading} error={error} data={data} reload={reload}>
        {data && (data.children.length === 0 ? (
          <EmptyState title="No children linked" hint="Please contact the institute office to link your child to this account." />
        ) : (
          <div className="child-cards">
            {data.children.map((k) => {
              const low = k.attendance && k.attendance.overall < k.attendance.threshold;
              const examIn = k.nextExam ? daysBetween(todayISO(), k.nextExam.start) : null;
              return (
                <div key={k.id} className={`child-card ${k.id === data.selected ? 'is-selected' : ''}`}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
                    <div>
                      <h3>{k.name}</h3>
                      <div className="muted">{k.course} - Sem {k.semester}{k.section ? ` / ${k.section}` : ''} - {k.studentCode}</div>
                    </div>
                    <Badge tone="blue">{k.relation}</Badge>
                  </div>
                  {hasModule('attendance') && <div style={{ marginTop: 10 }}><Today t={k.today} /></div>}
                  <dl className="child-card__rows">
                    {k.attendance && (
                      <div><dt>Attendance</dt><dd className={low ? 'is-bad' : undefined}>{k.attendance.overall}%{low ? ` - below ${k.attendance.threshold}%` : ''}</dd></div>
                    )}
                    {k.outstanding != null && (
                      <div>
                        <dt>Fees due</dt>
                        <dd className={k.nextDue?.overdue ? 'is-bad' : undefined}>
                          {k.outstanding > 0 ? inr0(k.outstanding) : 'All paid'}
                          {k.nextDue?.dueDate && <div className="muted" style={{ fontWeight: 500, fontSize: 12 }}>{k.nextDue.overdue ? 'Overdue since' : 'Next due'} {fmtDate(k.nextDue.dueDate)}</div>}
                        </dd>
                      </div>
                    )}
                    {k.latestResult && (
                      <div><dt>Latest result</dt><dd>{k.latestResult.gpa !== null && k.latestResult.gpa !== undefined ? `GPA ${k.latestResult.gpa.toFixed(2)}` : `${k.latestResult.pct}%`}<div className="muted" style={{ fontWeight: 500, fontSize: 12 }}>{k.latestResult.name}</div></dd></div>
                    )}
                    {k.nextExam && (
                      <div><dt>Next exam</dt><dd>{k.nextExam.title}<div className="muted" style={{ fontWeight: 500, fontSize: 12 }}>{fmtEventDates(k.nextExam.start, k.nextExam.end)}{examIn !== null && examIn >= 0 ? ` - in ${plural(examIn, 'day')}` : ''}</div></dd></div>
                    )}
                  </dl>
                  <div className="child-card__links">
                    {hasModule('fees') && k.outstanding > 0 && <button type="button" className="btn btn--primary btn--sm" onClick={() => open(k.id, '/student/fees')}>Pay {inr0(k.outstanding)}</button>}
                    {hasModule('attendance') && <button type="button" className="btn btn--outline btn--sm" onClick={() => open(k.id, '/student/attendance')}>Attendance</button>}
                    {hasModule('exams') && <button type="button" className="btn btn--outline btn--sm" onClick={() => open(k.id, '/student/results')}>Results</button>}
                    {hasModule('fees') && !(k.outstanding > 0) && <button type="button" className="btn btn--outline btn--sm" onClick={() => open(k.id, '/student/fees')}>Fees</button>}
                    <button type="button" className="btn btn--outline btn--sm" onClick={() => open(k.id, '/student/profile')}>Profile</button>
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </DataBoundary>
    </>
  );
}

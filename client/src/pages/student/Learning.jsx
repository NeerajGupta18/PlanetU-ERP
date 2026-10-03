import { Link } from 'react-router-dom';
import { Award, BookOpenCheck, CalendarClock, Clock, ExternalLink, GraduationCap } from 'lucide-react';
import { useFetch } from '../../hooks/useFetch.js';
import { Badge, Card, PageBanner, StatCard } from '../../components/ui/Ui.jsx';
import { DataBoundary, EmptyState } from '../../components/ui/Feedback.jsx';
import { fmtDate } from '../../utils/dates.js';
import { ENROLL_STATUS, PROVIDER_TONE, cr } from '../../utils/learning.js';

export default function Learning() {
  const { data, loading, error, reload } = useFetch('/student/learning');
  return (
    <>
      <PageBanner icon={BookOpenCheck} title="Learning" subtitle="Online courses assigned to you for credits" />
      <DataBoundary loading={loading} error={error} data={data} reload={reload}>
        {data && (data.items.length === 0 ? (
          <Card><EmptyState title="No courses assigned yet" hint="When your teachers assign an online course for credits, it appears here with its due date." /></Card>
        ) : <View d={data} />)}
      </DataBoundary>
    </>
  );
}

function View({ d }) {
  const { summary: s, items } = d;
  const pct = s.required ? Math.min(100, Math.round((s.earned / s.required) * 100)) : 0;
  return (
    <>
      <div className="stats">
        <StatCard value={`${cr(s.earned)} / ${cr(s.required)}`} label="Compulsory credits earned" icon={Award} tone="indigo" />
        <StatCard value={s.completed} label={`Courses completed of ${s.total}`} icon={GraduationCap} tone="green" />
        <StatCard value={s.pendingReview} label="Awaiting review" icon={Clock} tone="amber" />
        <StatCard value={s.overdue} label="Overdue" icon={CalendarClock} tone={s.overdue ? 'rose' : 'green'} />
      </div>
      {s.required > 0 && (
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <strong>Your compulsory credits</strong><span className="muted">{pct}% of {cr(s.required)} credits{s.bonus > 0 ? ` · plus ${cr(s.bonus)} bonus` : ''}</span>
          </div>
          <div className="bars__track" role="img" aria-label={`${cr(s.earned)} of ${cr(s.required)} compulsory credits earned`}><div className={`bars__fill bars__fill--${pct >= 100 ? 'good' : 'warn'}`} style={{ width: `${pct}%` }} /></div>
        </Card>
      )}
      <div className="grid-2" style={{ alignItems: 'stretch' }}>
        {items.map((i) => {
          const st = ENROLL_STATUS[i.status];
          return (
            <Card key={i.id} title={i.title} action={<Badge tone={st.tone}>{st.label}</Badge>}>
              <div className="badges" style={{ marginBottom: 8 }}>
                <Badge tone={PROVIDER_TONE[i.provider]}>{i.provider}</Badge>
                <Badge tone="blue">{i.subject}</Badge>
                <Badge tone={i.mandatory ? 'purple' : 'gray'}>{i.mandatory ? 'Compulsory' : 'Optional'} · {cr(i.credits)} credit{i.credits === 1 ? '' : 's'}</Badge>
                {i.dueDate && <Badge tone={i.overdue ? 'red' : 'gray'}>{i.overdue ? 'Overdue: ' : 'Due '}{fmtDate(i.dueDate)}</Badge>}
              </div>
              <p className="muted" style={{ margin: '0 0 10px', fontSize: 13.5, minHeight: 38 }}>{i.description || 'No description.'}</p>
              {i.completion === 'lessons' && (
                <>
                  <div className="bars__track"><div className={`bars__fill bars__fill--${i.progress === 100 ? 'good' : 'warn'}`} style={{ width: `${i.progress}%` }} /></div>
                  <small className="muted">{i.done} of {i.lessons} lessons</small>
                </>
              )}
              {i.status === 'rejected' && <p className="form-error" style={{ marginTop: 8 }}>{i.reviewNote || 'Please resubmit your certificate.'}</p>}
              <div className="form-actions" style={{ justifyContent: 'flex-start', marginTop: 12 }}>
                <Link to={`/student/learning/${i.id}`} className="btn btn--primary btn--sm">{i.status === 'completed' ? 'View' : i.status === 'assigned' ? 'Start' : i.status === 'submitted' ? 'View submission' : 'Continue'}</Link>
                {i.completion === 'evidence' && i.url && <a className="btn btn--outline btn--sm" href={i.url} target="_blank" rel="noreferrer noopener"><ExternalLink size={13} /> Open course</a>}
              </div>
            </Card>
          );
        })}
      </div>
    </>
  );
}

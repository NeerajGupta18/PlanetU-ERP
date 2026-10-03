import { useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, BookOpenCheck, CheckCircle2, Circle, ExternalLink, FileText, Link2, PlayCircle, Upload } from 'lucide-react';
import { useFetch } from '../../hooks/useFetch.js';
import { api } from '../../api/http.js';
import { Badge, Card, PageBanner } from '../../components/ui/Ui.jsx';
import { DataBoundary } from '../../components/ui/Feedback.jsx';
import { fmtDate } from '../../utils/dates.js';
import { ENROLL_STATUS, LEVEL_LABEL, PROVIDER_TONE, cr, fileHref } from '../../utils/learning.js';

export default function LearningCourse() {
  const { enrollmentId } = useParams();
  const { data, loading, error, reload } = useFetch(`/student/learning/${enrollmentId}`);
  return (
    <DataBoundary loading={loading} error={error} data={data} reload={reload}>
      {data && <Course item={data.item} id={enrollmentId} reload={reload} />}
    </DataBoundary>
  );
}

const KIND_ICON = { video: PlayCircle, reading: FileText, link: Link2 };

function Course({ item: i, id, reload }) {
  const st = ENROLL_STATUS[i.status];
  const [open, setOpen] = useState(null);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');

  const toggle = async (l) => {
    setBusy(l.id); setErr('');
    try { await api.put(`/student/learning/${id}/lessons/${l.id}`, { done: !l.done }); await reload(); } catch (e) { setErr(e.message); } finally { setBusy(''); }
  };

  return (
    <>
      <PageBanner
        icon={BookOpenCheck} title={i.title}
        subtitle={`${i.subject} · ${i.mandatory ? 'Compulsory' : 'Optional'} · ${cr(i.credits)} credit${i.credits === 1 ? '' : 's'}${i.dueDate ? ` · due ${fmtDate(i.dueDate)}` : ''}`}
        actions={<Link to="/student/learning" className="btn btn--outline btn--sm"><ArrowLeft size={14} /> All courses</Link>}
      />
      {err && <p className="form-error" role="alert">{err}</p>}
      <Card title="About this course" action={<Badge tone={st.tone}>{st.label}</Badge>}>
        <div className="badges" style={{ marginBottom: 8 }}>
          <Badge tone={PROVIDER_TONE[i.provider]}>{i.provider}</Badge><Badge tone="gray">{LEVEL_LABEL[i.level]}</Badge>
          {i.durationHours > 0 && <Badge tone="gray">About {i.durationHours} hours</Badge>}
          {i.assignedBy && <Badge tone="gray">Assigned by {i.assignedBy}</Badge>}
        </div>
        <p style={{ margin: '0 0 10px' }}>{i.description || 'No description.'}</p>
        {i.note && <p className="note">Note from your teacher: {i.note}</p>}
        {i.status === 'completed' && <p className="note" role="status" style={{ background: '#dcfce7', borderColor: '#bbf7d0' }}><CheckCircle2 size={14} style={{ verticalAlign: '-2px' }} /> Completed {fmtDate(String(i.completedAt).slice(0, 10))}. You earned <strong>{cr(i.creditsAwarded)} credit{i.creditsAwarded === 1 ? '' : 's'}</strong>.</p>}
        {i.completion === 'evidence' && i.url && <a className="btn btn--primary btn--sm" href={i.url} target="_blank" rel="noreferrer noopener"><ExternalLink size={14} /> Open the course on {i.provider}</a>}
      </Card>

      {i.completion === 'lessons' ? (
        <Card title={`Lessons (${i.done} of ${i.lessons} done)`}>
          <div className="bars__track" style={{ marginBottom: 12 }}><div className={`bars__fill bars__fill--${i.progress === 100 ? 'good' : 'warn'}`} style={{ width: `${i.progress}%` }} /></div>
          <ol style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {i.lessonList.map((l, n) => {
              const Icon = KIND_ICON[l.kind];
              const expanded = open === l.id;
              return (
                <li key={l.id} style={{ borderTop: n ? '1px solid var(--border)' : 'none', padding: '10px 0' }}>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <button type="button" className="icon-btn" aria-label={l.done ? `Mark "${l.title}" not done` : `Mark "${l.title}" done`} disabled={busy === l.id || i.status === 'completed'} onClick={() => toggle(l)}>
                      {l.done ? <CheckCircle2 size={20} style={{ color: 'var(--green)' }} /> : <Circle size={20} />}
                    </button>
                    <button type="button" onClick={() => setOpen(expanded ? null : l.id)} style={{ flex: 1, textAlign: 'left', background: 'none', border: 0, padding: 0, fontWeight: 600, display: 'flex', gap: 8, alignItems: 'center' }}>
                      <Icon size={15} /> {n + 1}. {l.title} {l.durationMin > 0 && <span className="muted" style={{ fontWeight: 400 }}>· {l.durationMin} min</span>}
                    </button>
                  </div>
                  {expanded && (
                    <div style={{ margin: '10px 0 0 40px' }}>
                      {l.body && <p style={{ whiteSpace: 'pre-wrap', margin: '0 0 8px' }}>{l.body}</p>}
                      {l.url && <a className="btn btn--outline btn--sm" href={l.url} target="_blank" rel="noreferrer noopener"><ExternalLink size={13} /> {l.kind === 'video' ? 'Watch' : 'Open'}</a>}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
          {i.status !== 'completed' && <p className="note">Tick each lesson as you finish it. When every lesson is done, the course is completed and your credits are added automatically.</p>}
        </Card>
      ) : <Evidence i={i} id={id} reload={reload} />}
    </>
  );
}

function Evidence({ i, id, reload }) {
  const canSubmit = ['assigned', 'in_progress', 'rejected'].includes(i.status);
  const file = useRef(null);
  const [f, setF] = useState({ evidenceUrl: '', certificateId: '', score: '', note: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k) => (e) => setF((c) => ({ ...c, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    try {
      let fileId;
      if (file.current?.files?.[0]) {
        const form = new FormData(); form.append('file', file.current.files[0]); form.append('purpose', 'document');
        fileId = (await api.post('/files', form)).file?.id;
      }
      await api.post(`/student/learning/${id}/submit`, { ...f, score: f.score === '' ? undefined : Number(f.score), fileId });
      await reload();
    } catch (ex) { setErr(ex.message); } finally { setBusy(false); }
  };

  return (
    <Card title="Your certificate">
      {i.status === 'submitted' && <p className="note" role="status">Submitted {fmtDate(String(i.submittedAt).slice(0, 10))}. Your teacher is reviewing it; you will see the result here.</p>}
      {i.status === 'rejected' && <p className="form-error" role="alert"><strong>Sent back:</strong> {i.reviewNote || 'Please resubmit.'}</p>}
      {(i.evidenceUrl || i.evidenceFileId) && (
        <p style={{ marginTop: 0 }}>
          {i.evidenceUrl && <>Link: <a href={i.evidenceUrl} target="_blank" rel="noreferrer noopener">{i.evidenceUrl}</a><br /></>}
          {i.evidenceFileId && <>File: <a href={fileHref(i.evidenceFileId)} target="_blank" rel="noreferrer">view uploaded certificate</a><br /></>}
          {i.certificateId && <>Certificate / roll no.: {i.certificateId}</>}
        </p>
      )}
      {canSubmit ? (
        <form onSubmit={submit}>
          <p className="muted" style={{ marginTop: 0 }}>Finished the course? Upload your certificate, paste its verification link, or both.</p>
          {err && <p className="form-error" role="alert">{err}</p>}
          <div className="fields">
            <div className="form-field form-field--full"><label className="label" htmlFor="ev-file">Certificate (PDF, PNG or JPG, up to 5 MB)</label><input id="ev-file" ref={file} className="input" type="file" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg" /></div>
            <div className="form-field form-field--full"><label className="label" htmlFor="ev-url">Verification link (optional if you upload the file)</label><input id="ev-url" className="input" type="url" placeholder="https://" value={f.evidenceUrl} onChange={set('evidenceUrl')} /></div>
            <div className="form-field"><label className="label" htmlFor="ev-id">Certificate / roll number</label><input id="ev-id" className="input" value={f.certificateId} onChange={set('certificateId')} maxLength={80} /></div>
            <div className="form-field"><label className="label" htmlFor="ev-score">Score (%)</label><input id="ev-score" className="input" type="number" min="0" max="100" step="0.01" value={f.score} onChange={set('score')} /></div>
            <div className="form-field form-field--full"><label className="label" htmlFor="ev-note">Note to your teacher (optional)</label><input id="ev-note" className="input" value={f.note} onChange={set('note')} maxLength={500} /></div>
          </div>
          <div className="form-actions"><button className="btn btn--primary" disabled={busy}><Upload size={15} /> {busy ? 'Submitting...' : i.status === 'rejected' ? 'Resubmit for review' : 'Submit for review'}</button></div>
        </form>
      ) : i.status === 'completed' ? null : <p className="muted" style={{ marginBottom: 0 }}>Your submission is with your teacher.</p>}
    </Card>
  );
}

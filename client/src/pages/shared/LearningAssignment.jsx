import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, BookOpenCheck, ExternalLink, RefreshCw, Trash2 } from 'lucide-react';
import { useFetch } from '../../hooks/useFetch.js';
import { api } from '../../api/http.js';
import { Badge, Card, PageBanner, StatCard } from '../../components/ui/Ui.jsx';
import { DataBoundary } from '../../components/ui/Feedback.jsx';
import Modal from '../../components/ui/Modal.jsx';
import { fmtDate } from '../../utils/dates.js';
import { ENROLL_STATUS, cr, fileHref } from '../../utils/learning.js';

export default function LearningAssignment({ role }) {
  const { id } = useParams();
  const nav = useNavigate();
  const { data, loading, error, reload } = useFetch(`/${role}/learning/assignments/${id}`);
  const [err, setErr] = useState(''); const [msg, setMsg] = useState(''); const [reject, setReject] = useState(null); const [note, setNote] = useState(''); const [busy, setBusy] = useState('');

  const run = async (key, fn) => { setBusy(key); setErr(''); setMsg(''); try { await fn(); await reload(); } catch (e) { setErr(e.message); } finally { setBusy(''); } };
  const review = (s, decision) => run(s.id, async () => { await api.post(`/${role}/learning/enrollments/${s.id}/review`, { decision, note: decision === 'reject' ? note : undefined }); setReject(null); setNote(''); });
  const sync = () => run('sync', async () => { const r = await api.post(`/${role}/learning/assignments/${id}/sync`); setMsg(r.added ? `Added ${r.added} new student${r.added === 1 ? '' : 's'}.` : 'Everyone in the class is already included.'); });
  const withdraw = async () => {
    if (!window.confirm('Withdraw this assignment? Students will no longer see it.')) return;
    try { await api.del(`/${role}/learning/assignments/${id}`); nav(`/${role}/learning`); } catch (e) { setErr(e.message); }
  };

  return (
    <DataBoundary loading={loading} error={error} data={data} reload={reload}>
      {data && (() => {
        const a = data.assignment; const c = data.counts;
        return (
          <>
            <PageBanner icon={BookOpenCheck} title={a.courseTitle} subtitle={`${a.className} · Sem ${a.semester}${a.section ? ` · Sec ${a.section}` : ''} · ${a.subject} · ${cr(a.credits)} credits · ${a.mandatory ? 'Compulsory' : 'Optional'}${a.dueDate ? ` · due ${fmtDate(a.dueDate)}` : ''}`}
              actions={<Link to={`/${role}/learning`} className="btn btn--outline btn--sm"><ArrowLeft size={14} /> Learning</Link>} />
            {err && <p className="form-error" role="alert">{err}</p>}{msg && <p className="note" role="status">{msg}</p>}
            <div className="stats">
              <StatCard value={`${c.completed} / ${c.total}`} label="Completed" icon={BookOpenCheck} tone="green" />
              <StatCard value={c.submitted} label="Awaiting your review" icon={BookOpenCheck} tone="amber" />
              <StatCard value={c.inProgress + c.assigned} label="Not finished" icon={BookOpenCheck} tone="indigo" />
              <StatCard value={c.overdue} label="Overdue" icon={BookOpenCheck} tone={c.overdue ? 'rose' : 'green'} />
            </div>
            <Card title="Students" action={<span style={{ display: 'flex', gap: 6 }}>
              <button type="button" className="btn btn--outline btn--sm" disabled={busy === 'sync'} onClick={sync}><RefreshCw size={13} /> Add new students</button>
              <button type="button" className="btn btn--outline btn--sm" onClick={withdraw}><Trash2 size={13} /> Withdraw</button></span>}>
              <div className="table-wrap"><table className="table">
                <thead><tr><th>Student</th><th>Status</th><th>Progress / evidence</th><th className="num">Credits</th><th /></tr></thead>
                <tbody>{data.students.map((s) => {
                  const st = ENROLL_STATUS[s.status];
                  return (
                    <tr key={s.id}>
                      <td><strong>{s.name}</strong><br /><small className="muted">{s.code}</small></td>
                      <td><Badge tone={st.tone}>{st.label}</Badge>{s.overdue && <> <Badge tone="red">Overdue</Badge></>}</td>
                      <td>
                        {a.completion === 'lessons' ? `${s.done} of ${s.lessons} lessons (${s.progress}%)` : (
                          <>{s.evidenceUrl && <a href={s.evidenceUrl} target="_blank" rel="noreferrer noopener"><ExternalLink size={12} /> link</a>}{s.evidenceFileId && <> {s.evidenceUrl && '· '}<a href={fileHref(s.evidenceFileId)} target="_blank" rel="noreferrer">certificate</a></>}
                            {s.certificateId && <><br /><small>ID {s.certificateId}</small></>}{s.score !== null && <small> · {s.score}%</small>}{!s.evidenceUrl && !s.evidenceFileId && <span className="muted">-</span>}
                            {s.status === 'rejected' && <><br /><small className="muted">Sent back: {s.reviewNote}</small></>}</>
                        )}
                      </td>
                      <td className="num">{s.status === 'completed' ? cr(s.creditsAwarded) : '-'}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{s.status === 'submitted' && <><button type="button" className="btn btn--primary btn--sm" disabled={busy === s.id} onClick={() => review(s, 'approve')}>Approve</button> <button type="button" className="btn btn--outline btn--sm" onClick={() => { setReject(s); setNote(''); }}>Send back</button></>}</td>
                    </tr>
                  );
                })}</tbody>
              </table></div>
            </Card>
            <Modal open={Boolean(reject)} title={`Send back ${reject?.name || ''}'s submission`} onClose={() => setReject(null)}>
              <label className="label" htmlFor="ra-note">Tell the student what to fix</label>
              <textarea id="ra-note" className="input" rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
              <div className="form-actions"><button type="button" className="btn btn--outline" onClick={() => setReject(null)}>Cancel</button><button type="button" className="btn btn--primary" disabled={!note.trim()} onClick={() => review(reject, 'reject')}>Send back</button></div>
            </Modal>
          </>
        );
      })()}
    </DataBoundary>
  );
}

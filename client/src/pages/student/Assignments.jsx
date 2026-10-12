import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Clock, NotebookPen, Paperclip } from 'lucide-react';
import { api } from '../../api/http.js';
import { useFetch } from '../../hooks/useFetch.js';
import { Badge, Card, PageBanner } from '../../components/ui/Ui.jsx';
import { DataBoundary, EmptyState } from '../../components/ui/Feedback.jsx';
import { useDialogs } from '../../components/ui/Dialogs.jsx';
import { cr, fileHref, fmtDateTime } from '../../utils/learning.js';
import { uploadFile } from '../../utils/upload.js';

const STATE = {
  pending: { label: 'To do', tone: 'blue' }, overdue: { label: 'Overdue', tone: 'red' }, submitted: { label: 'Handed in', tone: 'amber' },
  graded: { label: 'Graded', tone: 'green' }, returned: { label: 'Sent back', tone: 'red' }, missed: { label: 'Missed', tone: 'gray' },
};

export default function Assignments() {
  const { data, loading, error, reload } = useFetch('/student/assignments');
  return (
    <>
      <PageBanner icon={NotebookPen} title="Assignments" subtitle="Work set by your teachers. Hand it in before the due date." />
      <DataBoundary loading={loading} error={error} data={data} reload={reload}>
        {data && (data.assignments.length === 0 ? <Card><EmptyState title="No assignments yet" hint="Work your teachers publish for your class appears here." /></Card> : (
          <div className="grid-2" style={{ alignItems: 'stretch' }}>
            {data.assignments.map((a) => (
              <Card key={a.id} title={a.title} action={<Badge tone={STATE[a.state].tone}>{STATE[a.state].label}</Badge>}>
                <div className="badges" style={{ marginBottom: 8 }}><Badge tone="blue">{a.subject}</Badge><Badge tone="gray"><Clock size={11} /> Due {fmtDateTime(a.dueAt)}</Badge><Badge tone="gray">{cr(a.maxMarks)} marks</Badge></div>
                {a.state === 'graded' && <p style={{ margin: '0 0 8px' }}><strong>{cr(a.marks)} / {cr(a.maxMarks)}</strong></p>}
                <div className="form-actions" style={{ justifyContent: 'flex-start' }}>
                  <Link className="btn btn--primary btn--sm" to={`/student/assignments/${a.id}`}>{['pending', 'overdue', 'returned'].includes(a.state) ? 'Open and hand in' : 'View'}</Link>
                </div>
              </Card>
            ))}
          </div>
        ))}
      </DataBoundary>
    </>
  );
}

export function AssignmentView() {
  const { id } = useParams();
  const { toast } = useDialogs();
  const { data, loading, error, reload } = useFetch(`/student/assignments/${id}`);
  const [answer, setAnswer] = useState(null);
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true);
    try {
      const fileId = file ? await uploadFile(file) : undefined;
      await api.post(`/student/assignments/${id}/submit`, { answer: answer ?? data.assignment.answer ?? '', fileId });
      toast.success('Handed in.'); setFile(null); setAnswer(null); reload();
    } catch (err) { toast.error(err); } finally { setBusy(false); }
  };
  return (
    <DataBoundary loading={loading} error={error} data={data} reload={reload}>
      {data && (() => {
        const a = data.assignment; const canEdit = ['pending', 'overdue', 'returned', 'submitted'].includes(a.state) && a.status !== 'closed' && !(a.state === 'overdue' && !a.allowLate);
        return (
          <>
            <PageBanner icon={NotebookPen} title={a.title} subtitle={`${a.subject} · due ${fmtDateTime(a.dueAt)} · ${cr(a.maxMarks)} marks`}
              actions={<Link to="/student/assignments" className="btn btn--outline btn--sm"><ArrowLeft size={14} /> Back</Link>} />
            <Card title="Instructions" action={<Badge tone={STATE[a.state].tone}>{STATE[a.state].label}</Badge>}>
              {a.description ? <p style={{ whiteSpace: 'pre-wrap' }}>{a.description}</p> : <p className="muted">No written instructions.</p>}
              {a.attachmentFileId && <p><a href={fileHref(a.attachmentFileId)} target="_blank" rel="noreferrer"><Paperclip size={14} /> Open the attached file</a></p>}
              <p className="muted">{a.createdBy ? `Set by ${a.createdBy}. ` : ''}{a.allowLate ? 'Late work is accepted and marked late.' : 'Late work is not accepted.'}</p>
            </Card>
            {a.state === 'graded' || a.state === 'returned' ? (
              <Card title="Feedback">
                {a.state === 'graded' && <p><strong>{cr(a.marks)} / {cr(a.maxMarks)}</strong></p>}
                <p style={{ whiteSpace: 'pre-wrap' }}>{a.feedback || 'No comments.'}</p>
                {a.state === 'returned' && <p className="muted">Your teacher asked you to redo this. Hand it in again below.</p>}
              </Card>
            ) : null}
            {canEdit ? (
              <Card title={a.submissionId ? 'Your work (you can replace it until it is graded)' : 'Your work'}>
                <form onSubmit={submit}>
                  <div className="fields">
                    <div className="form-field form-field--full"><label className="label" htmlFor="sa-answer">Answer</label>
                      <textarea id="sa-answer" className="input" rows={6} maxLength={10000} value={answer ?? a.answer ?? ''} onChange={(e) => setAnswer(e.target.value)} /></div>
                    <div className="form-field form-field--full"><label className="label" htmlFor="sa-file">Attach a file (PDF, PNG, JPEG, up to 5 MB)</label>
                      <input id="sa-file" type="file" accept="application/pdf,image/png,image/jpeg" onChange={(e) => setFile(e.target.files[0] || null)} />
                      {a.fileId && !file && <small className="muted"> <a href={fileHref(a.fileId)} target="_blank" rel="noreferrer">Your earlier file</a> stays unless you choose another.</small>}</div>
                  </div>
                  <div className="form-actions"><button className="btn btn--primary" disabled={busy}>{a.submissionId ? 'Hand in again' : 'Hand in'}</button></div>
                </form>
              </Card>
            ) : a.submissionId && (
              <Card title="Your work">{a.answer && <p style={{ whiteSpace: 'pre-wrap' }}>{a.answer}</p>}{a.fileId && <p><a href={fileHref(a.fileId)} target="_blank" rel="noreferrer">Your file</a></p>}</Card>
            )}
          </>
        );
      })()}
    </DataBoundary>
  );
}

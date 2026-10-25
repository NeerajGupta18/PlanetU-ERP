import { useTabParam } from '../../hooks/useTabParam.js';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AlertCircle, CalendarDays, CheckCircle2, Download, Eye, EyeOff, FileText, GraduationCap, Pencil, PenLine, Plus, Printer, Trash2 } from 'lucide-react';
import { useFetch } from '../../hooks/useFetch.js';
import { api } from '../../api/http.js';
import { Badge, Card, FormActions, FormError, FormField, PageHeader, StatCard, Tabs } from '../../components/ui/Ui.jsx';
import { DataBoundary, EmptyState } from '../../components/ui/Feedback.jsx';
import Modal from '../../components/ui/Modal.jsx';
import { useDialogs } from '../../components/ui/Dialogs.jsx';
import { fmtDate } from '../../utils/dates.js';
import { KINDS, KIND_LABEL, RESULT_LABEL, RESULT_TONE, gradeTone, num } from '../../utils/exams.js';

export default function ExamDetail() {
  const { confirm, toast } = useDialogs();
  const { id } = useParams();
  const navigate = useNavigate();
  const [tab, setTab] = useTabParam('papers');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [editing, setEditing] = useState(null); // a paper being added ('new') or edited
  const [editExam, setEditExam] = useState(false);
  const exam = useFetch(`/admin/exams/${id}`);
  const results = useFetch(tab === 'results' ? `/admin/exams/${id}/results` : null);

  const act = async (fn, done) => {
    setBusy(true); setErr(null);
    try { await fn(); exam.reload(); results.reload(); if (done) toast.success(done); } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  const publish = async () => {
    if (await confirm('Publish these results? Students and parents will see their marks, grades and report cards.', { confirmLabel: 'Publish results' })) {
      act(() => api.post(`/admin/exams/${id}/publish`), 'Results published. Students can see them now.');
    }
  };
  const reportCards = `/api/admin/exams/${id}/report-cards.pdf`;

  return (
    <DataBoundary loading={exam.loading} error={exam.error} data={exam.data} reload={exam.reload}>
      {exam.data && (() => {
        const { exam: e, papers, roster, progress } = exam.data;
        const published = e.status === 'published';
        const waiting = progress.papers.filter((p) => p.marksStatus !== 'submitted');
        const gap = progress.papers.find((p) => p.missing > 0) || waiting[0];
        const failed = progress.checks.find((c) => !c.ok);
        const marksLink = (p) => `/admin/exams/${id}/marks/${p.id}`;
        const next = {
          papers: { hint: 'Add a paper for each subject, with its maximum and pass marks.', label: 'Add paper', onClick: () => { setTab('papers'); setEditing('new'); } },
          marks: {
            hint: `${papers.length - waiting.length} of ${papers.length} papers submitted. Waiting for ${waiting.map((p) => p.subject).join(', ')}.`,
            label: 'Enter marks', to: gap && marksLink(gap),
          },
          checked: { hint: failed ? `${failed.text}. ${failed.fix}` : '', label: 'Fix marks', to: gap && marksLink(gap) },
          published: { hint: 'Every check passed. Students cannot see these results until you publish.', label: 'Publish results', onClick: publish, disabled: busy },
          reports: { hint: 'Results are published. Print the report cards to hand out.', label: 'Print report cards', onClick: () => window.open(reportCards, '_blank', 'noopener') },
        }[progress.step];
        const waitingOn = progress.step === 'marks'
          ? [...new Set(waiting.map((p) => p.employeeName || 'Admin'))].join(', ')
          : progress.step === 'reports' ? undefined : 'Exam office';
        const dates = e.startDate ? ` · ${fmtDate(e.startDate)}${e.endDate && e.endDate !== e.startDate ? ` to ${fmtDate(e.endDate)}` : ''}` : ' · no dates yet';
        return (
          <>
            <PageHeader
              icon={GraduationCap} title={e.name}
              subtitle={`${e.course} · semester ${e.semester} · ${KIND_LABEL[e.kind]}${dates}`}
              back={{ to: '/admin/exams', label: 'All exams' }}
              actions={(
                <>
                  {!published && <button type="button" className="btn btn--outline btn--sm" onClick={() => setEditExam(true)}><CalendarDays size={14} /> Name and dates</button>}
                  {published && <button type="button" className="btn btn--outline btn--sm" disabled={busy} onClick={() => act(() => api.post(`/admin/exams/${id}/unpublish`), 'Unpublished. Students can no longer see these results.')}><EyeOff size={14} /> Unpublish</button>}
                  {!published && (
                    <button
                      type="button" className="btn btn--outline btn--sm" disabled={busy}
                      onClick={async () => { if (await confirm('Delete this exam and all its marks? This cannot be undone.', { danger: true, confirmLabel: 'Delete exam' })) act(async () => { await api.del(`/admin/exams/${id}`); navigate('/admin/exams'); }); }}
                    ><Trash2 size={14} /> Delete</button>
                  )}
                </>
              )}
              steps={{ process: 'exams', current: progress.step, waitingOn, next }}
            />
            <FormError error={err} />
            {!published && papers.length > 0 && (
              <Card title="Before you publish">
                <ul className="checks">
                  {progress.checks.map((c) => (
                    <li key={c.key} className={c.ok ? 'is-ok' : 'is-bad'}>
                      {c.ok ? <CheckCircle2 size={17} aria-hidden="true" /> : <AlertCircle size={17} aria-hidden="true" />}
                      <span><strong>{c.text}</strong>{!c.ok && <small>{c.fix}</small>}</span>
                      <span className="sr-only">{c.ok ? '(passed)' : '(not yet)'}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
            <Card title={published ? 'Published: students can see their results' : 'Draft: students cannot see this yet'}>
              <Tabs tabs={[{ id: 'papers', label: 'Papers and marks' }, { id: 'results', label: 'Results' }]} active={tab} onChange={setTab} />
              {tab === 'papers' ? (
                <Papers examId={id} papers={papers} progress={progress} roster={roster} published={published} onChanged={exam.reload} onEdit={setEditing} />
              ) : (
                <DataBoundary loading={results.loading} error={results.error} data={results.data} reload={results.reload}>
                  {results.data && <Results examId={id} d={results.data} />}
                </DataBoundary>
              )}
            </Card>
            {editing && <PaperModal examId={id} paper={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); exam.reload(); }} />}
            {editExam && <ExamModal exam={e} onClose={() => setEditExam(false)} onDone={() => { setEditExam(false); exam.reload(); }} />}
          </>
        );
      })()}
    </DataBoundary>
  );
}

/** The exam's name, type and dates (the "Papers and dates" step). */
function ExamModal({ exam, onClose, onDone }) {
  const [f, setF] = useState({ name: exam.name, kind: exam.kind, startDate: exam.startDate || '', endDate: exam.endDate || '' });
  const [err, setErr] = useState(null); const [busy, setBusy] = useState(false);
  const set = (k) => (ev) => setF((c) => ({ ...c, [k]: ev.target.value }));
  const submit = async (ev) => {
    ev.preventDefault(); setErr(null); setBusy(true);
    try { await api.put(`/admin/exams/${exam.id}`, { ...f, startDate: f.startDate || null, endDate: f.endDate || null }); onDone(); } catch (ex) { setErr(ex); setBusy(false); }
  };
  return (
    <Modal open title="Name and dates" onClose={onClose} width={520}>
      <form onSubmit={submit}>
        <FormError error={err} />
        <div className="fields">
          <FormField label="Exam name" required full><input className="input" maxLength={80} value={f.name} onChange={set('name')} /></FormField>
          <FormField label="Type" full>
            <select className="input" value={f.kind} onChange={set('kind')}>{KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</select>
          </FormField>
          <FormField label="Starts"><input className="input" type="date" value={f.startDate} onChange={set('startDate')} /></FormField>
          <FormField label="Ends" hint="Leave empty for a one-day exam."><input className="input" type="date" min={f.startDate || undefined} value={f.endDate} onChange={set('endDate')} /></FormField>
        </div>
        <FormActions submit="Save" busy={busy} onCancel={onClose} />
      </form>
    </Modal>
  );
}

function Papers({ examId, papers, progress, roster, published, onChanged, onEdit: setEditing }) {
  const { confirm, toast } = useDialogs();
  const done = new Map(progress.papers.map((p) => [p.id, p]));
  const remove = async (p) => {
    if (!(await confirm(`Remove the ${p.subject} paper and any marks entered for it?`, { danger: true, confirmLabel: 'Remove' } ))) return;
    try { await api.del(`/admin/exams/${examId}/papers/${p.id}`); onChanged(); } catch (e) { toast.error(e); }
  };
  return (
    <>
      <div className="toolbar">
        <span className="muted">{roster} student{roster === 1 ? '' : 's'} in this exam</span>
        {!published && <button type="button" className="btn btn--outline btn--sm" onClick={() => setEditing('new')}><Plus size={13} /> Add paper</button>}
      </div>
      {papers.length === 0 ? <EmptyState title="No papers yet" hint="Add a paper for each subject, with its maximum and pass marks." action={{ label: 'Add paper', onClick: () => setEditing('new') }} /> : (
        <div className="table-wrap">
          <table className="table table--stack">
            <thead><tr><th>Subject</th><th>Max</th><th>Pass</th><th>Credits</th><th>Marks entered by</th><th>Progress</th><th /></tr></thead>
            <tbody>
              {papers.map((p) => (
                <tr key={p.id}>
                  <td><strong>{p.subject}</strong></td>
                  <td>{num(p.maxMarks)}</td><td>{num(p.passMarks)}</td><td>{num(p.credits)}</td>
                  <td>{p.employeeName || <span className="muted">Not assigned</span>}</td>
                  <td style={{ minWidth: 150 }}>
                    <Badge tone={p.marksStatus === 'submitted' && !done.get(p.id)?.missing ? 'green' : p.entered ? 'amber' : 'gray'}>
                      {p.marksStatus === 'submitted' ? (done.get(p.id)?.missing ? `${done.get(p.id).missing} missing` : 'Submitted') : p.entered ? 'Draft' : 'Not started'}
                    </Badge>
                    <div className="progress progress--sm" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={done.get(p.id)?.pct ?? 0} aria-label={`${p.subject}: ${done.get(p.id)?.entered ?? 0} of ${roster} entered`}>
                      <div className="progress__fill" style={{ width: `${done.get(p.id)?.pct ?? 0}%` }} />
                    </div>
                    <small className="muted">{done.get(p.id)?.entered ?? 0} of {roster} entered</small>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      <Link className="btn btn--outline btn--sm" to={`/admin/exams/${examId}/marks/${p.id}`}><PenLine size={13} /> {published ? 'View / correct' : 'Enter marks'}</Link>
                      {!published && <button type="button" className="icon-btn icon-btn--bordered" aria-label={`Edit ${p.subject}`} onClick={() => setEditing(p)}><Pencil size={14} /></button>}
                      {!published && <button type="button" className="icon-btn icon-btn--bordered" aria-label={`Remove ${p.subject}`} onClick={() => remove(p)}><Trash2 size={14} /></button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {published && <p className="note">Published results are locked for faculty. You can still correct a mark here; every correction is recorded in the audit log.</p>}
    </>
  );
}

function PaperModal({ examId, paper, onClose, onDone }) {
  const filters = useFetch('/admin/timetable/filters');
  const [f, setF] = useState({
    subject: paper?.subject || '', maxMarks: paper?.maxMarks ?? 100, passMarks: paper?.passMarks ?? 40, credits: paper?.credits ?? 1, employeeId: paper?.employeeId || '',
  });
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((c) => ({ ...c, [k]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault(); setErr(''); setBusy(true);
    const body = { subject: f.subject, maxMarks: Number(f.maxMarks), passMarks: Number(f.passMarks), credits: Number(f.credits), employeeId: f.employeeId || null };
    try {
      if (paper) await api.put(`/admin/exams/${examId}/papers/${paper.id}`, body); else await api.post(`/admin/exams/${examId}/papers`, body);
      onDone();
    } catch (ex) { setErr(ex.message); setBusy(false); }
  };
  return (
    <Modal open title={paper ? `Edit ${paper.subject}` : 'Add a paper'} onClose={onClose} width={520}>
      <form onSubmit={submit}>
        {err && <p className="form-error" role="alert">{err}</p>}
        <div className="fields">
          <div className="form-field form-field--full"><label className="label" htmlFor="pp-sub">Subject</label><input id="pp-sub" className="input" required maxLength={80} value={f.subject} onChange={set('subject')} /></div>
          <div className="form-field"><label className="label" htmlFor="pp-max">Maximum marks</label><input id="pp-max" className="input" type="number" min="1" step="0.5" required value={f.maxMarks} onChange={set('maxMarks')} /></div>
          <div className="form-field"><label className="label" htmlFor="pp-pass">Pass marks</label><input id="pp-pass" className="input" type="number" min="0" step="0.5" required value={f.passMarks} onChange={set('passMarks')} /></div>
          <div className="form-field"><label className="label" htmlFor="pp-cr">Credits</label><input id="pp-cr" className="input" type="number" min="0.5" step="0.5" required value={f.credits} onChange={set('credits')} /></div>
          <div className="form-field"><label className="label" htmlFor="pp-emp">Marks entered by</label>
            <select id="pp-emp" className="input" value={f.employeeId} onChange={set('employeeId')}>
              <option value="">Admin only</option>{(filters.data?.employees || []).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select></div>
        </div>
        <p className="note">Credits are the subject's weight in the GPA. If every subject counts equally, leave them all at 1.</p>
        <div className="form-actions"><button type="button" className="btn btn--outline" onClick={onClose}>Cancel</button><button className="btn btn--primary" disabled={busy}>{paper ? 'Save paper' : 'Add paper'}</button></div>
      </form>
    </Modal>
  );
}

function Results({ examId, d }) {
  const { stats, papers, students } = d;
  if (!papers.length) return <EmptyState title="No papers yet" hint="Add the papers on the Papers and marks tab. Results appear here as marks come in." />;
  return (
    <>
      <div className="stats">
        <StatCard value={stats.students} label="Students" icon={GraduationCap} />
        <StatCard value={stats.passRate === null ? '-' : `${num(stats.passRate)}%`} label={`Pass rate (${stats.passed} passed, ${stats.failed} failed)`} icon={Eye} />
        <StatCard value={stats.average === null ? '-' : `${num(stats.average)}%`} label="Class average" icon={FileText} />
        <StatCard value={stats.highest === null ? '-' : `${num(stats.highest)}%`} label={stats.lowest === null ? 'Highest' : `Highest (lowest ${num(stats.lowest)}%)`} icon={Printer} />
      </div>
      <div className="toolbar" style={{ marginTop: 14 }}>
        <span className="muted">{stats.incomplete ? `${stats.incomplete} student${stats.incomplete === 1 ? ' has' : 's have'} incomplete marks` : 'All marks are in'}</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <a className="btn btn--outline btn--sm" href={`/api/admin/reports/exam-results?format=xlsx&examId=${examId}`} download><Download size={13} /> Excel</a>
          <a className="btn btn--outline btn--sm" href={`/api/admin/reports/exam-results?format=pdf&examId=${examId}`} target="_blank" rel="noreferrer"><FileText size={13} /> PDF</a>
          <a className="btn btn--outline btn--sm" href={`/api/admin/exams/${examId}/results.csv`} download><Download size={13} /> CSV</a>
          <a className="btn btn--outline btn--sm" href={`/api/admin/exams/${examId}/report-cards.pdf`} target="_blank" rel="noreferrer"><Printer size={13} /> All report cards</a>
        </div>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Roll no.</th><th>Student</th><th>Total</th><th>%</th><th>GPA</th><th>Result</th><th />
              {papers.map((p) => <th key={p.id}>{p.subject}<br /><small style={{ fontWeight: 400 }}>/ {num(p.maxMarks)}</small></th>)}
            </tr>
          </thead>
          <tbody>
            {students.map((s) => (
              <tr key={s.id}>
                <td className="muted" style={{ whiteSpace: 'nowrap' }}>{s.rollNo || '-'}</td>
                <td style={{ whiteSpace: 'nowrap' }}><strong>{s.name}</strong><br /><small className="muted">{s.code}</small></td>
                <td style={{ whiteSpace: 'nowrap' }}>{num(s.total)} / {num(s.maxTotal)}</td>
                <td>{s.pct === null ? '-' : `${num(s.pct)}%`}</td>
                <td>{s.gpa === null ? '-' : s.gpa.toFixed(2)}</td>
                <td><Badge tone={RESULT_TONE[s.result]}>{RESULT_LABEL[s.result]}</Badge></td>
                <td>{s.complete && <a className="btn btn--outline btn--sm" href={`/api/admin/exams/${examId}/students/${s.id}/report-card.pdf`} target="_blank" rel="noreferrer" aria-label={`Report card for ${s.name}`}><FileText size={13} /></a>}</td>
                {s.subjects.map((x, i) => (
                  <td key={i} style={{ whiteSpace: 'nowrap' }}>
                    {x.status === 'pending' ? <span className="muted">-</span> : (
                      <Badge tone={gradeTone(x)}>{x.absent ? 'AB' : num(x.marks)} · {x.grade}</Badge>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

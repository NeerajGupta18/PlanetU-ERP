import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Download, Eye, EyeOff, FileText, GraduationCap, Pencil, PenLine, Plus, Printer, Trash2 } from 'lucide-react';
import { useFetch } from '../../hooks/useFetch.js';
import { api } from '../../api/http.js';
import { Badge, Card, PageBanner, StatCard, Tabs } from '../../components/ui/Ui.jsx';
import { DataBoundary, EmptyState } from '../../components/ui/Feedback.jsx';
import Modal from '../../components/ui/Modal.jsx';
import { fmtDate } from '../../utils/dates.js';
import { KIND_LABEL, RESULT_LABEL, RESULT_TONE, gradeTone, num } from '../../utils/exams.js';

export default function ExamDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [tab, setTab] = useState('papers');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const exam = useFetch(`/admin/exams/${id}`);
  const results = useFetch(tab === 'results' ? `/admin/exams/${id}/results` : null);

  const act = async (fn) => {
    setBusy(true); setErr('');
    try { await fn(); exam.reload(); results.reload(); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <DataBoundary loading={exam.loading} error={exam.error} data={exam.data} reload={exam.reload}>
      {exam.data && (() => {
        const { exam: e, papers, roster } = exam.data;
        const published = e.status === 'published';
        const allSubmitted = papers.length > 0 && papers.every((p) => p.marksStatus === 'submitted');
        return (
          <>
            <PageBanner
              icon={GraduationCap} title={e.name}
              subtitle={`${e.course} · semester ${e.semester} · ${KIND_LABEL[e.kind]}${e.startDate ? ` · ${fmtDate(e.startDate)}${e.endDate && e.endDate !== e.startDate ? ` to ${fmtDate(e.endDate)}` : ''}` : ''}`}
              actions={<Link to="/admin/exams" className="btn btn--outline btn--sm"><ArrowLeft size={14} /> All exams</Link>}
            />
            <Card
              title={published ? 'Published: students can see their results' : 'Draft: students cannot see this yet'}
              action={(
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {published ? (
                    <button type="button" className="btn btn--outline btn--sm" disabled={busy} onClick={() => act(() => api.post(`/admin/exams/${id}/unpublish`))}><EyeOff size={14} /> Unpublish</button>
                  ) : (
                    <>
                      <button
                        type="button" className="btn btn--primary btn--sm" disabled={busy || !allSubmitted}
                        title={allSubmitted ? '' : 'Every paper needs its marks submitted first'}
                        onClick={() => { if (window.confirm('Publish these results? Students will see their marks, grades and report cards.')) act(() => api.post(`/admin/exams/${id}/publish`)); }}
                      ><Eye size={14} /> Publish results</button>
                      <button
                        type="button" className="btn btn--outline btn--sm" disabled={busy}
                        onClick={() => { if (window.confirm('Delete this exam and all its marks? This cannot be undone.')) act(async () => { await api.del(`/admin/exams/${id}`); navigate('/admin/exams'); }); }}
                      ><Trash2 size={14} /> Delete</button>
                    </>
                  )}
                </div>
              )}
            >
              {err && <p className="form-error" role="alert">{err}</p>}
              {!published && (
                <p className="note" style={{ marginTop: 0 }}>
                  {papers.length === 0 ? 'Add the papers (subjects) for this exam first.'
                    : allSubmitted ? 'Every paper has its marks submitted. You can publish.'
                      : `${papers.filter((p) => p.marksStatus === 'submitted').length} of ${papers.length} papers submitted. Publishing unlocks once faculty have submitted them all.`}
                </p>
              )}
              <Tabs tabs={[{ id: 'papers', label: 'Papers & marks' }, { id: 'results', label: 'Results' }]} active={tab} onChange={setTab} />
              {tab === 'papers' ? (
                <Papers examId={id} papers={papers} roster={roster} published={published} onChanged={exam.reload} />
              ) : (
                <DataBoundary loading={results.loading} error={results.error} data={results.data} reload={results.reload}>
                  {results.data && <Results examId={id} d={results.data} />}
                </DataBoundary>
              )}
            </Card>
          </>
        );
      })()}
    </DataBoundary>
  );
}

function Papers({ examId, papers, roster, published, onChanged }) {
  const [editing, setEditing] = useState(null); // null | 'new' | paper
  const remove = async (p) => {
    if (!window.confirm(`Remove the ${p.subject} paper and any marks entered for it?`)) return;
    try { await api.del(`/admin/exams/${examId}/papers/${p.id}`); onChanged(); } catch (e) { window.alert(e.message); }
  };
  return (
    <>
      <div className="toolbar">
        <span className="muted">{roster} student{roster === 1 ? '' : 's'} in this exam</span>
        {!published && <button type="button" className="btn btn--outline btn--sm" onClick={() => setEditing('new')}><Plus size={13} /> Add paper</button>}
      </div>
      {papers.length === 0 ? <EmptyState title="No papers yet" hint="Add a paper for each subject, with its maximum and pass marks." /> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Subject</th><th>Max</th><th>Pass</th><th>Credits</th><th>Marks entered by</th><th>Progress</th><th /></tr></thead>
            <tbody>
              {papers.map((p) => (
                <tr key={p.id}>
                  <td><strong>{p.subject}</strong></td>
                  <td>{num(p.maxMarks)}</td><td>{num(p.passMarks)}</td><td>{num(p.credits)}</td>
                  <td>{p.employeeName || <span className="muted">Not assigned</span>}</td>
                  <td>
                    <Badge tone={p.marksStatus === 'submitted' ? 'green' : p.entered ? 'amber' : 'gray'}>
                      {p.marksStatus === 'submitted' ? 'Submitted' : p.entered ? 'Draft' : 'Not started'} · {p.entered}/{roster}
                    </Badge>
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
      {editing && <PaperModal examId={examId} paper={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); onChanged(); }} />}
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
  if (!papers.length) return <EmptyState title="No papers yet" />;
  return (
    <>
      <div className="stats">
        <StatCard value={stats.students} label="Students" icon={GraduationCap} tone="indigo" />
        <StatCard value={stats.passRate === null ? '-' : `${num(stats.passRate)}%`} label={`Pass rate (${stats.passed} passed, ${stats.failed} failed)`} icon={Eye} tone="green" />
        <StatCard value={stats.average === null ? '-' : `${num(stats.average)}%`} label="Class average" icon={FileText} tone="amber" />
        <StatCard value={stats.highest === null ? '-' : `${num(stats.highest)}%`} label={stats.lowest === null ? 'Highest' : `Highest (lowest ${num(stats.lowest)}%)`} icon={Printer} tone="indigo" />
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

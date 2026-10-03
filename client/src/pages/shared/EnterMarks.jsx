import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Lock, PenLine, Save, Send } from 'lucide-react';
import { api } from '../../api/http.js';
import { useFetch } from '../../hooks/useFetch.js';
import { Badge, Card, PageBanner } from '../../components/ui/Ui.jsx';
import { DataBoundary } from '../../components/ui/Feedback.jsx';
import { num } from '../../utils/exams.js';

/**
 * Marks entry for ONE paper. Shared by faculty (their own papers) and admins (any paper, including
 * corrections after publishing). The server decides who may edit; this screen reflects `editable`.
 *   role="employee"  /employee/exams/papers/:paperId/marks      (route /employee/exams/:paperId)
 *   role="admin"     /admin/exams/:id/papers/:paperId/marks      (route /admin/exams/:id/marks/:paperId)
 */
export default function EnterMarks({ role }) {
  const { id, paperId } = useParams();
  const url = role === 'admin' ? `/admin/exams/${id}/papers/${paperId}/marks` : `/employee/exams/papers/${paperId}/marks`;
  const back = role === 'admin' ? `/admin/exams/${id}` : '/employee/exams';
  const { data, loading, error, reload } = useFetch(url);
  return (
    <DataBoundary loading={loading} error={error} data={data} reload={reload}>
      {data && <Sheet key={data.paper.id} url={url} back={back} initial={data} />}
    </DataBoundary>
  );
}

const toState = (students) => Object.fromEntries(students.map((s) => [s.id, { marks: s.marks === null ? '' : String(s.marks), absent: s.absent }]));

/** One comparable form of an entry, so "90", "90.0" and 90 are the same mark. */
const norm = (marks, absent) => (absent ? 'AB' : marks === '' || marks === null ? '' : String(Number(marks)));

function checkMark(text, max) {
  if (text === '') return null;
  const n = Number(text);
  if (!Number.isFinite(n) || n < 0 || n > max) return `Enter 0 to ${num(max)}`;
  if (Math.abs(Math.round(n * 100) / 100 - n) > 1e-9) return 'Max 2 decimals';
  return null;
}

function Sheet({ url, back, initial }) {
  const [saved, setSaved] = useState(initial);
  const [rows, setRows] = useState(() => toState(initial.students));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const inputs = useRef([]);

  const { paper, exam, students, editable } = saved;
  const submitted = paper.marksStatus === 'submitted';

  const info = useMemo(() => {
    const out = { empty: 0, invalid: 0, absent: 0, entered: [], below: 0, changes: [] };
    students.forEach((s) => {
      const r = rows[s.id];
      if (r.absent) out.absent += 1;
      else if (r.marks === '') out.empty += 1;
      else if (checkMark(r.marks, paper.maxMarks)) out.invalid += 1;
      else { const n = Number(r.marks); out.entered.push(n); if (n < paper.passMarks) out.below += 1; }
      if (norm(r.marks, r.absent) !== norm(s.marks === null ? '' : s.marks, s.absent)) out.changes.push(s.id);
    });
    return out;
  }, [rows, students, paper.maxMarks, paper.passMarks]);
  const dirty = info.changes.length > 0;
  const avg = info.entered.length ? info.entered.reduce((a, b) => a + b, 0) / info.entered.length : null;

  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const edit = (id, patch) => { setNotice(''); setRows((r) => ({ ...r, [id]: { ...r[id], ...patch } })); };
  const focusNext = (i) => {
    for (let j = i + 1; j < students.length; j += 1) {
      const el = inputs.current[j];
      if (el && !el.disabled) { el.focus(); el.select(); return; }
    }
  };

  async function save(submit) {
    setBusy(true); setError(''); setNotice('');
    try {
      const entries = info.changes.map((sid) => {
        const r = rows[sid];
        return r.absent ? { studentId: sid, absent: true } : { studentId: sid, marks: r.marks === '' ? null : Number(r.marks) };
      });
      const next = await api.put(url, { entries, submit });
      setSaved(next); setRows(toState(next.students));
      setNotice(submit && !submitted ? 'Marks submitted.' : submit ? 'Changes saved.' : 'Draft saved.');
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  const canSubmit = editable && !busy && info.empty === 0 && info.invalid === 0 && (!submitted || dirty);

  return (
    <>
      <PageBanner
        icon={PenLine} title={paper.subject}
        subtitle={`${exam.name} · ${exam.course}, semester ${exam.semester} · out of ${num(paper.maxMarks)}, pass at ${num(paper.passMarks)}`}
        actions={<Link to={back} className="btn btn--outline btn--sm"><ArrowLeft size={14} /> Back</Link>}
      />
      <Card
        title={`${students.length} students`}
        action={<div className="badges">
          {submitted ? <Badge tone="green">Submitted</Badge> : <Badge tone="amber">Draft</Badge>}
          {exam.status === 'published' && <Badge tone="blue">Published</Badge>}
        </div>}
      >
        {!editable && <p className="form-error" role="status"><Lock size={13} style={{ verticalAlign: '-2px' }} /> {saved.reason} You can view this sheet but not change it.</p>}
        {editable && exam.status === 'published' && <p className="note" style={{ marginTop: 0 }}>These results are published. A correction here changes what students see, and is recorded in the audit log.</p>}

        <div className="mark-summary" aria-live="polite" style={{ marginBottom: 12 }}>
          <span>{info.entered.length + info.absent} of {students.length} entered</span>
          <span className={info.absent ? 'mark-summary__a' : 'muted'}>{info.absent} absent</span>
          <span className={info.below ? 'mark-summary__a' : 'muted'}>{info.below} below pass</span>
          {avg !== null && <span className="muted">average {num(Math.round(avg * 100) / 100)} · high {num(Math.max(...info.entered))} · low {num(Math.min(...info.entered))}</span>}
        </div>

        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Student</th><th style={{ width: 130 }}>Marks (/ {num(paper.maxMarks)})</th><th style={{ width: 96 }}>Absent</th></tr></thead>
            <tbody>
              {students.map((s, i) => {
                const r = rows[s.id];
                const problem = r.absent ? null : checkMark(r.marks, paper.maxMarks);
                const failing = !r.absent && r.marks !== '' && !problem && Number(r.marks) < paper.passMarks;
                return (
                  <tr key={s.id}>
                    <td><strong>{s.name}</strong><br /><small className="muted">{s.rollNo ? `${s.rollNo} · ` : ''}{s.code}</small></td>
                    <td>
                      <input
                        ref={(el) => { inputs.current[i] = el; }} className="input marks-input" type="number" inputMode="decimal" step="any" min="0" max={paper.maxMarks}
                        value={r.absent ? '' : r.marks} disabled={!editable || r.absent} placeholder={r.absent ? 'AB' : ''}
                        aria-label={`Marks for ${s.name}`} aria-invalid={!!problem}
                        style={problem ? { borderColor: 'var(--red)' } : failing ? { color: 'var(--red)', fontWeight: 700 } : undefined}
                        onChange={(e) => edit(s.id, { marks: e.target.value })}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); focusNext(i); } }}
                      />
                      {problem && <small style={{ color: 'var(--red)', display: 'block' }}>{problem}</small>}
                    </td>
                    <td>
                      <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                        <input type="checkbox" checked={r.absent} disabled={!editable} onChange={(e) => edit(s.id, { absent: e.target.checked, marks: '' })} /> Absent
                      </label>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {error && <p className="form-error" role="alert" style={{ marginTop: 14 }}>{error}</p>}
        {notice && <p className="note" role="status">{notice}</p>}

        {editable && (
          <div className="form-actions">
            {!submitted && <button type="button" className="btn btn--outline" disabled={busy || !dirty || info.invalid > 0} onClick={() => save(false)}><Save size={15} /> Save draft</button>}
            <button type="button" className="btn btn--primary" disabled={!canSubmit} onClick={() => save(true)}>
              <Send size={15} /> {submitted ? 'Save changes' : 'Submit marks'}
            </button>
          </div>
        )}
        {editable && info.empty > 0 && <p className="note">Every student needs a mark or Absent before you can submit ({info.empty} still empty). Press Enter to move to the next student.</p>}
      </Card>
    </>
  );
}

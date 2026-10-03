import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { GraduationCap, Plus, RotateCcw, Save, Trash2 } from 'lucide-react';
import { useFetch } from '../../hooks/useFetch.js';
import { api } from '../../api/http.js';
import { Badge, Card, PageBanner, Tabs } from '../../components/ui/Ui.jsx';
import { DataBoundary, EmptyState } from '../../components/ui/Feedback.jsx';
import Modal from '../../components/ui/Modal.jsx';
import { fmtDate } from '../../utils/dates.js';
import { KINDS, KIND_LABEL } from '../../utils/exams.js';

export default function Exams() {
  const [tab, setTab] = useState('exams');
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();

  return (
    <>
      <PageBanner
        icon={GraduationCap} title="Exams & Results" subtitle="Set up exams, collect marks from faculty, publish results and print report cards"
        actions={<button type="button" className="btn btn--primary btn--sm" onClick={() => setCreating(true)}><Plus size={13} /> New exam</button>}
      />
      <Card>
        <Tabs tabs={[{ id: 'exams', label: 'Exams' }, { id: 'grading', label: 'Grading scale' }]} active={tab} onChange={setTab} />
        {tab === 'exams' ? <ExamList /> : <GradingScale />}
      </Card>
      {creating && <CreateExam onClose={() => setCreating(false)} onDone={(id) => navigate(`/admin/exams/${id}`)} />}
    </>
  );
}

function ExamList() {
  const [status, setStatus] = useState('');
  const { data, loading, error, reload } = useFetch(`/admin/exams${status ? `?status=${status}` : ''}`);
  return (
    <>
      <div className="toolbar">
        <div className="toolbar__filters">
          <select className="input" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status" style={{ width: 'auto' }}>
            <option value="">All exams</option><option value="draft">Marks being collected</option><option value="published">Published</option>
          </select>
        </div>
      </div>
      <DataBoundary loading={loading} error={error} data={data} reload={reload}>
        {data && (data.exams.length === 0 ? (
          <EmptyState title="No exams yet" hint="Create one with New exam. You can start it from the course timetable so each subject becomes a paper." />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Exam</th><th>Course</th><th>Dates</th><th>Marks submitted</th><th>Status</th><th /></tr></thead>
              <tbody>
                {data.exams.map((e) => (
                  <tr key={e.id}>
                    <td><strong>{e.name}</strong><br /><small className="muted">{KIND_LABEL[e.kind]} · semester {e.semester}</small></td>
                    <td>{e.course}<br /><small className="muted">{e.students} students</small></td>
                    <td className="muted">{e.startDate ? `${fmtDate(e.startDate)}${e.endDate && e.endDate !== e.startDate ? ` - ${fmtDate(e.endDate)}` : ''}` : '-'}</td>
                    <td>{e.papers === 0 ? <span className="muted">No papers</span> : <Badge tone={e.submitted === e.papers ? 'green' : 'amber'}>{e.submitted} of {e.papers} papers</Badge>}</td>
                    <td>{e.status === 'published' ? <Badge tone="green">Published</Badge> : <Badge tone="gray">Draft</Badge>}</td>
                    <td><Link className="btn btn--outline btn--sm" to={`/admin/exams/${e.id}`}>Open</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </DataBoundary>
    </>
  );
}

function CreateExam({ onClose, onDone }) {
  const filters = useFetch('/admin/timetable/filters');
  const [f, setF] = useState({ courseId: '', name: '', kind: 'term', semester: 1, startDate: '', endDate: '', fromTimetable: true });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((cur) => ({ ...cur, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  const submit = async (e) => {
    e.preventDefault(); setErr(''); setBusy(true);
    try {
      const r = await api.post('/admin/exams', { ...f, semester: Number(f.semester), startDate: f.startDate || undefined, endDate: f.endDate || undefined });
      onDone(r.exam.id);
    } catch (ex) { setErr(ex.message); setBusy(false); }
  };

  return (
    <Modal open title="New exam" onClose={onClose} width={560}>
      <form onSubmit={submit}>
        {err && <p className="form-error" role="alert">{err}</p>}
        <div className="fields">
          <div className="form-field"><label className="label" htmlFor="ex-course">Course</label>
            <select id="ex-course" className="input" required value={f.courseId} onChange={set('courseId')}>
              <option value="">Choose...</option>{(filters.data?.courses || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select></div>
          <div className="form-field"><label className="label" htmlFor="ex-sem">Semester</label>
            <input id="ex-sem" className="input" type="number" min="1" max="20" required value={f.semester} onChange={set('semester')} /></div>
          <div className="form-field form-field--full"><label className="label" htmlFor="ex-name">Exam name</label>
            <input id="ex-name" className="input" required maxLength={80} placeholder="e.g. End-Semester Examination" value={f.name} onChange={set('name')} /></div>
          <div className="form-field"><label className="label" htmlFor="ex-kind">Type</label>
            <select id="ex-kind" className="input" value={f.kind} onChange={set('kind')}>{KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</select></div>
          <div className="form-field"><label className="label">&nbsp;</label>
            <p className="note" style={{ margin: 0 }}>Only <strong>Semester-end</strong> exams count towards a student's CGPA.</p></div>
          <div className="form-field"><label className="label" htmlFor="ex-start">Starts</label><input id="ex-start" className="input" type="date" value={f.startDate} onChange={set('startDate')} /></div>
          <div className="form-field"><label className="label" htmlFor="ex-end">Ends</label><input id="ex-end" className="input" type="date" value={f.endDate} min={f.startDate} onChange={set('endDate')} /></div>
          <div className="form-field form-field--full">
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
              <input type="checkbox" checked={f.fromTimetable} onChange={set('fromTimetable')} />
              Add a paper for every subject on this course's timetable (taught by that subject's teacher)
            </label>
          </div>
        </div>
        <div className="form-actions">
          <button type="button" className="btn btn--outline" onClick={onClose}>Cancel</button>
          <button className="btn btn--primary" disabled={busy}>Create exam</button>
        </div>
      </form>
    </Modal>
  );
}

/** The institute's grade bands. Without a saved scale the built-in 10-point scale applies. */
function GradingScale() {
  const { data, loading, error, reload } = useFetch('/admin/exams/grading');
  return (
    <DataBoundary loading={loading} error={error} data={data} reload={reload}>
      {data && <ScaleEditor key={JSON.stringify(data.bands)} data={data} onSaved={reload} />}
    </DataBoundary>
  );
}

function ScaleEditor({ data, onSaved }) {
  const [rows, setRows] = useState(data.bands.map((b) => ({ ...b })));
  const [err, setErr] = useState(''); const [ok, setOk] = useState(''); const [busy, setBusy] = useState(false);
  const edit = (i, k) => (e) => { setOk(''); setRows((r) => r.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x))); };

  const save = async () => {
    setBusy(true); setErr(''); setOk('');
    try {
      await api.put('/admin/exams/grading', { bands: rows.map((r) => ({ grade: r.grade, min: Number(r.min), points: Number(r.points) })) });
      setOk('Grading scale saved. Every result now uses it.'); onSaved();
    } catch (ex) { setErr(ex.message); } finally { setBusy(false); }
  };
  const reset = async () => {
    if (!window.confirm('Go back to the built-in 10-point scale?')) return;
    setBusy(true); setErr('');
    try { await api.del('/admin/exams/grading'); onSaved(); } catch (ex) { setErr(ex.message); } finally { setBusy(false); }
  };

  return (
    <>
      <p className="note" style={{ marginTop: 0 }}>
        {data.custom ? 'Your institute uses a custom scale.' : 'Using the built-in 10-point scale.'} A student gets the highest grade whose minimum percentage they reach.
        Falling below a paper's pass mark (or being absent) is always the lowest grade with 0 points. Changing the scale re-grades every result immediately; no marks are changed.
      </p>
      {err && <p className="form-error" role="alert">{err}</p>}
      {ok && <p className="note" role="status">{ok}</p>}
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Grade</th><th>Minimum %</th><th>Grade points</th><th /></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td><input className="input" maxLength={4} value={r.grade} onChange={edit(i, 'grade')} aria-label="Grade" style={{ width: 90 }} /></td>
                <td><input className="input" type="number" min="0" max="100" value={r.min} onChange={edit(i, 'min')} aria-label="Minimum percentage" style={{ width: 110 }} /></td>
                <td><input className="input" type="number" min="0" step="0.5" value={r.points} onChange={edit(i, 'points')} aria-label="Grade points" style={{ width: 110 }} /></td>
                <td><button type="button" className="icon-btn" aria-label="Remove band" disabled={rows.length <= 2} onClick={() => { setOk(''); setRows((x) => x.filter((_, j) => j !== i)); }}><Trash2 size={15} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="form-actions" style={{ justifyContent: 'space-between' }}>
        <button type="button" className="btn btn--outline btn--sm" disabled={rows.length >= 12} onClick={() => setRows((x) => [...x, { grade: '', min: 0, points: 0 }])}><Plus size={13} /> Add band</button>
        <div style={{ display: 'flex', gap: 10 }}>
          {data.custom && <button type="button" className="btn btn--outline" disabled={busy} onClick={reset}><RotateCcw size={14} /> Use built-in scale</button>}
          <button type="button" className="btn btn--primary" disabled={busy} onClick={save}><Save size={14} /> Save scale</button>
        </div>
      </div>
    </>
  );
}

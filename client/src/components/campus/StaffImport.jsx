import { useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, ListChecks, Upload, UserPlus } from 'lucide-react';
import { api } from '../../api/http.js';
import { Badge, Card, FormError, StatCard, pending } from '../ui/Ui.jsx';
import { EmptyState } from '../ui/Feedback.jsx';

const SHOW_LIMIT = 300;

/**
 * Staff from a CSV sheet, checked before import: choose the file, see each row with what is wrong and how to fix
 * it, then import (all rows, or only the good ones). Nothing is saved until "Import".
 */
export default function StaffImport({ onImported }) {
  const input = useRef(null);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [skip, setSkip] = useState(false);
  const [onlyProblems, setOnlyProblems] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const form = (extra = {}) => {
    const f = new FormData();
    f.append('file', file);
    Object.entries(extra).forEach(([k, v]) => f.append(k, String(v)));
    return f;
  };
  const reset = () => { setFile(null); setPreview(null); setResult(null); setSkip(false); setErr(null); if (input.current) input.current.value = ''; };

  const check = async () => {
    setBusy(true); setErr(null); setResult(null);
    try { const p = await api.post('/admin/setup/staff-import/preview', form()); setPreview(p); setOnlyProblems(p.summary.withErrors > 0); setSkip(false); } catch (ex) { setErr(ex); } finally { setBusy(false); }
  };
  const run = async () => {
    setBusy(true); setErr(null);
    try { setResult(await api.post('/admin/setup/staff-import', form({ skipInvalid: skip }))); setPreview(null); onImported?.(); } catch (ex) { setErr(ex); } finally { setBusy(false); }
  };

  if (result) {
    return (
      <Card title="Staff imported" icon={CheckCircle2}>
        <p style={{ marginTop: 0 }}>
          <strong>{result.created}</strong> staff added{result.skipped ? <>, <strong>{result.skipped}</strong> rows skipped</> : ''}.
          They get their sign-in details in step 7, "Invite people".
        </p>
        <div className="form-actions" style={{ justifyContent: 'flex-start' }}>
          <button type="button" className="btn btn--outline" onClick={reset}>Import another file</button>
        </div>
      </Card>
    );
  }

  const s = preview?.summary;
  const rows = preview ? preview.rows.filter((r) => !onlyProblems || !r.ok) : [];
  const blocked = s && s.withErrors > 0 && !skip;
  const count = s ? (skip ? s.ready : s.rows) : 0;

  return (
    <Card title="Import staff" icon={UserPlus}>
      <FormError error={err} />
      {!preview && (
        <>
          <label className="label" htmlFor="staff-csv">Choose the filled-in staff sheet (CSV)</label>
          <input
            id="staff-csv" ref={input} type="file" accept=".csv,text/csv,text/plain" className="input"
            onChange={(e) => { setFile(e.target.files?.[0] || null); setErr(null); }}
          />
          <p className="form-hint">In Excel choose File, Save As, "CSV UTF-8". Up to 2,000 rows.</p>
          <div className="form-actions">
            <button type="button" className="btn btn--outline" disabled={!file || busy} onClick={check}><ListChecks size={15} aria-hidden="true" /> {busy ? 'Checking...' : 'Check the file'}</button>
          </div>
        </>
      )}

      {preview && (
        <>
          <div className="stats" style={{ marginBottom: 14 }}>
            <StatCard value={s.rows} label={`Rows in ${file?.name || 'the file'}`} icon={UserPlus} />
            <StatCard value={s.ready} label="Ready to import" icon={CheckCircle2} status={s.ready ? 'good' : 'neutral'} hint={s.ready ? 'Ready' : undefined} />
            <StatCard value={s.withErrors} label="Rows with problems" icon={AlertTriangle} {...pending(s.withErrors, { level: 'bad', act: 'Fix before import', clear: 'None' })} />
            <StatCard value={s.newDepartments + s.newDesignations} label="New departments and designations" icon={AlertTriangle} {...pending(s.newDepartments + s.newDesignations, { act: 'Will be created', clear: 'None' })} />
          </div>
          {[...preview.notes, ...(preview.unknownColumns.length ? [`Columns we do not use were ignored: ${preview.unknownColumns.join(', ')}.`] : [])].map((n) => <p key={n} className="note" style={{ marginTop: 0 }}>{n}</p>)}
          <label className="switch-row" style={{ marginBottom: 10 }}>
            <input type="checkbox" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} /> <span>Show only the rows with problems</span>
          </label>
          {rows.length === 0 ? <EmptyState compact title="No problems found" hint="Every row can be imported." /> : (
            <div className="table-wrap">
              <table className="table table--stack">
                <caption className="sr-only">Staff rows checked</caption>
                <thead><tr><th>Line</th><th>Name</th><th>Department</th><th>What to fix</th></tr></thead>
                <tbody>
                  {rows.slice(0, SHOW_LIMIT).map((r) => (
                    <tr key={r.line}>
                      <td data-label="Line" className="muted">{r.line}</td>
                      <td data-label="Name"><strong>{r.name || <em className="muted">(no name)</em>}</strong><div className="muted">{r.email}</div></td>
                      <td data-label="Department">{r.department}{r.designation && <div className="muted">{r.designation}</div>}</td>
                      <td data-label="What to fix">
                        {r.ok ? <Badge tone="green">Ready</Badge> : <Badge tone="red">{r.errors.length} problem{r.errors.length === 1 ? '' : 's'}</Badge>}
                        {r.errors.map((m) => <div key={m} className="row-problem">{m}</div>)}
                        {r.warnings.map((m) => <div key={m} className="row-warning">{m}</div>)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {rows.length > SHOW_LIMIT && <p className="note">Showing the first {SHOW_LIMIT} of {rows.length} rows.</p>}
          {s.withErrors > 0 && (
            <label className="switch-row" style={{ marginTop: 12 }}>
              <input type="checkbox" checked={skip} onChange={(e) => setSkip(e.target.checked)} />
              <span>Skip the {s.withErrors} row{s.withErrors === 1 ? '' : 's'} with problems and import the other {s.ready}</span>
            </label>
          )}
          <div className="form-actions">
            <button type="button" className="btn btn--outline" disabled={busy} onClick={reset}>Choose another file</button>
            <button type="button" className="btn btn--outline" disabled={busy || blocked || count === 0} onClick={run}>
              <Upload size={15} aria-hidden="true" /> {busy ? 'Importing...' : blocked ? 'Fix the problems, or tick skip' : `Import ${count} staff`}
            </button>
          </div>
        </>
      )}
    </Card>
  );
}

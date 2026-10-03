import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, CheckCircle2, Download, FileSpreadsheet, ListChecks, Upload, Users2 } from 'lucide-react';
import { api } from '../../api/http.js';
import { useTenantConfig } from '../../hooks/useTenantConfig.js';
import { Badge, Card, PageBanner, StatCard } from '../../components/ui/Ui.jsx';
import { EmptyState } from '../../components/ui/Feedback.jsx';
import { downloadCsv } from '../../utils/csv.js';

const SHOW_LIMIT = 300; // rows drawn at once; the summary and the download always cover the whole file

export default function StudentImport() {
  const { t } = useTenantConfig();
  const students = t('students', 'Students').toLowerCase();
  const input = useRef(null);
  const [file, setFile] = useState(null);
  const [opts, setOpts] = useState({ createLogins: true, sendEmails: true });
  const [stage, setStage] = useState('choose'); // choose | preview | done
  const [preview, setPreview] = useState(null);
  const [skip, setSkip] = useState(false);
  const [show, setShow] = useState('problems');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  const form = (extra = {}) => {
    const f = new FormData();
    f.append('file', file);
    f.append('createLogins', String(opts.createLogins));
    f.append('sendEmails', String(opts.createLogins && opts.sendEmails));
    Object.entries(extra).forEach(([k, v]) => f.append(k, String(v)));
    return f;
  };

  async function check() {
    setBusy(true); setError('');
    try {
      const p = await api.post('/admin/students/import/preview', form());
      setPreview(p); setSkip(false); setShow(p.summary.withErrors ? 'problems' : 'all'); setStage('preview');
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  async function run() {
    setBusy(true); setError('');
    try {
      setResult(await api.post('/admin/students/import', form({ skipInvalid: skip })));
      setStage('done');
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  const reset = () => { setFile(null); setPreview(null); setResult(null); setStage('choose'); setError(''); if (input.current) input.current.value = ''; };

  return (
    <>
      <PageBanner
        icon={Upload} title={`Import ${students} from CSV`} subtitle="Bring in existing records in one go. You see every problem before anything is saved."
        actions={<Link to="/admin/students" className="btn btn--outline btn--sm"><ArrowLeft size={14} /> Back to {students}</Link>}
      />
      {error && <p className="form-error" role="alert">{error}</p>}

      {stage === 'choose' && (
        <Card title="1. Prepare your file" icon={FileSpreadsheet}>
          <p className="muted" style={{ marginTop: 0 }}>
            Use our template so the columns match. Only <strong>name</strong>, <strong>email</strong> and <strong>course</strong> (a course code or name) are required.
            Leave <strong>student_id</strong> empty to have IDs generated, or fill it to keep your existing numbers. Dates can be YYYY-MM-DD or DD/MM/YYYY.
            Up to 2,000 rows per file. In Excel, save as <em>CSV UTF-8</em>.
          </p>
          <a className="btn btn--outline btn--sm" href="/api/admin/students/import/template.csv" download><Download size={14} /> Download the template</a>

          <h3 className="label" style={{ marginTop: 24 }}>2. Choose the file</h3>
          <input
            ref={input} type="file" accept=".csv,text/csv,text/plain" className="input" aria-label="CSV file"
            onChange={(e) => { setFile(e.target.files?.[0] || null); setError(''); }}
          />

          <h3 className="label" style={{ marginTop: 24 }}>3. Accounts</h3>
          <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 8 }}>
            <input type="checkbox" checked={opts.createLogins} onChange={(e) => setOpts((o) => ({ ...o, createLogins: e.target.checked }))} />
            <span>Create a login for each student (the student ID is the login ID). Each student needs their own email address.</span>
          </label>
          <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', opacity: opts.createLogins ? 1 : 0.5 }}>
            <input type="checkbox" disabled={!opts.createLogins} checked={opts.createLogins && opts.sendEmails} onChange={(e) => setOpts((o) => ({ ...o, sendEmails: e.target.checked }))} />
            <span>Email each student a link to set their password (valid for 7 days). If you leave this off, students can use <em>Forgot password</em> when you are ready.</span>
          </label>

          <div className="form-actions">
            <button type="button" className="btn btn--primary" disabled={!file || busy} onClick={check}><ListChecks size={15} /> {busy ? 'Checking...' : 'Check file'}</button>
          </div>
        </Card>
      )}

      {stage === 'preview' && preview && (
        <Preview
          p={preview} file={file} show={show} setShow={setShow} skip={skip} setSkip={setSkip} busy={busy}
          students={students} onBack={() => setStage('choose')} onImport={run} opts={opts}
        />
      )}

      {stage === 'done' && result && <Done r={result} students={students} onAgain={reset} />}
    </>
  );
}

function Preview({ p, file, show, setShow, skip, setSkip, busy, students, onBack, onImport, opts }) {
  const { summary: s } = p;
  const rows = p.rows.filter((r) => (show === 'problems' ? !r.ok : show === 'warnings' ? r.warnings.length > 0 : true));
  const importCount = skip ? s.ready : s.rows;
  const blocked = s.withErrors > 0 && !skip;

  return (
    <>
      <div className="stats">
        <StatCard value={s.rows} label={`Rows in ${file.name}`} icon={Users2} tone="indigo" />
        <StatCard value={s.ready} label="Ready to import" icon={CheckCircle2} tone="green" />
        <StatCard value={s.withErrors} label="Rows with problems" icon={AlertTriangle} tone={s.withErrors ? 'rose' : 'green'} />
        <StatCard value={s.withWarnings} label="Rows with warnings" icon={AlertTriangle} tone="amber" />
      </div>

      {(p.notes.length > 0 || p.unknownColumns.length > 0) && (
        <Card>
          {p.notes.map((n) => <p key={n} className="note" style={{ marginTop: 0 }}>{n}</p>)}
          {p.unknownColumns.length > 0 && <p className="note" style={{ marginTop: 0 }}>Ignored columns that we do not use: {p.unknownColumns.join(', ')}.</p>}
        </Card>
      )}

      <Card
        title="Check the rows"
        action={(
          <div className="segmented" role="tablist" aria-label="Which rows to show" style={{ background: 'var(--brand-50)' }}>
            {[['problems', `Problems (${s.withErrors})`], ['warnings', `Warnings (${s.withWarnings})`], ['all', `All (${s.rows})`]].map(([id, label]) => (
              <button key={id} type="button" role="tab" aria-selected={show === id} className={`segmented__item ${show === id ? 'is-active' : ''}`} style={{ color: show === id ? undefined : 'var(--brand-700)' }} onClick={() => setShow(id)}>{label}</button>
            ))}
          </div>
        )}
      >
        {rows.length === 0 ? (
          <EmptyState title={show === 'problems' ? 'No problems found' : show === 'warnings' ? 'No warnings' : 'No rows'} hint={show === 'problems' ? 'Every row can be imported.' : undefined} />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Line</th><th>{students.replace(/^./, (c) => c.toUpperCase()).replace(/s$/, '')}</th><th>Course</th><th>ID</th><th>Result</th></tr></thead>
              <tbody>
                {rows.slice(0, SHOW_LIMIT).map((r) => (
                  <tr key={r.line}>
                    <td className="muted">{r.line}</td>
                    <td><strong>{r.name || <em className="muted">(no name)</em>}</strong><div className="muted">{r.email}</div></td>
                    <td>{r.course}{r.semester ? <span className="muted"> · sem {r.semester}</span> : null}</td>
                    <td>{r.studentCode || <span className="muted">auto</span>}</td>
                    <td>
                      {r.ok ? <Badge tone="green">Ready</Badge> : <Badge tone="red">{r.errors.length} problem{r.errors.length === 1 ? '' : 's'}</Badge>}
                      {r.errors.map((m) => <div key={m} style={{ color: 'var(--red)', fontSize: 12.5, marginTop: 3 }}>{m}</div>)}
                      {r.warnings.map((m) => <div key={m} style={{ color: '#92400e', fontSize: 12.5, marginTop: 3 }}>{m}</div>)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {rows.length > SHOW_LIMIT && <p className="note">Showing the first {SHOW_LIMIT} of {rows.length} rows. Fix those and check again to see the rest.</p>}
      </Card>

      <Card title="Import">
        {s.withErrors > 0 ? (
          <>
            <p style={{ marginTop: 0 }}>
              <strong>{s.withErrors} row{s.withErrors === 1 ? ' has' : 's have'} problems.</strong> Nothing has been saved yet. Fix them in your file and check it again,
              or import the {s.ready} good row{s.ready === 1 ? '' : 's'} now and handle the rest later.
            </p>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="checkbox" checked={skip} onChange={(e) => setSkip(e.target.checked)} /> Skip the {s.withErrors} row{s.withErrors === 1 ? '' : 's'} with problems and import the other {s.ready}
            </label>
          </>
        ) : (
          <p style={{ marginTop: 0 }}>
            All {s.rows} rows look good. {s.autoIds > 0 && `${s.autoIds} will get a generated student ID. `}
            {opts.createLogins ? (opts.sendEmails ? 'Each student will be emailed a link to set their password.' : 'Logins are created without emails.') : 'No logins will be created.'}
          </p>
        )}
        <div className="form-actions">
          <button type="button" className="btn btn--outline" disabled={busy} onClick={onBack}>Change file or options</button>
          <button type="button" className="btn btn--primary" disabled={busy || blocked || importCount === 0} onClick={onImport}>
            <Upload size={15} /> {busy ? 'Importing...' : blocked ? 'Resolve the problems to import' : `Import ${importCount} ${students}`}
          </button>
        </div>
      </Card>
    </>
  );
}

function Done({ r, students, onAgain }) {
  const report = () => downloadCsv('student-import-report.csv', [
    ['Line', 'Name', 'Email', 'Student ID', 'Result', 'Reason'],
    ...r.rows.map((x) => [x.line, x.name, x.email, x.studentCode || '', x.status === 'created' ? 'Imported' : 'Skipped', x.reason]),
  ]);
  return (
    <Card title="Import finished" icon={CheckCircle2}>
      <div className="stats" style={{ marginBottom: 16 }}>
        <StatCard value={r.created} label={`${students.replace(/^./, (c) => c.toUpperCase())} imported`} icon={CheckCircle2} tone="green" />
        <StatCard value={r.skipped} label="Rows skipped" icon={AlertTriangle} tone={r.skipped ? 'amber' : 'green'} />
        <StatCard value={r.emailsQueued} label="Set-password emails queued" icon={Upload} tone="indigo" />
      </div>
      <p>
        {r.createLogins
          ? (r.emailsQueued ? 'Each student will receive an email to choose a password. The login ID is their student ID.' : 'Logins were created without emails. Students can choose a password with “Forgot password” on the sign-in page.')
          : 'No logins were created. You can import again later with logins switched on once you are ready.'}
      </p>
      <div className="form-actions" style={{ justifyContent: 'flex-start' }}>
        <button type="button" className="btn btn--outline" onClick={report}><Download size={14} /> Download the import report</button>
        <Link to="/admin/students" className="btn btn--primary"><Users2 size={15} /> View {students}</Link>
        <button type="button" className="btn btn--outline" onClick={onAgain}>Import another file</button>
      </div>
    </Card>
  );
}

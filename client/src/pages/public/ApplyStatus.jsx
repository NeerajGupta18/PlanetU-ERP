import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Search } from 'lucide-react';
import RobotCheck from '../../components/auth/RobotCheck.jsx';
import { pub } from '../../api/public.js';
import { Badge, Card } from '../../components/ui/Ui.jsx';
import DocumentsPanel from '../../components/admissions/DocumentsPanel.jsx';
import { STATUS } from '../../components/admissions/status.js';

export default function ApplyStatus() {
  const { code } = useParams();
  const [applicationNo, setNo] = useState('');
  const [accessCode, setAccess] = useState('');
  const [app, setApp] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const find = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try { setApp((await pub(code, '/applications/lookup', { method: 'POST', body: { applicationNo, accessCode } })).application); }
    catch (err) { setError(err.message); setApp(null); } finally { setBusy(false); }
  };

  const [rec, setRec] = useState({ open: false, email: '', captcha: null, msg: '', err: '', key: 0 });
  const recover = async (e) => {
    e.preventDefault();
    if (!rec.captcha) return setRec((r) => ({ ...r, err: 'Tick "I\'m not a robot" first.', msg: '' }));
    try {
      const r = await pub(code, '/applications/recover', { method: 'POST', body: { email: rec.email, captchaToken: rec.captcha } });
      setRec((x) => ({ ...x, msg: r.message, err: '' }));
    } catch (err) { setRec((x) => ({ ...x, err: err.message, msg: '', captcha: null, key: x.key + 1 })); }
  };

  return (
    <div className="public-page">
      <header className="public-page__head"><div><h1>Check your application</h1><p>Enter the number and access code you were given.</p></div></header>
      <Card>
        <form onSubmit={find}>
          {error && <p className="form-error">{error}</p>}
          <div className="fields">
            <div className="form-field"><label className="label">Application number</label><input className="input" value={applicationNo} onChange={(e) => setNo(e.target.value)} placeholder="APP2026-00001" required /></div>
            <div className="form-field"><label className="label">Access code</label><input className="input" value={accessCode} onChange={(e) => setAccess(e.target.value)} autoComplete="off" required /></div>
          </div>
          <div className="form-actions"><button className="btn btn--primary" disabled={busy}><Search size={15} /> {busy ? 'Looking...' : 'Find application'}</button></div>
        </form>
        <p className="muted">
          <Link to={`/apply/${code}`}>Start a new application</Link> ·{' '}
          <button type="button" className="login__demo" style={{ display: 'inline', width: 'auto', border: 0, padding: 0, margin: 0, color: 'var(--brand-600)' }}
            onClick={() => setRec((r) => ({ ...r, open: !r.open }))}>Lost your access code?</button>
        </p>
        {rec.open && (
          <form onSubmit={recover} style={{ marginTop: 8 }}>
            {rec.err && <p className="form-error">{rec.err}</p>}
            {rec.msg && <p className="secret-box">{rec.msg}</p>}
            <div className="form-field"><label className="label">Email you applied with</label>
              <input className="input" type="email" required value={rec.email} onChange={(e) => setRec((r) => ({ ...r, email: e.target.value }))} /></div>
            <RobotCheck onChange={(t) => setRec((r) => ({ ...r, captcha: t }))} resetKey={rec.key} />
            <div className="form-actions"><button className="btn btn--outline">Email me a new access code</button></div>
          </form>
        )}
      </Card>

      {app && (
        <Card title={`${app.name} - ${app.course}`} action={<Badge tone={STATUS[app.status].tone}>{STATUS[app.status].label}</Badge>}>
          {app.decisionNote && <p><strong>Message from the institute:</strong> {app.decisionNote}</p>}
          <DocumentsPanel code={code} app={app} accessCode={accessCode.trim()} onChange={setApp} />
        </Card>
      )}
    </div>
  );
}

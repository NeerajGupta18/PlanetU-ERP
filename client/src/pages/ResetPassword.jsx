import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { KeyRound } from 'lucide-react';
import { api } from '../api/http.js';
import { Card } from '../components/ui/Ui.jsx';

export default function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const institute = params.get('institute') || '';
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [err, setErr] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    if (pw !== pw2) return setErr('The two passwords do not match.');
    setBusy(true);
    try { await api.post('/auth/reset-password', { token, password: pw }); setDone(true); }
    catch (e2) { setErr(e2.message); } finally { setBusy(false); }
  };

  return (
    <div className="public-page" style={{ maxWidth: 520 }}>
      <header className="public-page__head"><span className="banner__icon"><KeyRound size={22} /></span><div><h1>Choose a password</h1><p>At least 8 characters, with a letter and a number.</p></div></header>
      <Card>
        {!token ? <p className="form-error">This link is incomplete. Open the link from your email again.</p> : done ? (
          <>
            <p className="secret-box">Your password has been saved.</p>
            <div className="form-actions"><Link className="btn btn--primary" to={`/login${institute ? `?institute=${encodeURIComponent(institute)}` : ''}`}>Go to sign in</Link></div>
          </>
        ) : (
          <form onSubmit={submit}>
            {err && <p className="form-error">{err}</p>}
            <div className="form-field"><label className="label" htmlFor="rp-new">New password</label>
              <input className="input" id="rp-new" type="password" autoComplete="new-password" required value={pw} onChange={(e) => setPw(e.target.value)} /></div>
            <div className="form-field" style={{ marginTop: 12 }}><label className="label" htmlFor="rp-new2">Repeat new password</label>
              <input className="input" id="rp-new2" type="password" autoComplete="new-password" required value={pw2} onChange={(e) => setPw2(e.target.value)} /></div>
            <div className="form-actions"><button className="btn btn--primary" disabled={busy}>{busy ? 'Saving...' : 'Save password'}</button></div>
          </form>
        )}
      </Card>
    </div>
  );
}

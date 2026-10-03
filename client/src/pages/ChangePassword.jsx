import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { KeyRound } from 'lucide-react';
import { api } from '../api/http.js';
import { useAuth } from '../context/AuthContext.jsx';
import { ROLE_HOME } from '../config/menu.config.js';
import { Card } from '../components/ui/Ui.jsx';

export default function ChangePassword() {
  const { user, refresh, logout } = useAuth();
  const navigate = useNavigate();
  const [cur, setCur] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const forced = user.mustChangePassword;

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    if (pw !== pw2) return setErr('The two new passwords do not match.');
    setBusy(true);
    try {
      await api.post('/auth/change-password', { currentPassword: cur, newPassword: pw });
      await refresh();
      navigate(ROLE_HOME[user.role], { replace: true });
    } catch (e2) { setErr(e2.message); } finally { setBusy(false); }
  };

  return (
    <div className="public-page" style={{ maxWidth: 520 }}>
      <header className="public-page__head"><span className="banner__icon"><KeyRound size={22} /></span>
        <div><h1>{forced ? 'Choose your own password' : 'Change password'}</h1>
          <p>{forced ? 'You are using a temporary password. Set a new one to continue.' : 'Other devices will be signed out.'}</p></div></header>
      <Card>
        <form onSubmit={submit}>
          {err && <p className="form-error">{err}</p>}
          <div className="form-field"><label className="label" htmlFor="cp-cur">{forced ? 'Temporary password' : 'Current password'}</label>
            <input id="cp-cur" className="input" type="password" autoComplete="current-password" required value={cur} onChange={(e) => setCur(e.target.value)} /></div>
          <div className="form-field" style={{ marginTop: 12 }}><label className="label" htmlFor="cp-new">New password (8+ characters, a letter and a number)</label>
            <input id="cp-new" className="input" type="password" autoComplete="new-password" required value={pw} onChange={(e) => setPw(e.target.value)} /></div>
          <div className="form-field" style={{ marginTop: 12 }}><label className="label" htmlFor="cp-new2">Repeat new password</label>
            <input id="cp-new2" className="input" type="password" autoComplete="new-password" required value={pw2} onChange={(e) => setPw2(e.target.value)} /></div>
          <div className="form-actions">
            {forced ? <button type="button" className="btn btn--outline" onClick={() => logout()}>Sign out</button>
              : <Link className="btn btn--outline" to={ROLE_HOME[user.role]}>Cancel</Link>}
            <button className="btn btn--primary" disabled={busy}>{busy ? 'Saving...' : 'Save new password'}</button>
          </div>
        </form>
      </Card>
    </div>
  );
}

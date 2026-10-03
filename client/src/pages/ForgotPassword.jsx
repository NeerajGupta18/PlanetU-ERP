import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Mail } from 'lucide-react';
import { api } from '../api/http.js';
import { Card } from '../components/ui/Ui.jsx';
import RobotCheck from '../components/auth/RobotCheck.jsx';

export default function ForgotPassword() {
  const [params] = useSearchParams();
  const [code, setCode] = useState(params.get('institute') || localStorage.getItem('erp.institute') || '');
  const [email, setEmail] = useState('');
  const [captcha, setCaptcha] = useState(null);
  const [key, setKey] = useState(0);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    if (!captcha) return setErr('Tick "I\'m not a robot" first.');
    setBusy(true);
    try {
      const r = await api.post('/auth/forgot-password', { tenantCode: code.trim().toLowerCase(), email: email.trim(), captchaToken: captcha });
      setMsg(r.message);
    } catch (e2) { setErr(e2.message); setCaptcha(null); setKey((k) => k + 1); } finally { setBusy(false); }
  };

  return (
    <div className="public-page" style={{ maxWidth: 520 }}>
      <header className="public-page__head"><span className="banner__icon"><Mail size={22} /></span><div><h1>Forgot your password?</h1><p>We'll email you a link to choose a new one.</p></div></header>
      <Card>
        {msg ? <p className="secret-box">{msg}</p> : (
          <form onSubmit={submit}>
            {err && <p className="form-error">{err}</p>}
            <div className="form-field"><label className="label" htmlFor="fp-inst">Institute code</label>
              <input className="input" id="fp-inst" value={code} onChange={(e) => setCode(e.target.value)} placeholder="Leave empty for platform admins" autoCapitalize="none" /></div>
            <div className="form-field" style={{ marginTop: 12 }}><label className="label" htmlFor="fp-email">Email address on your account</label>
              <input className="input" id="fp-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
            <RobotCheck onChange={setCaptcha} resetKey={key} />
            <div className="form-actions"><button className="btn btn--primary" disabled={busy}>{busy ? 'Sending...' : 'Email me a reset link'}</button></div>
          </form>
        )}
        <p className="muted" style={{ marginTop: 12 }}><Link to="/login">Back to sign in</Link></p>
      </Card>
    </div>
  );
}

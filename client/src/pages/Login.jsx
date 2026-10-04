import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import {
  AlertCircle, Briefcase, Building2, Eye, EyeOff, GraduationCap, LockKeyhole, LogIn, ShieldCheck, UserCog, UserRound,
} from 'lucide-react';
import { api } from '../api/http.js';
import { useAuth } from '../context/AuthContext.jsx';
import { ROLE_HOME } from '../config/menu.config.js';
import { BRAND } from '../config/brand.js';
import BrandMark from '../components/ui/BrandMark.jsx';
import RobotCheck from '../components/auth/RobotCheck.jsx';

const ROLES = [
  { value: 'super_admin', label: 'Super Admin', icon: ShieldCheck, idLabel: 'Email or Super Admin ID' },
  { value: 'admin', label: 'Admin', icon: UserCog, idLabel: 'Email or Admin ID' },
  { value: 'student', label: 'Student', icon: GraduationCap, idLabel: 'Student ID or email' },
  { value: 'employee', label: 'Employee', icon: Briefcase, idLabel: 'Employee ID or email' },
];

// Shown only in development (npm run dev) so you can demo quickly. Never shipped in a production build.
const DEMO_PW = { super_admin: 'SuperAdmin@123', admin: 'Admin@123', student: 'Student@123', employee: 'Employee@123' };
const DEMO_TENANTS = {
  'demo-college': { label: 'College', student: 'STU2026001' },
  'demo-school': { label: 'School', student: 'GPS2026001' },
  'demo-university': { label: 'University', student: 'MIT2026001' },
};
const demoId = (role, code) => ({
  super_admin: 'SA001', admin: 'ADM001', employee: 'EMP001', student: DEMO_TENANTS[code]?.student || 'STU2026001',
}[role]);

// A client can be opened at its own address (horizon.planetu.app) or with ?institute=code
function initialCode() {
  const fromQuery = new URLSearchParams(window.location.search).get('institute');
  if (fromQuery) return fromQuery.toLowerCase();
  const sub = window.location.hostname.split('.');
  if (sub.length >= 3 && !['www', 'app'].includes(sub[0])) return sub[0].toLowerCase();
  return localStorage.getItem('erp.institute') || '';
}

export default function Login() {
  const { user, login } = useAuth();
  const navigate = useNavigate();

  const [role, setRole] = useState('student');
  const [tenantCode, setTenantCode] = useState(initialCode);
  const [instituteName, setInstituteName] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [captchaToken, setCaptchaToken] = useState(null);
  const [resetKey, setResetKey] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [demo, setDemo] = useState(null); // the sample sign-ins, when the server is in demo mode

  useEffect(() => {
    api.get('/auth/demo-logins').then((d) => { if (d.enabled) setDemo(d); }).catch(() => {});
  }, []);

  // Show which institute the code belongs to, so a typo is obvious before signing in
  useEffect(() => {
    const code = tenantCode.trim().toLowerCase();
    setInstituteName('');
    if (code.length < 3) return undefined;
    const t = setTimeout(() => {
      api.get(`/auth/tenant/${encodeURIComponent(code)}`).then((r) => setInstituteName(r.name)).catch(() => setInstituteName(''));
    }, 350);
    return () => clearTimeout(t);
  }, [tenantCode]);

  if (user) return <Navigate to={ROLE_HOME[user.role]} replace />;

  const needsCode = role !== 'super_admin';
  const current = ROLES.find((r) => r.value === role);

  const onSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (needsCode && !tenantCode.trim()) return setError('Enter your institute code.');
    if (!identifier.trim() || !password) return setError('Enter your ID or email and your password.');
    if (!captchaToken) return setError('Tick "I\'m not a robot" before signing in.');
    setBusy(true);
    try {
      const u = await login({
        role, identifier: identifier.trim(), password, captchaToken, tenantCode: needsCode ? tenantCode.trim().toLowerCase() : undefined,
      });
      if (needsCode) localStorage.setItem('erp.institute', tenantCode.trim().toLowerCase());
      navigate(ROLE_HOME[u.role], { replace: true });
    } catch (err) {
      setError(err.message);
      setCaptchaToken(null); // tokens are single-use, so the check must be repeated
      setResetKey((k) => k + 1);
      setBusy(false);
    }
  };

  const onCaptcha = (token) => {
    setCaptchaToken(token);
    if (token) setError((prev) => (prev.includes('not a robot') ? '' : prev));
  };

  const pickDemo = (inst, l) => {
    setRole(l.role); setTenantCode(inst.code); setIdentifier(l.id); setPassword(l.password); setError('');
    // On a small screen the demo list sits below the form: bring the "I'm not a robot" box into view
    setTimeout(() => document.querySelector('.robot')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60);
  };

  const fillDemo = (code = tenantCode) => {
    if (role !== 'super_admin') setTenantCode(code || 'demo-college');
    setIdentifier(demoId(role, code || 'demo-college'));
    setPassword(DEMO_PW[role]);
    setError('');
  };

  return (
    <div className="login">
      <aside className="login__aside">
        <div className="login__aside-inner">
          <span className="login__mark"><BrandMark size={34} /></span>
          <h1>{BRAND.name}</h1>
          <p className="login__lead">{BRAND.tagline}.</p>
        </div>
      </aside>

      <main className="login__panel">
        <form className="login__card" onSubmit={onSubmit} noValidate>
          <h2>Sign in</h2>
          <p className="login__hint">Choose your role, then enter your credentials.</p>

          <div className="roles" role="radiogroup" aria-label="Sign in as">
            {ROLES.map(({ value, label, icon: Icon }) => (
              <button
                key={value} type="button" role="radio" aria-checked={role === value}
                className={`roles__item ${role === value ? 'is-active' : ''}`}
                onClick={() => { setRole(value); setError(''); setPassword(''); }}
              >
                <Icon size={20} /><span>{label}</span>
              </button>
            ))}
          </div>

          {needsCode && (
            <>
              <label className="label" htmlFor="institute">Institute code</label>
              <div className="input-wrap">
                <Building2 size={17} />
                <input
                  id="institute" className="input input--icon" value={tenantCode} autoComplete="organization" autoCapitalize="none"
                  onChange={(e) => setTenantCode(e.target.value)} placeholder="e.g. horizon-college"
                />
              </div>
              {instituteName && <p className="login__institute">{instituteName}</p>}
            </>
          )}

          <label className="label" htmlFor="identifier">{current.idLabel}</label>
          <div className="input-wrap">
            <UserRound size={17} />
            <input
              id="identifier" className="input input--icon" value={identifier} autoComplete="username"
              onChange={(e) => setIdentifier(e.target.value)} placeholder="Enter your ID or email" autoFocus={!needsCode}
            />
          </div>

          <label className="label" htmlFor="password">Password</label>
          <div className="input-wrap">
            <LockKeyhole size={17} />
            <input
              id="password" className="input input--icon input--trail" type={showPw ? 'text' : 'password'} value={password}
              autoComplete="current-password" onChange={(e) => setPassword(e.target.value)} placeholder="Enter your password"
            />
            <button type="button" className="input-wrap__toggle" onClick={() => setShowPw((s) => !s)} aria-label={showPw ? 'Hide password' : 'Show password'}>
              {showPw ? <EyeOff size={17} /> : <Eye size={17} />}
            </button>
          </div>

          <RobotCheck onChange={onCaptcha} resetKey={resetKey} />
          <p style={{ margin: '0 0 12px', fontSize: 13 }}>
            <Link to={`/forgot-password${needsCode && tenantCode ? `?institute=${encodeURIComponent(tenantCode.trim())}` : ''}`}>Forgot your password?</Link>
          </p>

          {error && <div className="alert" role="alert"><AlertCircle size={16} /> {error}</div>}

          <button type="submit" className="btn btn--primary btn--block" disabled={busy}>
            {busy ? <span className="spinner spinner--sm spinner--light" /> : <LogIn size={17} />} Sign in as {current.label}
          </button>

          {demo && (
            <div className="login__demo-panel">
              <div className="login__demo-head"><ShieldCheck size={15} /> Demo logins <span className="login__demo-tag">TEST MODE</span></div>
              <p>Click a role to fill in the form, then tick &ldquo;I&apos;m not a robot&rdquo; and sign in. Everything here is fictional sample data.</p>
              {demo.institutes.map((inst) => (
                <div key={inst.code} className="login__demo-inst">
                  <strong>{inst.name}</strong>
                  <div className="login__demos">
                    {inst.logins.map((l) => (
                      <button key={l.role} type="button" className="login__demo" onClick={() => pickDemo(inst, l)}>{ROLES.find((r) => r.value === l.role).label}</button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {!demo && import.meta.env.DEV && (
            <div className="login__demos">
              <span>Development only - fill demo {current.label} credentials for:</span>
              {needsCode ? Object.entries(DEMO_TENANTS).map(([code, t]) => (
                <button key={code} type="button" className="login__demo" onClick={() => fillDemo(code)}>{t.label}</button>
              )) : <button type="button" className="login__demo" onClick={() => fillDemo()}>Fill</button>}
            </div>
          )}
        </form>
      </main>
    </div>
  );
}

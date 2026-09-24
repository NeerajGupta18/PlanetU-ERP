import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import {
  AlertCircle, Briefcase, CalendarDays, Eye, EyeOff, GraduationCap, LockKeyhole, LogIn, ShieldCheck, Table2, UserCog, UserRound,
} from 'lucide-react';
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
const DEMO = {
  super_admin: { id: 'SA001', pw: 'SuperAdmin@123' },
  admin: { id: 'ADM001', pw: 'Admin@123' },
  student: { id: 'STU2026001', pw: 'Student@123' },
  employee: { id: 'EMP001', pw: 'Employee@123' },
};

export default function Login() {
  const { user, login } = useAuth();
  const navigate = useNavigate();

  const [role, setRole] = useState('student');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [captchaToken, setCaptchaToken] = useState(null);
  const [resetKey, setResetKey] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={ROLE_HOME[user.role]} replace />;

  const current = ROLES.find((r) => r.value === role);

  const onSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!identifier.trim() || !password) return setError('Enter your ID or email and your password.');
    if (!captchaToken) return setError('Tick "I\'m not a robot" before signing in.');
    setBusy(true);
    try {
      const u = await login({ role, identifier: identifier.trim(), password, captchaToken });
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

  const fillDemo = () => { setIdentifier(DEMO[role].id); setPassword(DEMO[role].pw); setError(''); };

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

          <label className="label" htmlFor="identifier">{current.idLabel}</label>
          <div className="input-wrap">
            <UserRound size={17} />
            <input
              id="identifier" className="input input--icon" value={identifier} autoComplete="username"
              onChange={(e) => setIdentifier(e.target.value)} placeholder="Enter your ID or email" autoFocus
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

          {error && <div className="alert" role="alert"><AlertCircle size={16} /> {error}</div>}

          <button type="submit" className="btn btn--primary btn--block" disabled={busy}>
            {busy ? <span className="spinner spinner--sm spinner--light" /> : <LogIn size={17} />} Sign in as {current.label}
          </button>

          {import.meta.env.DEV && (
            <button type="button" className="login__demo" onClick={fillDemo}>
              Development only: fill demo {current.label} credentials
            </button>
          )}
        </form>
      </main>
    </div>
  );
}

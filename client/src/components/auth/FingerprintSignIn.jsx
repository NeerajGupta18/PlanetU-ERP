import { useState } from 'react';
import { AlertCircle, Fingerprint, KeyRound, UserPlus, X } from 'lucide-react';
import { accountKey, enableFingerprint, forgetAccount, savedAccounts, setDeclined } from '../../lib/fingerprint.js';
import { useAuth } from '../../context/AuthContext.jsx';

const ROLE_NAMES = { admin: 'Admin', student: 'Student', employee: 'Employee', parent: 'Parent' };
const initials = (name) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('');

/**
 * Android app sign-in page, when this phone has saved accounts: tap one, touch the sensor, and you are in.
 * "Use password instead" and "Switch account" are always there.
 */
export function SavedAccounts({ onSignedIn, onUsePassword, onSwitchAccount }) {
  const { loginWithFingerprint } = useAuth();
  const [accounts, setAccounts] = useState(savedAccounts);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');

  const unlock = async (a) => {
    setError(''); setBusy(a.key);
    try {
      onSignedIn(await loginWithFingerprint(a));
    } catch (err) {
      setBusy(null);
      if (err.code === 'USE_PASSWORD') { onUsePassword(a); return; }
      // The token is gone (expired, removed, password changed): straight to the password, with the reason
      if (['DEVICE_INVALID', 'DEVICE_EXPIRED'].includes(err.code || err.data?.code)) { onUsePassword(a, err.message); return; }
      setError(err.message);
    }
  };

  const forget = async (a) => {
    await forgetAccount(a.key);
    const left = savedAccounts();
    setAccounts(left);
    if (!left.length) onSwitchAccount();
  };

  return (
    <div className="fp">
      <h2>Welcome back</h2>
      <p className="login__hint">Tap your account, then touch the fingerprint sensor.</p>
      <ul className="fp__list">
        {accounts.map((a) => (
          <li key={a.key} className="fp__row">
            <button type="button" className="fp__account" onClick={() => unlock(a)} disabled={Boolean(busy)}>
              <span className="fp__avatar" aria-hidden="true">{initials(a.name)}</span>
              <span className="fp__who">
                <strong>{a.name}</strong>
                <small>{ROLE_NAMES[a.role] || a.role} · {a.loginId}{a.institute ? ` · ${a.institute}` : ''}</small>
              </span>
              {busy === a.key ? <span className="spinner spinner--sm" /> : <Fingerprint size={22} aria-hidden="true" className="fp__icon" />}
            </button>
            <button type="button" className="fp__forget" onClick={() => forget(a)} disabled={Boolean(busy)}
              aria-label={`Forget ${a.name} on this phone`} title="Forget on this phone">
              <X size={16} />
            </button>
          </li>
        ))}
      </ul>
      {error && <div className="alert" role="alert"><AlertCircle size={16} /> {error}</div>}
      <div className="fp__actions">
        <button type="button" className="btn btn--outline" onClick={() => onUsePassword(accounts[0])} disabled={Boolean(busy)}>
          <KeyRound size={16} /> Use password instead
        </button>
        <button type="button" className="btn btn--outline" onClick={onSwitchAccount} disabled={Boolean(busy)}>
          <UserPlus size={16} /> Switch account
        </button>
      </div>
    </div>
  );
}

/** Right after a password sign-in in the Android app: "Use fingerprint next time?" Saying no is remembered. */
export function FingerprintOffer({ tenantCode, user, institute, onDone }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const key = accountKey(tenantCode, user);

  const yes = async () => {
    setError(''); setBusy(true);
    try {
      await enableFingerprint(tenantCode, user, institute);
      onDone();
    } catch (err) {
      setBusy(false);
      setError(String(err?.code) === '16' ? 'Fingerprint was not turned on. You can turn it on later from "Fingerprint and phones".'
        : err.message || 'Could not turn on fingerprint. Please try again.');
    }
  };
  const no = () => { setDeclined(key, true); onDone(); };

  return (
    <div className="fp fp--offer">
      <span className="fp__badge" aria-hidden="true"><Fingerprint size={30} /></span>
      <h2>Use fingerprint next time?</h2>
      <p className="login__hint">
        Next time you open the app, tap your name and touch the sensor instead of typing your password.
        Your password is not saved on this phone, and you can switch this off at any time.
      </p>
      {error && <div className="alert" role="alert"><AlertCircle size={16} /> {error}</div>}
      <div className="form-actions fp__offer-actions">
        <button type="button" className="btn btn--outline" onClick={no} disabled={busy}>Not now</button>
        <button type="button" className="btn btn--primary" onClick={yes} disabled={busy}>
          {busy ? <span className="spinner spinner--sm spinner--light" /> : <Fingerprint size={17} />} Use fingerprint
        </button>
      </div>
    </div>
  );
}

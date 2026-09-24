import { useEffect, useRef, useState } from 'react';
import { Check, RefreshCw, ShieldCheck } from 'lucide-react';
import { api } from '../../api/http.js';

const TOKEN_LIFETIME_MS = 110_000; // server token lasts 2 minutes; reset a little earlier
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

/* ---------------------------------------------------------------------- *
 * Google reCAPTCHA v2 loader.
 * The script is only fetched once even if RobotCheck mounts more than once
 * (e.g. React StrictMode). window.grecaptcha is Google's own global API.
 *
 * IMPORTANT: with ?render=explicit, the script tag's own `load` event fires
 * as soon as the file finishes downloading - but Google's internal setup
 * (window.grecaptcha.render etc.) can still be a beat behind that, which is
 * what caused "window.grecaptcha.render is not a function". The fix is to
 * use Google's documented `onload=<callbackName>` query param: Google calls
 * that global function itself only once grecaptcha is fully ready.
 * ---------------------------------------------------------------------- */
let recaptchaScriptPromise = null;
function loadRecaptchaScript() {
  if (window.grecaptcha?.render) return Promise.resolve();
  if (!recaptchaScriptPromise) {
    recaptchaScriptPromise = new Promise((resolve, reject) => {
      const callbackName = '__onRecaptchaLoad';
      window[callbackName] = () => resolve();
      const s = document.createElement('script');
      s.src = `https://www.google.com/recaptcha/api.js?onload=${callbackName}&render=explicit`;
      s.async = true;
      s.defer = true;
      s.onerror = () => reject(new Error('Could not load reCAPTCHA. Check your connection.'));
      document.head.appendChild(s);
    });
  }
  return recaptchaScriptPromise;
}

/**
 * "I'm not a robot" checkbox.
 *  - onChange(token | null) tells the parent whether the human check is currently passed.
 *  - Change `resetKey` to force the widget back to its unchecked state (e.g. after a failed login).
 *
 * Which widget renders is decided by the server (GET /auth/captcha/config):
 *  - { provider: 'recaptcha', siteKey } -> renders the real Google widget below.
 *  - { provider: 'custom' } (or the request fails) -> falls back to the
 *    built-in behaviour-based check, unchanged from before.
 */
export default function RobotCheck({ onChange, resetKey = 0 }) {
  const [config, setConfig] = useState(null); // null while loading
  const [status, setStatus] = useState('idle'); // idle | verifying | challenge | verified
  const [challenge, setChallenge] = useState(null);
  const [answer, setAnswer] = useState('');
  const [message, setMessage] = useState('');
  const [website, setWebsite] = useState(''); // honeypot: real users never see or fill this

  const mountedAt = useRef(Date.now());
  const interactions = useRef(0);
  const expiry = useRef(null);
  const widgetHost = useRef(null); // div reCAPTCHA renders into
  const widgetId = useRef(null); // id grecaptcha.render() returns

  // Ask the server which provider is active.
  useEffect(() => {
    let alive = true;
    api.get('/auth/captcha/config')
      .then((res) => { if (alive) setConfig(res); })
      .catch(() => { if (alive) setConfig({ provider: 'custom' }); }); // safe fallback
    return () => { alive = false; };
  }, []);

  // Count real user activity on the page (only used by the custom check).
  useEffect(() => {
    const bump = () => { interactions.current += 1; };
    const events = ['pointerdown', 'pointermove', 'keydown', 'touchstart', 'scroll'];
    events.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    return () => events.forEach((e) => window.removeEventListener(e, bump));
  }, []);

  const markVerified = (token) => {
    setStatus('verified'); setChallenge(null); setMessage('');
    onChange(token);
    clearTimeout(expiry.current);
    expiry.current = setTimeout(() => {
      setStatus('idle'); onChange(null);
      setMessage('Verification expired. Tick the box again.');
      if (config?.provider === 'recaptcha' && widgetId.current != null) {
        window.grecaptcha?.reset(widgetId.current);
      }
    }, TOKEN_LIFETIME_MS);
  };

  // Reset (e.g. after a failed login - captcha tokens are single-use).
  useEffect(() => {
    clearTimeout(expiry.current);
    setStatus('idle'); setChallenge(null); setAnswer(''); setMessage('');
    onChange(null);
    if (config?.provider === 'recaptcha' && widgetId.current != null) {
      window.grecaptcha?.reset(widgetId.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  useEffect(() => () => clearTimeout(expiry.current), []);

  /* ---------------- Google reCAPTCHA v2 path ---------------- */
  useEffect(() => {
    if (config?.provider !== 'recaptcha' || !widgetHost.current || widgetId.current != null) return;
    let cancelled = false;
    loadRecaptchaScript()
      .then(() => {
        if (cancelled || !widgetHost.current) return;
        widgetId.current = window.grecaptcha.render(widgetHost.current, {
          sitekey: config.siteKey,
          callback: async (recaptchaToken) => {
            setStatus('verifying');
            try {
              const res = await api.post('/auth/captcha/verify', { recaptchaToken });
              markVerified(res.token);
            } catch (err) {
              setStatus('idle'); setMessage(err.message);
              window.grecaptcha?.reset(widgetId.current);
            }
          },
          'expired-callback': () => {
            setStatus('idle'); onChange(null);
            setMessage('Verification expired. Tick the box again.');
          },
          'error-callback': () => {
            setStatus('idle'); onChange(null);
            setMessage('reCAPTCHA could not load. Check your connection and try again.');
          },
        });
      })
      .catch((err) => setMessage(err.message));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config]);

  if (config?.provider === 'recaptcha') {
    return (
      <div className="robot robot--recaptcha">
        <div ref={widgetHost} />
        {status === 'verifying' && <p className="robot__msg">Checking…</p>}
        {message && <p className="robot__msg" role="alert">{message}</p>}
      </div>
    );
  }

  /* ---------------- Built-in custom check path (default/fallback) ---------------- */

  const onCheck = async (e) => {
    if (status === 'verifying' || status === 'verified') return;
    setStatus('verifying'); setMessage('');
    try {
      const [res] = await Promise.all([
        api.post('/auth/captcha/verify', {
          elapsedMs: Date.now() - mountedAt.current,
          interactions: interactions.current,
          trusted: e.nativeEvent.isTrusted,
          website,
        }),
        sleep(700),
      ]);
      if (res.token) markVerified(res.token);
      else { setChallenge(res.challenge); setStatus('challenge'); }
    } catch (err) {
      setStatus('idle'); setMessage(err.message);
    }
  };

  const submitAnswer = async () => {
    if (!answer.trim()) return;
    try {
      const res = await api.post('/auth/captcha/challenge', { id: challenge.id, answer: answer.trim() });
      markVerified(res.token);
    } catch (err) {
      setMessage(err.message);
      setAnswer('');
      if (err.data?.challenge) setChallenge(err.data.challenge);
    }
  };

  const newChallenge = async () => {
    try {
      const res = await api.get('/auth/captcha/challenge');
      setChallenge(res.challenge); setAnswer(''); setMessage('');
    } catch (err) { setMessage(err.message); }
  };

  return (
    <div className="robot">
      <div className={`robot__box ${status === 'verified' ? 'is-verified' : ''}`}>
        <button
          type="button" role="checkbox" aria-checked={status === 'verified'} aria-label="I'm not a robot"
          className={`robot__check is-${status}`} onClick={onCheck}
          disabled={status === 'verifying' || status === 'verified'}
        >
          {status === 'verifying' && <span className="robot__spinner" />}
          {status === 'verified' && <Check size={20} strokeWidth={3.2} />}
        </button>
        <span className="robot__label">I'm not a robot</span>
        <span className="robot__brand"><ShieldCheck size={26} /><small>Human check</small></span>
      </div>

      <input
        type="text" name="website" value={website} onChange={(e) => setWebsite(e.target.value)}
        tabIndex={-1} autoComplete="off" aria-hidden="true" className="hp"
      />

      {status === 'challenge' && challenge && (
        <div className="robot__challenge">
          <p>One quick check before you continue: <strong>{challenge.prompt}</strong></p>
          <div className="robot__row">
            <input
              className="input" inputMode="numeric" value={answer} placeholder="Your answer" aria-label="Captcha answer"
              onChange={(e) => setAnswer(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submitAnswer(); } }}
            />
            <button type="button" className="btn btn--primary btn--sm" onClick={submitAnswer}>Verify</button>
            <button type="button" className="icon-btn" onClick={newChallenge} aria-label="New question"><RefreshCw size={16} /></button>
          </div>
        </div>
      )}
      {message && <p className="robot__msg" role="alert">{message}</p>}
    </div>
  );
}

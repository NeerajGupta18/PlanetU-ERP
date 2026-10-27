import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import { api } from '../api/http.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useFetch } from '../hooks/useFetch.js';
import { ROLE_HOME } from '../config/menu.config.js';
import { Card, FormError } from '../components/ui/Ui.jsx';
import { DataBoundary } from '../components/ui/Feedback.jsx';

/**
 * First sign-in for a parent: what the institute keeps and why, and the parent's answer for each purpose.
 * ProtectedRoute sends a parent here until the required purpose is agreed; the answer is kept with its time.
 */
export default function Consent() {
  const { user, institute, refresh, logout } = useAuth();
  const navigate = useNavigate();
  const { data, loading, error, reload } = useFetch('/me/consent');
  const [answers, setAnswers] = useState({});
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const name = institute?.name || 'Your institute';

  const submit = async (e) => {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      await api.post('/me/consent', { answers });
      await refresh();
      navigate(ROLE_HOME[user.role], { replace: true });
    } catch (e2) { setErr(e2); } finally { setBusy(false); }
  };

  return (
    <div className="public-page" style={{ maxWidth: 560 }}>
      <header className="public-page__head"><span className="banner__icon"><ShieldCheck size={22} aria-hidden="true" /></span>
        <div><h1>Before you begin</h1>
          <p>{name} keeps some details about you and your child. Please read what and why, then choose.</p></div></header>
      <DataBoundary loading={loading} error={error} data={data} reload={reload}>
        {data && (
          <Card>
            <form onSubmit={submit}>
              <FormError error={err} />
              <ul className="checks">
                {data.purposes.map((p) => (
                  <li key={p.key}>
                    <input id={`consent-${p.key}`} type="checkbox" className="consent__box" checked={!!answers[p.key]}
                      onChange={(e) => setAnswers((a) => ({ ...a, [p.key]: e.target.checked }))} />
                    <span>
                      <label htmlFor={`consent-${p.key}`}><strong>{p.label}</strong> {p.required ? <small>(needed to use the app)</small> : <small>(your choice)</small>}</label>
                      <small>{p.detail}</small>
                    </span>
                  </li>
                ))}
              </ul>
              <p className="consent__note">
                Your answer is saved with the date and time. Only {name} and the people it allows can see your child's details.
                Read the <Link to="/privacy" target="_blank">privacy notice</Link>. To change your answer later, contact the office.
              </p>
              <p className="consent__note">
                The office may use AI assistants to prepare drafts, such as a fee reminder or an attendance note. They see only student codes and first names, never phone numbers, emails or addresses, and a staff member checks and approves every message before it is sent.
              </p>
              {!answers.records && <p className="form-hint" style={{ marginTop: 12 }}>Tick the first box to continue. The app cannot show your child's details without it.</p>}
              <div className="form-actions">
                <button type="button" className="btn btn--outline" onClick={() => logout()}>Sign out</button>
                <button className="btn btn--primary" disabled={busy || !answers.records}>{busy ? 'Saving...' : 'Agree and continue'}</button>
              </div>
            </form>
          </Card>
        )}
      </DataBoundary>
    </div>
  );
}

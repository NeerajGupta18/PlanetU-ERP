import { Link } from 'react-router-dom';
import { AlertCircle, Inbox, RefreshCw } from 'lucide-react';

export function FullPageLoader() {
  return (
    <div className="fullpage-loader" role="status" aria-label="Loading">
      <span className="spinner spinner--lg" />
    </div>
  );
}

export function Loader({ label = 'Loading...' }) {
  return (
    <div className="loader" role="status">
      <span className="spinner" /> <span>{label}</span>
    </div>
  );
}

/**
 * How to fix a failed request, by its HTTP status - so an error never stops at "Something went wrong".
 * Returns null when the server's own message already says what to do (400, 409, 422 ...).
 */
export function fixHint(error) {
  const status = error?.status;
  if (status === 0) return 'Check your internet connection, then try again.';
  if (status === 401) return 'Your session ended. Sign in again to carry on.';
  if (status === 403) return 'Your role cannot do this. Ask your institute admin to give you access.';
  if (status === 404) return 'It may have been removed. Go back to the list and open it again.';
  if (status === 413) return 'The file is too large. Choose a smaller file or a compressed copy.';
  if (status === 429) return 'Too many tries in a short time. Wait a minute, then try again.';
  if (status >= 500) return 'This is a problem on our side. Try again in a minute; if it keeps happening, contact support.';
  return null;
}

export function ErrorState({ error, onRetry }) {
  const fix = fixHint(error);
  return (
    <div className="state state--error" role="alert">
      <AlertCircle size={28} aria-hidden="true" />
      <p>{error?.message || 'Something went wrong.'}</p>
      {fix && <p className="state__fix">{fix}</p>}
      {onRetry && (
        <button type="button" className="btn btn--outline btn--sm" onClick={onRetry}>
          <RefreshCw size={14} aria-hidden="true" /> Try again
        </button>
      )}
    </div>
  );
}

/**
 * "Nothing here yet" - and what to do about it. Every empty state needs a `hint` saying what fills this space,
 * and an `action` when the person can do it: { label, to } (a link), { label, onClick } (a button), or any element.
 * `compact` is the one-line version for a small card or a table inside a card.
 */
export function EmptyState({ title, hint, action, icon: Icon = Inbox, compact }) {
  if (import.meta.env?.DEV && !hint && !action) console.warn(`EmptyState "${title}" says nothing about what to do next - add a hint or an action.`);
  let act = null;
  if (action && action.label) {
    act = action.to
      ? <Link className="btn btn--primary btn--sm" to={action.to}>{action.label}</Link>
      : <button type="button" className="btn btn--primary btn--sm" onClick={action.onClick}>{action.label}</button>;
  } else if (action) act = action;
  return (
    <div className={`state ${compact ? 'state--compact' : ''}`}>
      <Icon size={compact ? 20 : 30} aria-hidden="true" />
      <strong>{title}</strong>
      {hint && <p>{hint}</p>}
      {act && <div className="state__action">{act}</div>}
    </div>
  );
}

/** Shows loader / error / children depending on a useFetch() result. */
export function DataBoundary({ loading, error, data, reload, children }) {
  if (error && !data) return <ErrorState error={error} onRetry={reload} />;
  if (loading && !data) return <Loader />;
  return children;
}

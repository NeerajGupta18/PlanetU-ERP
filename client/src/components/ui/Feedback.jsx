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

export function ErrorState({ error, onRetry }) {
  return (
    <div className="state state--error" role="alert">
      <AlertCircle size={28} />
      <p>{error?.message || 'Something went wrong.'}</p>
      {onRetry && (
        <button type="button" className="btn btn--outline btn--sm" onClick={onRetry}>
          <RefreshCw size={14} /> Try again
        </button>
      )}
    </div>
  );
}

/**
 * "Nothing here yet" - with the next step when there is one. `action` is { label, to } (a link) or
 * { label, onClick } (a button), or any element.
 */
export function EmptyState({ title, hint, action, icon: Icon = Inbox }) {
  let act = null;
  if (action && action.label) {
    act = action.to
      ? <Link className="btn btn--primary btn--sm" to={action.to}>{action.label}</Link>
      : <button type="button" className="btn btn--primary btn--sm" onClick={action.onClick}>{action.label}</button>;
  } else if (action) act = action;
  return (
    <div className="state">
      <Icon size={30} aria-hidden="true" />
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

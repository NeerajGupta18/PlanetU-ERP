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

export function EmptyState({ title, hint }) {
  return (
    <div className="state">
      <Inbox size={30} />
      <strong>{title}</strong>
      {hint && <p>{hint}</p>}
    </div>
  );
}

/** Shows loader / error / children depending on a useFetch() result. */
export function DataBoundary({ loading, error, data, reload, children }) {
  if (error && !data) return <ErrorState error={error} onRetry={reload} />;
  if (loading && !data) return <Loader />;
  return children;
}

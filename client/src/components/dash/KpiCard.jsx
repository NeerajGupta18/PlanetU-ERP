import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, ArrowDown, ArrowUp, Minus, RefreshCw } from 'lucide-react';
import { useFetch } from '../../hooks/useFetch.js';
import { Sparkline } from './Charts.jsx';

const ARROW = { up: ArrowUp, down: ArrowDown, same: Minus };

/**
 * The one KPI card of every dashboard: a big value, its label, the change on an earlier period (arrow, words and a
 * colour that says whether that is good or bad), a sparkline, a one-line meaning on hover, and a click through to the
 * page with the detail. `value` is what shows (it can be a compact form), `full` is the exact figure in the title.
 * state: 'loading', 'empty' (with `emptyHint`) or 'error' (with `fix`, saying how to put it right).
 */
export function KpiCard({ label, value, full, meaning, change, spark, sparkLabel, to, sub, state, emptyHint, fix }) {
  const Arrow = change && ARROW[change.dir];
  const none = state === 'empty' || value === null || value === undefined;
  const body = state === 'loading' ? (
    <>
      <span className="kpi__skeleton kpi__skeleton--value" />
      <span className="kpi__skeleton" />
      <span className="sr-only">Loading {label}</span>
    </>
  ) : state === 'error' ? (
    <>
      <span className="kpi__label">{label}</span>
      <span className="kpi__error"><AlertCircle size={14} aria-hidden="true" /> Could not load this.</span>
      {fix && <span className="kpi__sub">{fix}</span>}
    </>
  ) : (
    <>
      <span className="kpi__top">
        <span className={`kpi__value ${none ? 'kpi__value--none' : ''}`} title={full || undefined}>{none ? 'No data yet' : value}</span>
        {!none && spark && <Sparkline values={spark} label={sparkLabel || `Recent trend for ${label}`} />}
      </span>
      <span className="kpi__label">{label}</span>
      {none && emptyHint && <span className="kpi__sub">{emptyHint}</span>}
      {!none && change && <span className={`kpi__change kpi__change--${change.tone}`}><Arrow size={13} aria-hidden="true" />{change.text}</span>}
      {!none && sub && <span className="kpi__sub">{sub}</span>}
    </>
  );
  return to && state !== 'loading'
    ? <Link to={to} className="kpi kpi--link" title={meaning}>{body}</Link>
    : <div className="kpi" title={meaning}>{body}</div>;
}

export const KpiGrid = ({ children, narrow, three }) => <div className={`kpi-grid ${narrow ? 'kpi-grid--narrow' : ''} ${three ? 'kpi-grid--three' : ''}`}>{children}</div>;

/** A row of waiting cards while the dashboard's one request is on its way, so nothing jumps when it lands. */
export const KpiLoading = ({ count = 6 }) => (
  <KpiGrid>{Array.from({ length: count }, (_, i) => <KpiCard key={i} label="figures" state="loading" />)}</KpiGrid>
);

/** "Updated 10:42" and the refresh button. */
export function Freshness({ at, loading, onRefresh }) {
  const time = at ? new Date(at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false }) : null;
  return (
    <div className="fresh">
      {time && <span aria-live="polite">Updated {time}</span>}
      <button type="button" className="btn btn--outline btn--sm fresh__btn" onClick={onRefresh} disabled={loading} aria-label="Refresh the figures">
        <RefreshCw size={14} aria-hidden="true" className={loading ? 'is-spinning' : ''} /> Refresh
      </button>
    </div>
  );
}

/** One dashboard's single request. refresh() asks the server to skip its short memory. */
export function useDashboard(path) {
  const [fresh, setFresh] = useState(0);
  const state = useFetch(fresh ? `${path}?fresh=${fresh}` : path);
  return { ...state, refresh: () => setFresh((n) => n + 1) };
}

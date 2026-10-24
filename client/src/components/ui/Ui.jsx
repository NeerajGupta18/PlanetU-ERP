import { createContext, createElement, useContext, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, AlertTriangle, CheckCircle2, ChevronDown, Info } from 'lucide-react';

export function PageBanner({ icon: Icon, title, subtitle, actions }) {
  return (
    <header className="banner">
      <div className="banner__main">
        {Icon && <span className="banner__icon"><Icon size={22} /></span>}
        <div>
          <h1 className="banner__title">{title}</h1>
          {subtitle && <p className="banner__sub">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="banner__actions">{actions}</div>}
    </header>
  );
}

/* Dashboards wrap their sections in <CollapsibleCards>: every Card inside then gets a drop-down arrow (KPI cards are not Cards, so they stay put). */
const CollapseContext = createContext(false);
export function CollapsibleCards({ children }) {
  return <CollapseContext.Provider value>{children}</CollapseContext.Provider>;
}
const COLLAPSE_KEY = 'planetu.collapsed';
const readClosed = (key) => { try { return !!JSON.parse(localStorage.getItem(COLLAPSE_KEY) || '{}')[key]; } catch { return false; } };
const saveClosed = (key, v) => {
  try { const m = JSON.parse(localStorage.getItem(COLLAPSE_KEY) || '{}'); if (v) m[key] = 1; else delete m[key]; localStorage.setItem(COLLAPSE_KEY, JSON.stringify(m)); } catch { /* private mode: the card still opens and closes */ }
};

export function Card({ title, icon: Icon, action, children, className = '', collapsible }) {
  const inDashboard = useContext(CollapseContext);
  const can = (collapsible ?? inDashboard) && !!title;
  // The remembered state is per card name, ignoring counts such as "To do (4)"
  const key = typeof title === 'string' ? title.replace(/\s*\(.*\)\s*$/, '') : null;
  const [closed, setClosed] = useState(() => (can && key ? readClosed(key) : false));
  const toggle = () => setClosed((c) => { if (key) saveClosed(key, !c); return !c; });
  const heading = <>{Icon && <Icon size={17} />} {title}</>;
  return (
    <section className={`card ${className} ${can ? 'card--collapsible' : ''} ${can && closed ? 'is-closed' : ''}`}>
      {(title || action) && (
        <div className="card__head">
          {can ? (
            <h2 className="card__title card__title--toggle">
              <button type="button" className="card__toggle" aria-expanded={!closed} onClick={toggle}>{heading}</button>
            </h2>
          ) : <h2 className="card__title">{heading}</h2>}
          {action}
          {can && (
            <button type="button" className="card__chevron" aria-label={`${closed ? 'Show' : 'Hide'} ${typeof title === 'string' ? title : 'section'}`} aria-expanded={!closed} onClick={toggle}>
              <ChevronDown size={18} />
            </button>
          )}
        </div>
      )}
      {!(can && closed) && children}
    </section>
  );
}

/**
 * A KPI card. It is neutral (no color) unless `status` says the number needs attention or is good news:
 *   status: 'bad' (overdue, a problem) | 'warn' (needs action soon) | 'good' (done, all paid) | 'info' | 'clear' (nothing to do)
 * `hint` is the short word shown under the label, such as "Needs action" or "All clear", so meaning is never color only.
 * `to` makes the whole card a link to the filtered list behind the number. `tone` is the old decorative prop and is ignored.
 */
export function StatCard({ value, label, icon: Icon, status = 'neutral', hint, sub, to }) {
  const empty = value === null || value === undefined || value === '' || value === '-';
  const body = (
    <>
      <div className="stat__body">
        <div className="stat__value">{empty ? <span className="muted">No data yet</span> : value}</div>
        <div className="stat__label">{label}</div>
        {sub && <div className="stat__sub">{sub}</div>}
        {hint && <div className="stat__hint">{STATUS_ICON[status] && createElement(STATUS_ICON[status], { size: 13, 'aria-hidden': true })}{hint}</div>}
      </div>
      {Icon && <span className="stat__icon" aria-hidden="true"><Icon size={19} strokeWidth={1.8} /></span>}
    </>
  );
  const cls = `stat stat--${status}`;
  return to ? <Link to={to} className={cls}>{body}</Link> : <div className={cls}>{body}</div>;
}

const STATUS_ICON = { bad: AlertCircle, warn: AlertTriangle, good: CheckCircle2, clear: CheckCircle2, info: Info };

/** Picks a KPI status from a count of things waiting: nothing waiting is "All clear", otherwise it needs action. */
export const pending = (n, { level = 'warn', clear = 'All clear', act = 'Needs action' } = {}) => (
  Number(n) > 0 ? { status: level, hint: act } : { status: 'clear', hint: clear }
);

export const Badge = ({ tone = 'gray', children, className = '' }) => (
  <span className={`badge badge--${tone} ${className}`}>{children}</span>
);

export function Field({ label, children }) {
  return (
    <div className="field-view">
      <dt>{label}</dt>
      <dd>{children || '-'}</dd>
    </div>
  );
}

export function Tabs({ tabs, active, onChange }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map(({ id, label, icon: Icon }) => (
        <button
          key={id} type="button" role="tab" aria-selected={active === id}
          className={`tabs__item ${active === id ? 'is-active' : ''}`} onClick={() => onChange(id)}
        >
          {Icon && <Icon size={15} />} {label}
        </button>
      ))}
    </div>
  );
}

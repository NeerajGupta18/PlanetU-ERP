import { createElement } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, AlertTriangle, CheckCircle2, Info } from 'lucide-react';

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

export function Card({ title, icon: Icon, action, children, className = '' }) {
  return (
    <section className={`card ${className}`}>
      {(title || action) && (
        <div className="card__head">
          <h2 className="card__title">{Icon && <Icon size={17} />} {title}</h2>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

/**
 * A KPI card. It is neutral (no color) unless `status` says the number needs attention or is good news:
 *   status: 'bad' (overdue, a problem) | 'warn' (needs action soon) | 'good' (done, all paid) | 'info' | 'clear' (nothing to do)
 * `hint` is the short word shown under the label, such as "Needs action" or "All clear", so meaning is never color only.
 * `to` makes the whole card a link to the filtered list behind the number. `tone` is the old decorative prop and is ignored.
 */
export function StatCard({ value, label, icon: Icon, status = 'neutral', hint, to }) {
  const empty = value === null || value === undefined || value === '' || value === '-';
  const body = (
    <>
      <div className="stat__body">
        <div className="stat__value">{empty ? <span className="muted">No data yet</span> : value}</div>
        <div className="stat__label">{label}</div>
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

import { Children, cloneElement, createContext, createElement, isValidElement, useContext, useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2, ChevronDown, Info } from 'lucide-react';
import StepBar from './StepBar.jsx';
import { fixHint } from './Feedback.jsx';

/** A button given as { label, to | href | onClick, icon, disabled } - a router link, a plain link or a button. */
function ActionButton({ action, className }) {
  const { label, to, href, onClick, icon: Icon, disabled } = action;
  const inner = <>{Icon && <Icon size={16} aria-hidden="true" />}{label}</>;
  if (to) return <Link className={className} to={to}>{inner}</Link>;
  if (href) return <a className={className} href={href} target="_blank" rel="noreferrer">{inner}</a>;
  return <button type="button" className={className} onClick={onClick} disabled={disabled}>{inner}</button>;
}

/**
 * The one page header every screen uses. It answers "where am I?" and "what next?":
 *   title     what the page is
 *   subtitle  one line on what it is for
 *   next      "what next" - a short line such as "3 fee receipts to approve", or { text, to } to make it a link
 *   primary   the page's one primary button: { label, to | onClick, icon }
 *   actions   secondary buttons (outline style) - any elements
 *   back      { to, label } - a back link above the title for pages inside a list ("Students")
 *   steps     props for <StepBar> when the page is part of a process; its `next` button then replaces `primary`
 */
export function PageHeader({ icon: Icon, title, subtitle, next, primary, actions, back, steps }) {
  const nextLine = typeof next === 'string' ? { text: next } : next;
  return (
    <>
      <header className="banner">
        <div className="banner__main">
          {Icon && <span className="banner__icon" aria-hidden="true"><Icon size={22} /></span>}
          <div className="banner__text">
            {back && <Link className="banner__back" to={back.to}><ArrowLeft size={14} aria-hidden="true" /> {back.label}</Link>}
            <h1 className="banner__title">{title}</h1>
            {subtitle && <p className="banner__sub">{subtitle}</p>}
            {nextLine?.text && (nextLine.to
              ? <Link className="banner__next" to={nextLine.to}><span className="banner__next-dot" aria-hidden="true" />Next: {nextLine.text} <ArrowRight size={14} aria-hidden="true" /></Link>
              : <p className="banner__next"><span className="banner__next-dot" aria-hidden="true" />Next: {nextLine.text}</p>)}
          </div>
        </div>
        {(actions || (primary && !steps?.next)) && (
          <div className="banner__actions">
            {actions}
            {primary && !steps?.next && <ActionButton action={primary} className="btn btn--primary" />}
          </div>
        )}
      </header>
      {steps && <StepBar {...steps} />}
    </>
  );
}

/** The older name of PageHeader - pages that still say <PageBanner> get the same header. */
export const PageBanner = PageHeader;

/**
 * A labelled form field: the label above, a hint under it, and the error right under the field saying how to fix it.
 *   <FormField label="Phone" hint="10 digits, no spaces" error={errors.phone} required>
 *     <input className="input" value={...} onChange={...} />
 *   </FormField>
 * The input gets its id, aria-describedby and aria-invalid from here, so do not set an id on it.
 */
export function FormField({ label, hint, error, required, full, children }) {
  const id = useId();
  const only = Children.count(children) === 1 && isValidElement(children) ? children : null;
  const fieldId = only?.props.id || `${id}-f`;
  const described = [hint && `${id}-h`, error && `${id}-e`].filter(Boolean).join(' ') || undefined;
  return (
    <div className={`form-field ${full ? 'form-field--full' : ''} ${error ? 'has-error' : ''}`}>
      <label className="label" htmlFor={only ? fieldId : undefined}>
        {label}{required && <span className="form-field__req" aria-hidden="true"> *</span>}
      </label>
      {only ? cloneElement(only, { id: fieldId, required: only.props.required ?? required, 'aria-describedby': described, 'aria-invalid': error ? true : undefined }) : children}
      {hint && <p className="form-hint" id={`${id}-h`}>{hint}</p>}
      {error && <p className="field-error" id={`${id}-e`} role="alert"><AlertCircle size={14} aria-hidden="true" />{error}</p>}
    </div>
  );
}

/**
 * The error box at the top of a form, for a save that failed. Shows the server's message and, when it knows,
 * how to fix it ("Check your internet connection, then try again").
 */
export function FormError({ error }) {
  if (!error) return null;
  const message = typeof error === 'string' ? error : error.message;
  const fix = typeof error === 'string' ? null : fixHint(error);
  return (
    <div className="form-error" role="alert">
      <AlertCircle size={16} aria-hidden="true" />
      <div>{message}{fix && <div className="form-error__fix">{fix}</div>}</div>
    </div>
  );
}

/**
 * The buttons at the foot of every form, always in the same order: Cancel on the left, the one primary button on the right.
 *   <FormActions submit="Save changes" busy={busy} onCancel={onClose} />
 * `children` go between them (an extra outline button such as "Save and add another").
 */
export function FormActions({ submit = 'Save', busyLabel = 'Saving...', busy, disabled, onCancel, cancel = 'Cancel', children }) {
  return (
    <div className="form-actions">
      {onCancel && <button type="button" className="btn btn--outline" onClick={onCancel}>{cancel}</button>}
      {children}
      <button type="submit" className="btn btn--primary" disabled={busy || disabled}>{busy ? busyLabel : submit}</button>
    </div>
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

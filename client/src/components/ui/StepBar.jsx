import { Link } from 'react-router-dom';
import { ArrowRight, Check, Lock } from 'lucide-react';
import { PROCESSES } from '../../config/processes.js';

/**
 * The step bar every process shows: where it stands, who it is waiting on, and the one next thing to do.
 *
 *   <StepBar process="fees" current="collect"
 *            waitingOn="Accounts office"
 *            next={{ hint: '12 students still owe the term fee', label: 'Collect fees', to: '/admin/fees?tab=collect' }} />
 *
 * process    a name from config/processes.js (or pass `steps` = [{ key, label }] and `title` yourself)
 * current    the key of the step being worked on now
 * done       keys that are finished; by default every step before `current`
 * blocked    keys that cannot start yet (shown with a lock and "Not ready yet")
 * reached    the furthest key the person may jump back to; earlier steps become clickable
 * links      { key: '/path' } makes a reached step a link; or `onGo(key)` makes it a button
 * waitingOn  who has the job now ("Admissions office", "Class teacher")
 * next       { hint, label, to | onClick } - the brass "Next" line and button. When a page has a step bar
 *            with `next`, that button is the page's one primary action: do not add another primary button.
 */
export default function StepBar({
  process, steps: ownSteps, title: ownTitle, current, done, blocked = [], reached,
  links = {}, onGo, waitingOn, next, label,
}) {
  const steps = ownSteps || PROCESSES[process]?.steps || [];
  const title = ownTitle ?? PROCESSES[process]?.title;
  if (!steps.length) return null;
  const at = Math.max(0, steps.findIndex((s) => s.key === current));
  const reachedAt = reached === undefined ? at : Math.max(at, steps.findIndex((s) => s.key === reached));
  const isDone = (s, i) => (done ? done.includes(s.key) : i < at);
  const now = steps[at];

  return (
    <nav className="stepbar" aria-label={label || `${title || 'Process'} steps`}>
      <p className="stepbar__now">
        {title && <span className="stepbar__title">{title}</span>}
        <span>Step {at + 1} of {steps.length}: <strong>{now.label}</strong></span>
      </p>
      <ol className="stepbar__list">
        {steps.map((s, i) => {
          const state = i === at ? 'current' : blocked.includes(s.key) ? 'blocked' : isDone(s, i) ? 'done' : 'todo';
          const can = i !== at && i <= reachedAt && state !== 'blocked' && (links[s.key] || onGo);
          const inner = (
            <>
              <span className="stepbar__dot">
                {state === 'done' ? <Check size={14} strokeWidth={3} /> : state === 'blocked' ? <Lock size={12} /> : i + 1}
              </span>
              <span className="stepbar__label">{s.label}</span>
              <span className="sr-only">
                {state === 'done' ? ' (done)' : state === 'blocked' ? ' (not ready yet)' : state === 'current' ? ' (now)' : ''}
              </span>
            </>
          );
          const common = { className: 'stepbar__btn', 'aria-current': i === at ? 'step' : undefined };
          return (
            <li key={s.key} className={`stepbar__step is-${state}`}>
              {can && links[s.key] ? <Link to={links[s.key]} {...common}>{inner}</Link>
                : <button type="button" {...common} disabled={!can} onClick={can ? () => onGo(s.key) : undefined}>{inner}</button>}
            </li>
          );
        })}
      </ol>
      {(waitingOn || next) && (
        <div className="stepbar__next">
          <p className="stepbar__next-text">
            {waitingOn && <span>Waiting on: <strong>{waitingOn}</strong></span>}
            {next?.hint && <span>Next: <strong>{next.hint}</strong></span>}
          </p>
          {next?.label && (next.to
            ? <Link className="btn btn--next" to={next.to}>{next.label} <ArrowRight size={16} aria-hidden="true" /></Link>
            : <button type="button" className="btn btn--next" onClick={next.onClick} disabled={next.disabled}>{next.label} <ArrowRight size={16} aria-hidden="true" /></button>)}
        </div>
      )}
    </nav>
  );
}

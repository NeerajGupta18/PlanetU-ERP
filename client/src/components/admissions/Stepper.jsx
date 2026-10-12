import { Check } from 'lucide-react';

/**
 * The progress bar of the admission form. A step the applicant has already reached can be clicked to go back to it.
 *   steps = [{ n: 1, title: 'Course' }, ...]   current = the step being shown   reached = furthest step so far
 */
export default function Stepper({ steps, current, reached, onGo }) {
  const now = steps.find((s) => s.n === current);
  return (
    <nav className="stepper" aria-label="Application steps">
      <p className="stepper__now">Step {current} of {steps.length} - <strong>{now?.title}</strong></p>
      <ol className="stepper__list">
        {steps.map((s) => {
          const done = s.n < current || (s.n < reached && s.n !== current);
          const can = s.n <= reached && s.n !== current;
          return (
            <li key={s.n} className={`stepper__step ${s.n === current ? 'is-current' : ''} ${done ? 'is-done' : ''}`}>
              <button type="button" disabled={!can} onClick={() => onGo(s.n)} aria-current={s.n === current ? 'step' : undefined}>
                <span className="stepper__dot">{done ? <Check size={14} /> : s.n}</span>
                <span className="stepper__label">{s.title}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

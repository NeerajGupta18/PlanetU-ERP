import StepBar from '../ui/StepBar.jsx';

/**
 * The progress bar of the admission form - the shared StepBar with the form's numbered steps.
 * A step the applicant has already reached can be clicked to go back to it.
 *   steps = [{ n: 1, title: 'Course' }, ...]   current = the step being shown   reached = furthest step so far
 */
export default function Stepper({ steps, current, reached, onGo }) {
  const done = steps.filter((s) => s.n < current || (s.n < reached && s.n !== current)).map((s) => String(s.n));
  return (
    <StepBar
      label="Application steps"
      steps={steps.map((s) => ({ key: String(s.n), label: s.title }))}
      current={String(current)}
      reached={String(Math.max(reached || current, current))}
      done={done}
      onGo={(key) => onGo(Number(key))}
    />
  );
}

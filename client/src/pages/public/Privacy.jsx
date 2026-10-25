import { Link } from 'react-router-dom';
import { AlertTriangle, ShieldCheck } from 'lucide-react';
import { Card } from '../../components/ui/Ui.jsx';

// What each part says. Plain words; the institute's adviser reviews it before it is relied on.
const SECTIONS = [
  ['Who is responsible', [
    'Your institute decides what details are kept and why. PlanetU Technovision runs the software for the institute and only handles the details on its instructions.',
  ]],
  ['What is kept', [
    'For students: name, class or course, roll number, photo, date of birth, contact details, attendance, marks and results, fees paid and due, and documents given at admission.',
    'For parents and guardians: name, relation to the student, phone number and email address.',
    'For staff: name, contact details, role, timetable and attendance.',
    'For everyone who signs in: when they signed in and important actions they took, so mistakes and misuse can be traced.',
  ]],
  ['Why it is kept', [
    'To run admissions, classes, attendance, exams, fees and notices.',
    'To let parents see their own child\'s day, results and fees, and pay fees.',
    'To send reminders and notices by email, only if the parent agreed to this.',
  ]],
  ['Parent consent', [
    'The first time a parent signs in, they are asked to agree to how their child\'s details are used. The answer is saved with the date, time and purpose.',
    'A parent can ask the institute office to change their answer at any time.',
  ]],
  ['Who can see it', [
    'Only the institute\'s own staff, each according to their role, the student, and the student\'s linked parents.',
    'Details are never sold and never used for advertising. Each institute\'s details are kept apart from every other institute\'s.',
    'Online fee payments are handled by the payment provider; card and bank details are not stored in this app.',
  ]],
  ['How long it is kept', [
    'For as long as the student or staff member is with the institute, and after that only as long as the institute needs it for its records or the law requires.',
  ]],
  ['How it is protected', [
    'Passwords are stored scrambled, sign-in is protected against guessing, every connection is encrypted, and regular backups are kept.',
  ]],
  ['Your choices', [
    'You may ask the institute office to see the details kept about you or your child, to correct them, or to delete what is no longer needed.',
    'If you have a concern, contact the institute office first. They will reply and, where needed, involve PlanetU Technovision.',
  ]],
];

export default function Privacy() {
  return (
    <div className="public-page" style={{ maxWidth: 760 }}>
      <header className="public-page__head"><span className="banner__icon"><ShieldCheck size={22} aria-hidden="true" /></span>
        <div><h1>Privacy notice</h1><p>How your institute uses the details kept in this app.</p></div></header>
      <p className="site-draft" role="note"><AlertTriangle size={16} aria-hidden="true" /> Draft: to be reviewed by the institute's adviser before it is relied on.</p>
      <Card>
        <div className="site-prose">
          {SECTIONS.map(([title, paras]) => (
            <section key={title}>
              <h2>{title}</h2>
              {paras.length === 1 ? <p>{paras[0]}</p> : <ul>{paras.map((p) => <li key={p}>{p}</li>)}</ul>}
            </section>
          ))}
        </div>
      </Card>
      <p className="muted" style={{ textAlign: 'center' }}><Link to="/">Home</Link> · <Link to="/login">Sign in</Link></p>
    </div>
  );
}

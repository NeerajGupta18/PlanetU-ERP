import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  CalendarCheck, CheckCircle2, ClipboardCheck, CreditCard, FileBarChart2, GraduationCap, Rocket, ShieldCheck, Smartphone, UserPlus,
} from 'lucide-react';
import { api } from '../../api/http.js';
import { BRAND } from '../../config/brand.js';
import BrandMark from '../../components/ui/BrandMark.jsx';
import { FormError, FormField } from '../../components/ui/Ui.jsx';

// Jobs, not modules: each card says what the institute gets done
const FEATURES = [
  { icon: Rocket, title: 'Set up in about 30 minutes', text: 'A seven-step guide takes you from an empty account to your first class: logo, year, classes, fees, and a sheet import that checks every row first.' },
  { icon: UserPlus, title: 'Admissions, enquiry to enrolled', text: 'One board for every applicant. "Enrol" creates the student, the class place, the ID card and the parent invite in one go.' },
  { icon: CreditCard, title: 'Fees that collect themselves', text: 'Class-wise dues, concessions and late fees, ready-to-send reminders, online payment and receipts with your logo.' },
  { icon: ClipboardCheck, title: 'Attendance in under a minute', text: "Teachers open today's lecture and mark it in a few taps. Colleges can also use a rotating QR code." },
  { icon: FileBarChart2, title: 'Exams and report cards', text: 'Progress per paper, publish only when every mark is in, and print report cards with your name and logo.' },
  { icon: Smartphone, title: 'Parents on their phone', text: '"My child today": attendance, results, notices and fees due with a Pay button, in three taps or fewer.' },
];

// Placeholders until the price list is final: every plan says "Contact us"
const PLANS = [
  { name: 'School', who: 'Up to class 12', points: ['Admissions and fees', 'Daily register', 'Exams and report cards', 'Parent app'] },
  { name: 'College', who: 'Degree and diploma colleges', points: ['Everything in School', 'Lecture-wise attendance with QR', 'Semesters and electives', 'Placement and library'], featured: true },
  { name: 'University', who: 'Several departments or faculties', points: ['Everything in College', 'Departments and programmes', 'Hostel and transport', 'Staff roles and approvals'] },
];

const EMPTY = { name: '', institute: '', instituteType: 'college', phone: '', email: '', city: '', students: '', message: '', website: '' };

function DemoForm() {
  const [f, setF] = useState(EMPTY);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      await api.post('/site/demo-requests', f);
      setSent(true);
    } catch (e2) { setErr(e2); } finally { setBusy(false); }
  };

  if (sent) {
    return (
      <div className="site-sent" role="status">
        <CheckCircle2 size={28} aria-hidden="true" />
        <div><h3>Thank you, {f.name.split(' ')[0]}.</h3><p>We will call you within one working day to fix a time for your demo.</p></div>
      </div>
    );
  }
  return (
    <form className="site-form" onSubmit={submit} noValidate>
      <FormError error={err} />
      <div className="form-grid">
        <FormField label="Your name" required><input className="input" autoComplete="name" value={f.name} onChange={set('name')} /></FormField>
        <FormField label="Institute name" required><input className="input" autoComplete="organization" value={f.institute} onChange={set('institute')} /></FormField>
        <FormField label="Kind of institute" required>
          <select className="input" value={f.instituteType} onChange={set('instituteType')}>
            <option value="school">School</option><option value="college">College</option>
            <option value="university">University</option><option value="other">Other</option>
          </select>
        </FormField>
        <FormField label="Number of students" hint="A rough figure is fine"><input className="input" inputMode="numeric" value={f.students} onChange={set('students')} /></FormField>
        <FormField label="Phone" required hint="We call to fix a time"><input className="input" type="tel" autoComplete="tel" value={f.phone} onChange={set('phone')} /></FormField>
        <FormField label="Email" required><input className="input" type="email" autoComplete="email" value={f.email} onChange={set('email')} /></FormField>
        <FormField label="City"><input className="input" autoComplete="address-level2" value={f.city} onChange={set('city')} /></FormField>
        <FormField label="Anything we should know?" full><textarea className="input" rows={3} value={f.message} onChange={set('message')} /></FormField>
      </div>
      {/* Hidden from people; bots that fill it are ignored */}
      <input className="site-hp" tabIndex={-1} autoComplete="off" aria-hidden="true" value={f.website} onChange={set('website')} name="website" />
      <p className="form-hint">We use these details only to arrange your demo. See the <Link to="/privacy">privacy notice</Link>.</p>
      <div className="form-actions"><button className="btn btn--primary btn--lg" disabled={busy}>{busy ? 'Sending...' : 'Book a demo'}</button></div>
    </form>
  );
}

/** The public front page: what the product does, pricing, and a demo request. Signed-out web visitors land here. */
export default function Landing() {
  return (
    <div className="site">
      <header className="site-nav">
        <Link to="/" className="site-nav__brand"><BrandMark size={30} /> <span>{BRAND.short} Campus ERP</span></Link>
        <nav aria-label="Page sections" className="site-nav__links">
          <a href="#features">Features</a><a href="#pricing">Pricing</a><a href="#demo">Book a demo</a>
        </nav>
        <Link to="/login" className="btn btn--outline">Sign in</Link>
      </header>

      <section className="site-hero">
        <div className="site-hero__inner">
          <p className="site-eyebrow"><GraduationCap size={16} aria-hidden="true" /> For schools, colleges and universities</p>
          <h1>Run your whole campus, one clear step at a time</h1>
          <p className="site-hero__lead">Admissions, fees, attendance, exams and a parent app, in one place, with your institute's name and logo on every screen and receipt.</p>
          <div className="site-hero__cta">
            <a href="#demo" className="btn btn--primary btn--lg">Book a demo</a>
            <a href="#features" className="site-hero__more">See what it does</a>
          </div>
          <ul className="site-hero__points">
            <li><CheckCircle2 size={16} aria-hidden="true" /> Works on any phone and laptop</li>
            <li><CheckCircle2 size={16} aria-hidden="true" /> Each institute's data kept apart</li>
            <li><CheckCircle2 size={16} aria-hidden="true" /> Android app for parents and staff</li>
          </ul>
        </div>
      </section>

      <main>
        <section id="features" className="site-section">
          <h2>What your staff get done</h2>
          <p className="site-section__lead">Every task is a short process with a step bar, so everyone always knows what comes next.</p>
          <div className="site-grid">
            {FEATURES.map(({ icon: Icon, title, text }) => (
              <article key={title} className="site-card">
                <span className="site-card__icon" aria-hidden="true"><Icon size={20} /></span>
                <h3>{title}</h3><p>{text}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="pricing" className="site-section">
          <h2>Pricing</h2>
          <p className="site-section__lead">Priced per institute by size. Tell us about yours and we will send a clear quote.</p>
          <div className="site-grid site-grid--3">
            {PLANS.map((p) => (
              <article key={p.name} className={`site-card site-plan ${p.featured ? 'site-plan--featured' : ''}`}>
                {p.featured && <span className="site-plan__tag">Most asked for</span>}
                <h3>{p.name}</h3><p className="muted">{p.who}</p>
                <p className="site-plan__price">Contact us</p>
                <ul>{p.points.map((x) => <li key={x}><CheckCircle2 size={15} aria-hidden="true" /> {x}</li>)}</ul>
                <a href="#demo" className="btn btn--outline">Ask for a quote</a>
              </article>
            ))}
          </div>
          <p className="site-note"><CalendarCheck size={16} aria-hidden="true" /> Start with a paid pilot for one term. We help you set up and import your data.</p>
        </section>

        <section id="demo" className="site-section">
          <div className="site-demo">
            <div className="site-demo__intro">
              <h2>Book a demo</h2>
              <p>A 30-minute walk through admission, fee receipt, attendance and results, on your phone and laptop, with your own institute's look.</p>
              <ul className="site-hero__points site-hero__points--dark">
                <li><ShieldCheck size={16} aria-hidden="true" /> No obligation</li>
                <li><CheckCircle2 size={16} aria-hidden="true" /> We call within one working day</li>
              </ul>
            </div>
            <DemoForm />
          </div>
        </section>
      </main>

      <footer className="site-foot">
        <span>{BRAND.name}</span>
        <nav aria-label="Footer"><Link to="/privacy">Privacy</Link><Link to="/login">Sign in</Link></nav>
      </footer>
    </div>
  );
}

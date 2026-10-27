import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Bot, CalendarCheck, CheckCircle2, ChevronDown, FileCheck2, Fingerprint, KeyRound, Layers, ListChecks, MessageCircleQuestion, Palette, Rocket,
  ShieldCheck, Smartphone, UsersRound,
} from 'lucide-react';
import { api } from '../../api/http.js';
import { BRAND } from '../../config/brand.js';
import BrandMark from '../../components/ui/BrandMark.jsx';
import { FormError, FormField } from '../../components/ui/Ui.jsx';
import { Laptop, MOTION_OK, Phone, Shot, useMedia, useReveal } from './landing/parts.jsx';
import Story from './landing/Story.jsx';
import { Look, Roles, SetupSteps } from './landing/Sections.jsx';
import './landing/landing.css';

// The help chat is its own chunk, fetched only when the bubble is clicked
const HelpChat = lazy(() => import('./landing/HelpChat.jsx'));

// Every line on this page must be true in the product today: no invented clients, counts, prices or hosting claims.

const PROOF = [
  { icon: Layers, text: 'For schools, colleges and universities' },
  { icon: Rocket, text: 'Seven-step setup guide' },
  { icon: Smartphone, text: 'Android app, and installs on iPhone' },
  { icon: FileCheck2, text: 'Your logo on receipts, ID cards and report cards' },
  { icon: ShieldCheck, text: "Each institute's data kept apart in the database" },
];

// Each of these is live in the ERP today (and the last one is the chat bubble on this page)
const ASSISTANTS = [
  { title: 'Ask PlanetU', who: 'Principal and admin', text: "Questions in plain words about your own institute, answered with the figures it used, plus a one-screen morning brief." },
  { title: 'Fee follow-up', who: 'Accountant', text: 'Finds overdue fees, groups them by family and drafts the reminders. Nothing goes out until you press Send.' },
  { title: 'Setup fixer', who: 'Admin', text: 'Tidies a messy student or staff sheet and explains every fix. It imports only after you approve.' },
  { title: 'Attendance watch', who: 'Class teacher and principal', text: 'Spots three absences in a row or a student near the minimum, and drafts a note to the parent for you to check.' },
  { title: 'Admissions helper', who: 'Admission office', text: 'Checks an enquiry for missing documents and duplicates and drafts the reply. Every decision stays with your staff.' },
  { title: 'Help chat', who: 'Visitors to this page', text: 'Answers questions about PlanetU from our product facts, books a demo or takes a message. It never quotes a price and hands you to a person when you ask.' },
];

const TRUST = [
  { icon: Layers, title: 'Kept apart at the source', text: "Each institute's records are separated inside the database itself (row-level security), not only on the screen." },
  { icon: UsersRound, title: 'Each role sees its own work', text: 'A parent sees their own child, a teacher their own classes, the fee office the fees.' },
  { icon: FileCheck2, title: 'Parent consent on record', text: 'Parents agree before they start, and their answer is saved with the date and time. A privacy notice explains what is kept and why.' },
  { icon: KeyRound, title: 'Careful sign-in', text: 'Passwords are stored scrambled, sign-in has an "I\'m not a robot" check, and repeated wrong tries are slowed down.' },
  { icon: ListChecks, title: 'A record of who did what', text: 'Fee, admission and exam actions are logged with the person and the time.' },
];

// Every plan says "Contact us" until the price list is final
const PLANS = [
  { name: 'School', who: 'Up to class 12', points: ['Admissions and fees', 'Daily register', 'Exams and report cards', 'Parent app'] },
  { name: 'College', who: 'Degree and diploma colleges', points: ['Everything in School', 'Lecture-wise attendance with QR', 'Semesters and electives', 'Placement and library'], featured: true },
  { name: 'University', who: 'Several departments or faculties', points: ['Everything in College', 'Departments and programmes', 'Hostel and transport', 'Staff roles and approvals'] },
];

const FAQ = [
  { q: 'Is it for schools, colleges or universities?', a: 'All three. You choose the kind of institute when it is created, and the words and screens follow: classes and a daily register for a school, semesters and lecture-wise attendance for a college.' },
  { q: 'Does it work on phones?', a: 'Yes. Every screen works on a phone. There is an Android app, and on an iPhone or a computer it can be added to the home screen from the browser.' },
  { q: 'Can we bring our existing student and staff lists?', a: 'Yes. Import them from a sheet. Every row is checked first and any problem is explained before anything is saved.' },
  { q: 'How long does setup take?', a: 'About 30 minutes with the seven-step guide once your lists are ready. For a pilot we help you set up and import your data.' },
  { q: 'Can parents pay fees online?', a: 'Online payment by UPI, card or netbanking can be switched on. Without it, parents see what is due and pay at the fee counter, and the receipt then shows in their app.' },
  { q: 'What does it cost?', a: 'It is priced per institute, by size. Book a demo or ask for a quote and we will send a clear price.' },
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
      <div className="form-actions"><button className="btn btn--next btn--lg" disabled={busy}>{busy ? 'Sending...' : 'Book a demo'}</button></div>
    </form>
  );
}

function SectionHead({ eyebrow, title, lead, id }) {
  return (
    <div className="lp-head lp-reveal">
      {eyebrow && <p className="lp-eyebrow">{eyebrow}</p>}
      <h2 id={id}>{title}</h2>
      {lead && <p className="lp-lead">{lead}</p>}
    </div>
  );
}

/** On phones, a "Book a demo" bar stays at the bottom once the hero has scrolled away, and hides at the form itself. */
function useStickyBar(heroRef, demoRef) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!('IntersectionObserver' in window)) return undefined;
    const seen = { hero: true, demo: false };
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) seen[e.target === heroRef.current ? 'hero' : 'demo'] = e.isIntersecting;
      setShow(!seen.hero && !seen.demo);
    });
    io.observe(heroRef.current);
    io.observe(demoRef.current);
    return () => io.disconnect();
  }, [heroRef, demoRef]);
  return show;
}

/** The public front page: one college year in one scroll, with real screens from the demo college. Signed-out web visitors land here. */
export default function Landing() {
  const root = useRef(null);
  const bubble = useRef(null);
  const [chat, setChat] = useState(false);
  const closeChat = () => { setChat(false); setTimeout(() => bubble.current?.focus(), 0); };
  const hero = useRef(null);
  const demo = useRef(null);
  const motion = useMedia(MOTION_OK);
  useReveal(root, motion);
  const sticky = useStickyBar(hero, demo);

  useEffect(() => {
    const prev = document.title;
    document.title = `${BRAND.short} Campus ERP | Schools, colleges and universities`;
    return () => { document.title = prev; };
  }, []);

  return (
    <div className="site lp" ref={root}>
      <a className="lp-skip" href="#main">Skip to content</a>
      <header className="lp-nav">
        <Link to="/" className="lp-nav__brand"><BrandMark size={30} src="/landing/brand-mark.webp" /> <span>{BRAND.short} Campus ERP</span></Link>
        <nav aria-label="Page sections" className="lp-nav__links">
          <a href="#year">The year</a><a href="#setup">Setup</a><a href="#roles">Roles</a><a href="#trust">Trust</a><a href="#pricing">Pricing</a>
        </nav>
        <Link to="/login" className="lp-nav__signin">Sign in</Link>
        <a href="#demo" className="btn btn--next lp-nav__cta">Book a demo</a>
      </header>

      <section className="lp-hero" ref={hero} aria-labelledby="hero-title">
        <div className="lp-hero__inner">
          <div className="lp-hero__copy">
            <p className="lp-eyebrow lp-eyebrow--light">Campus ERP for schools, colleges and universities</p>
            <h1 id="hero-title">Your whole year, one clear step at a time.</h1>
            <p className="lp-hero__lead">Admissions, fees, attendance, exams, results and a parent app in one place. Every job is a short process with one clear next step, and your institute's name and logo are on every screen and receipt.</p>
            <div className="lp-hero__cta">
              <a href="#demo" className="btn btn--next btn--lg">Book a demo</a>
              <a href="#year" className="lp-hero__more">See a year go by <ChevronDown size={16} aria-hidden="true" /></a>
            </div>
          </div>
          <figure className="lp-hero__devices">
            <Laptop><Shot eager name="admin-dashboard" alt="The admin dashboard: students present today, fees collected and overdue, and what needs attention" /></Laptop>
            <Phone className="lp-phone--over"><Shot phone eager name="phone-parent" alt="A parent's phone showing Aarav today" /></Phone>
            <figcaption>Real screens from our demo college, a sample institute with made-up students.</figcaption>
          </figure>
        </div>
      </section>

      <main id="main">
        <section className="lp-proof" aria-label="At a glance">
          <ul>{PROOF.map(({ icon: Icon, text }) => <li key={text}><Icon size={18} aria-hidden="true" /> {text}</li>)}</ul>
        </section>

        <section className="lp-section lp-section--story" aria-labelledby="year">
          <SectionHead id="year" eyebrow="One year, one scroll" title="Follow a college year from June to results"
            lead="Six moments every institute knows. Each one is a short process with a step bar, so everyone knows what comes next." />
          <Story />
        </section>

        <section className="lp-section" aria-labelledby="setup">
          <SectionHead id="setup" eyebrow="Getting started" title="Set up in about 30 minutes"
            lead="A seven-step guide takes you from an empty account to your first class. Your work is saved at every step, so you can stop and come back." />
          <SetupSteps />
        </section>

        <section className="lp-section" aria-labelledby="roles">
          <SectionHead id="roles" eyebrow="Your role, your home" title="Everyone opens to their own work"
            lead="The principal, the fee office, teachers and parents each see a home made for their job, not one long menu." />
          <Roles />
        </section>

        <section className="lp-section" aria-labelledby="look">
          <SectionHead id="look" eyebrow={<><Palette size={15} aria-hidden="true" /> Your institute, your look</>} title="Your logo and your colour, everywhere"
            lead="Pick a colour below and watch the app change, exactly as it does in the setup step." />
          <Look />
        </section>

        <section className="lp-section" aria-labelledby="assistants">
          <SectionHead id="assistants" eyebrow={<><Bot size={15} aria-hidden="true" /> Meet the assistants</>} title="They draft. You decide."
            lead="AI assistants that do real office jobs inside your own institute's data. They only prepare work; a person approves every important change. Payments, marks and admission decisions always stay with your staff." />
          <p className="lp-soon lp-reveal"><span>In your demo</span> Ask to see them working on the demo college.</p>
          <div className="lp-grid lp-grid--assist">
            {ASSISTANTS.map((a) => (
              <article key={a.title} className="lp-card lp-reveal">
                <p className="lp-card__who">{a.who}</p>
                <h3>{a.title}</h3>
                <p>{a.text}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="lp-section" aria-labelledby="trust">
          <SectionHead id="trust" eyebrow={<><Fingerprint size={15} aria-hidden="true" /> Trust</>} title="Built to keep each institute's records safe"
            lead="What is in place today, in plain words." />
          <div className="lp-grid lp-grid--trust">
            {TRUST.map(({ icon: Icon, title, text }) => (
              <article key={title} className="lp-card lp-reveal">
                <span className="lp-card__icon" aria-hidden="true"><Icon size={20} /></span>
                <h3>{title}</h3><p>{text}</p>
              </article>
            ))}
          </div>
          <p className="lp-note lp-note--plain lp-reveal">Read our <Link to="/privacy">privacy notice</Link>.</p>
        </section>

        <section className="lp-section" aria-labelledby="pricing">
          <SectionHead id="pricing" eyebrow="Plans" title="Priced for your institute"
            lead="Priced per institute, by size. Tell us about yours and we will send a clear quote." />
          <div className="lp-grid lp-grid--plans">
            {PLANS.map((p) => (
              <article key={p.name} className={`lp-card lp-plan lp-reveal ${p.featured ? 'lp-plan--featured' : ''}`}>
                {p.featured && <span className="lp-plan__tag">Most asked for</span>}
                <h3>{p.name}</h3><p className="muted">{p.who}</p>
                <p className="lp-plan__price">Contact us</p>
                <ul className="lp-ticks">{p.points.map((x) => <li key={x}><CheckCircle2 size={15} aria-hidden="true" /> {x}</li>)}</ul>
                <a href="#demo" className="btn btn--outline">Ask for a quote</a>
              </article>
            ))}
          </div>
          <p className="lp-note lp-reveal"><CalendarCheck size={16} aria-hidden="true" /> Start with a paid pilot for one term. We help you set up and import your data.</p>
        </section>

        <section className="lp-section" aria-labelledby="faq">
          <SectionHead id="faq" title="Questions people ask" />
          <div className="lp-faq lp-reveal">
            {FAQ.map((x) => (
              <details key={x.q}>
                <summary>{x.q}<ChevronDown size={18} aria-hidden="true" /></summary>
                <p>{x.a}</p>
              </details>
            ))}
          </div>
        </section>

        <section id="demo" className="lp-section" ref={demo} aria-labelledby="demo-title">
          <div className="site-demo lp-demo">
            <div className="site-demo__intro">
              <h2 id="demo-title">Book a demo</h2>
              <p>A 30-minute walk through admission, fee receipt, attendance and results, on your phone and laptop, with your own institute's look.</p>
              <ul className="lp-ticks">
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

      {chat
        ? <Suspense fallback={<div className="lp-chat lp-chat--loading" role="status">Opening the help chat...</div>}><HelpChat onClose={closeChat} /></Suspense>
        : (
          <button type="button" ref={bubble} className={`lp-bubble ${sticky ? 'lp-bubble--raised' : ''}`} onClick={() => setChat(true)} aria-haspopup="dialog">
            <MessageCircleQuestion size={22} aria-hidden="true" /> <span>Questions? <small>AI help</small></span>
          </button>
        )}

      <div className={`lp-sticky ${sticky ? 'is-shown' : ''}`} aria-hidden={!sticky}>
        <a href="#demo" className="btn btn--next btn--block" tabIndex={sticky ? 0 : -1}>Book a demo</a>
      </div>
    </div>
  );
}

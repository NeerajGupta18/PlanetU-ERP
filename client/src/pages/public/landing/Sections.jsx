import { useEffect, useRef, useState } from 'react';
import { Check, Pause, Play } from 'lucide-react';
import { processSteps } from '../../../config/processes.js';
import { SWATCHES, brandVars, whiteContrast } from '../../../lib/brandTheme.js';
import { Laptop, MOTION_OK, Phone, Shot, useMedia } from './parts.jsx';

/* ---------- Set up in about 30 minutes: the wizard's own seven steps, played one after another ---------- */
const SETUP_HINTS = {
  profile: "Your institute's name, address, logo and colour.",
  year: 'The dates of the academic year.',
  classes: 'Classes and their divisions.',
  subjects: 'Subjects, and the teacher for each one.',
  fees: 'Fee heads and the fee plan for each class.',
  import: 'Students and staff from a sheet. Every row is checked before anything is saved.',
  invite: 'Staff get their sign-ins; parents are invited when their email is known.',
};

export function SetupSteps() {
  const steps = processSteps('setup');
  const motion = useMedia(MOTION_OK);
  const box = useRef(null);
  const [step, setStep] = useState(0);
  const [inView, setInView] = useState(false);
  const [paused, setPaused] = useState(false);
  const playing = motion && inView && !paused;

  useEffect(() => {
    if (!('IntersectionObserver' in window)) return undefined;
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting), { threshold: 0.35 });
    io.observe(box.current);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    if (!playing) return undefined;
    const t = setInterval(() => setStep((s) => (s + 1) % (steps.length + 1)), 1800);
    return () => clearInterval(t);
  }, [playing, steps.length]);

  // Without motion the list is simply all seven steps, done
  const at = motion ? step : steps.length;
  const pct = Math.round((at / steps.length) * 100);
  return (
    <div className="lp-setup" ref={box}>
      <div className="lp-setup__panel">
        <div className="lp-setup__head">
          <p><strong>Institute setup</strong> <span className="muted">{at >= steps.length ? 'Ready for the first class' : `Step ${at + 1} of ${steps.length}`}</span></p>
          {motion && (
            <button type="button" className="lp-iconbtn" onClick={() => setPaused((p) => !p)} aria-label={paused ? 'Play the steps' : 'Pause the steps'}>
              {paused ? <Play size={16} aria-hidden="true" /> : <Pause size={16} aria-hidden="true" />}
            </button>
          )}
        </div>
        <div className="lp-setup__bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Setup progress">
          <span style={{ transform: `scaleX(${pct / 100})` }} />
        </div>
        <ol className="lp-setup__steps">
          {steps.map((s, i) => (
            <li key={s.key} className={i < at ? 'is-done' : i === at ? 'is-current' : ''}>
              <span className="lp-setup__num" aria-hidden="true">{i < at ? <Check size={14} /> : i + 1}</span>
              <div><strong>{s.label}</strong><p>{SETUP_HINTS[s.key]}</p></div>
            </li>
          ))}
        </ol>
      </div>
      <Laptop className="lp-setup__shot"><Shot name="setup" alt="The setup page: seven steps done and the profile and logo form" /></Laptop>
    </div>
  );
}

/* ---------- Your role, your home ---------- */
const ROLES = [
  {
    id: 'principal', label: 'Principal', head: 'The whole institute on one page',
    points: ['Students present today, against last week', 'Fees collected, still to collect and overdue', 'Everything waiting for a decision, with the next step'],
    laptop: { name: 'principal', alt: "The principal's institute overview: 95% present today, fees collected and overdue, students below 75%" },
  },
  {
    id: 'accountant', label: 'Accountant', head: 'Money in, and what is still owed',
    points: ['Collected today and this month', 'Overdue fees and how many students to follow up', "This month's payroll"],
    laptop: { name: 'accountant', alt: "The accountant's home: collected today and this month, overdue fees, payroll" },
  },
  {
    id: 'teacher', label: 'Teacher', head: "Today's lectures, ready to mark",
    points: ["Today's lectures, each with its own Mark button", 'Answers to grade and papers waiting for marks', 'Their students below 75% attendance'],
    laptop: { name: 'teacher', alt: "A teacher's home: the daily attendance step bar and today's two lectures" },
    phone: { name: 'phone-marking', alt: 'Marking attendance on a phone' },
  },
  {
    id: 'parent', label: 'Parent', head: 'Their child today, and nothing more',
    points: ["Today's classes, present or absent", 'Fees due and the one next thing to do', 'Results, report cards and notices'],
    phone: { name: 'phone-parent', alt: "A parent's phone showing Aarav today" },
  },
];

export function Roles() {
  const [tab, setTab] = useState(0);
  const tabs = useRef([]);
  const onKey = (e) => {
    const move = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
    if (e.key === 'Home' || e.key === 'End' || move) {
      e.preventDefault();
      const next = e.key === 'Home' ? 0 : e.key === 'End' ? ROLES.length - 1 : (tab + move + ROLES.length) % ROLES.length;
      setTab(next);
      tabs.current[next]?.focus();
    }
  };
  const r = ROLES[tab];
  return (
    <div className="lp-roles">
      <div className="lp-tabs" role="tablist" aria-label="Choose a role" onKeyDown={onKey}>
        {ROLES.map((x, i) => (
          <button key={x.id} ref={(el) => { tabs.current[i] = el; }} type="button" role="tab" id={`role-tab-${x.id}`}
            aria-selected={i === tab} aria-controls="role-panel" tabIndex={i === tab ? 0 : -1} onClick={() => setTab(i)}>
            {x.label}
          </button>
        ))}
      </div>
      <div className="lp-roles__panel" role="tabpanel" id="role-panel" aria-labelledby={`role-tab-${r.id}`} key={r.id}>
        <div className="lp-roles__copy">
          <h3>{r.head}</h3>
          <ul className="lp-ticks">{r.points.map((p) => <li key={p}><Check size={16} aria-hidden="true" /> {p}</li>)}</ul>
        </div>
        <div className={`lp-roles__devices ${r.laptop ? '' : 'lp-roles__devices--phone'}`}>
          {r.laptop && <Laptop><Shot name={r.laptop.name} alt={r.laptop.alt} /></Laptop>}
          {r.phone && <Phone className={r.laptop ? 'lp-phone--over' : 'lp-phone--solo'}><Shot phone name={r.phone.name} alt={r.phone.alt} /></Phone>}
        </div>
      </div>
    </div>
  );
}

/* ---------- Your institute, your look: the same swatches and the same readability rule as the setup step ---------- */
const NAMES = { '#1E3A5F': 'Navy', '#0F766E': 'Teal', '#7F1D1D': 'Maroon', '#14532D': 'Forest green', '#4C1D95': 'Violet', '#9A3412': 'Rust', '#1E40AF': 'Royal blue', '#334155': 'Slate' };

export function Look() {
  const [color, setColor] = useState('#0F766E');
  const tooLight = whiteContrast(color) < 4.5;
  const mixes = typeof CSS !== 'undefined' && CSS.supports?.('color', 'color-mix(in srgb, red 50%, white)');
  const shown = tooLight ? '#1E3A5F' : color;
  const style = mixes ? brandVars(shown) : { '--brand': shown };
  return (
    <div className="lp-look">
      <div className="lp-look__controls">
        <div className="swatches" role="radiogroup" aria-label="Try a colour">
          {SWATCHES.map((c) => (
            <button key={c} type="button" role="radio" aria-checked={color === c} aria-label={NAMES[c]}
              className={`swatch ${color === c ? 'is-active' : ''}`} style={{ background: c }} onClick={() => setColor(c)} />
          ))}
          <label className="swatch-custom">
            <input type="color" value={color} onChange={(e) => setColor(e.target.value.toUpperCase())} aria-label="Pick any colour" />
            <span>Any colour</span>
          </label>
        </div>
        <p className={tooLight ? 'field-error' : 'form-hint'} role={tooLight ? 'alert' : undefined}>
          {tooLight
            ? 'Too light: white writing on it would be hard to read. The app asks for a darker shade, just like this.'
            : 'Buttons, the menu and the step bars take your colour. The brass "next step" button stays the same, so it always stands out.'}
        </p>
      </div>

      <div className="lp-mini" style={style} aria-label="Preview of the app in the chosen colour" role="img">
        <div className="lp-mini__top">
          <img src="/landing/demo-logo.png" alt="" width="28" height="28" />
          <strong>Horizon College of Technology</strong>
        </div>
        <div className="lp-mini__body">
          <ul className="lp-mini__menu" aria-hidden="true">
            <li className="is-on">Dashboard</li><li>Admissions</li><li>Fees</li><li>Attendance</li><li>Exams</li>
          </ul>
          <div className="lp-mini__main" aria-hidden="true">
            <p className="lp-mini__label">Fee cycle <span>Step 4 of 7: Remind</span></p>
            <div className="lp-mini__steps">
              {[1, 2, 3, 4, 5, 6, 7].map((n) => <span key={n} className={n < 4 ? 'is-done' : n === 4 ? 'is-current' : ''}>{n < 4 ? <Check size={11} /> : n}</span>)}
            </div>
            <div className="lp-mini__next">
              <span>Next: <b>90 students overdue</b></span>
              <span className="btn btn--next btn--sm">Send reminders</span>
            </div>
            <div className="lp-mini__row">
              <span className="btn btn--primary btn--sm">Record payment</span>
              <span className="btn btn--outline btn--sm">Receipt</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

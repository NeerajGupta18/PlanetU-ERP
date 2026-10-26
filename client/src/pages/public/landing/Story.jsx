import { useEffect, useRef, useState } from 'react';
import { Laptop, MOTION_OK, Phone, Shot, useMedia } from './parts.jsx';

// One college year in one scroll. Every chapter shows a real screen from the demo college.
const CHAPTERS = [
  {
    id: 'admissions', when: 'June', title: 'Admissions', head: 'From enquiry to enrolled, on one board',
    text: 'Each applicant sits in the column for their step: enquiry, application, documents checked, decision. "Enrol" creates the student, the class place, the ID card and the parent invite in one go.',
    laptop: { name: 'admissions', alt: 'Admissions board with five new enquiries in the first column' },
  },
  {
    id: 'fees', when: 'July', title: 'Fees', head: 'A fee cycle that says what comes next',
    text: 'Seven steps from fee plans to the day-end summary. The office sees what is overdue, sends ready-made reminders, takes the payment and hands over a receipt with your logo.',
    laptop: { name: 'fees', alt: 'Fees page: the fee cycle step bar, money collected this month, still to collect and overdue' },
  },
  {
    id: 'attendance', when: 'Every day', title: 'Attendance', head: 'A lecture marked in under a minute',
    text: "The teacher opens today's lecture on the phone and taps only who is absent; everyone else is present. Colleges can also use a rotating QR code.",
    laptop: { name: 'teacher', alt: "A teacher's home: today's lectures, one submitted with 38 of 40 attended" },
    phone: { name: 'phone-marking', alt: 'Marking attendance on a phone: 2 absent, 38 present, Review and submit' },
  },
  {
    id: 'exams', when: 'November', title: 'Exams', head: 'Publish only when every mark is in',
    text: 'Each paper shows its progress. "Before you publish" lists exactly what is missing, and publishing stays locked until the exam is complete.',
    laptop: { name: 'exam-check', alt: 'A mid-semester exam with its step bar and the Before you publish checklist' },
  },
  {
    id: 'results', when: 'December', title: 'Results', head: 'Results reach families the moment you publish',
    text: "Pass rate, class average and every student's marks on one page. Print all the report cards, with your logo, in one go.",
    laptop: { name: 'exam-published', alt: 'A published exam: 40 students, 97.5% pass rate, class average and marks per paper' },
    phone: { name: 'phone-results', alt: "A student's results on a phone: CGPA, grades and a report card button" },
  },
  {
    id: 'parent', when: 'All year', title: 'Parent', head: '"My child today", on the parent\'s phone',
    text: "Today's classes with present or absent, fees due with the one next thing to do, the latest result and notices, in three taps or fewer.",
    phone: { name: 'phone-parent', alt: "A parent's phone: Aarav today, the next step to pay fees, and today's classes marked present" },
  },
];

const N = CHAPTERS.length;

function Devices({ chapter }) {
  return (
    <div className="lp-story__devices">
      {chapter.laptop && <Laptop><Shot name={chapter.laptop.name} alt={chapter.laptop.alt} /></Laptop>}
      {chapter.phone && <Phone className={chapter.laptop ? 'lp-phone--over' : 'lp-phone--solo'}><Shot phone name={chapter.phone.name} alt={chapter.phone.alt} /></Phone>}
    </div>
  );
}

function ChapterText({ c, i }) {
  return (
    <>
      <p className="lp-story__when"><span>{String(i + 1).padStart(2, '0')}</span> {c.when} · {c.title}</p>
      <h3>{c.head}</h3>
      <p>{c.text}</p>
    </>
  );
}

/** Phones, tablets and reduced motion: one card per chapter, stacked, with a simple fade-in. */
function StackedStory() {
  return (
    <ol className="lp-story__cards">
      {CHAPTERS.map((c, i) => (
        <li key={c.id} className="lp-story__card lp-reveal">
          <div className="lp-story__copy"><ChapterText c={c} i={i} /></div>
          <Devices chapter={c} />
        </li>
      ))}
    </ol>
  );
}

/**
 * Laptops with motion allowed: the section pins while the year moves on. Scrolling moves the progress line
 * down the months and brings in that month's screen, so the motion is the passing of the year, not decoration.
 * GSAP loads only here, so phones and reduced-motion visitors never download it.
 */
function PinnedStory() {
  const stage = useRef(null);
  const bar = useRef(null);
  const trigger = useRef(null);
  const [active, setActive] = useState(0);

  useEffect(() => {
    let ctx;
    let alive = true;
    Promise.all([import('gsap'), import('gsap/ScrollTrigger')]).then(([{ gsap }, { ScrollTrigger }]) => {
      if (!alive) return;
      gsap.registerPlugin(ScrollTrigger);
      ctx = gsap.context(() => {
        trigger.current = ScrollTrigger.create({
          trigger: stage.current,
          start: 'top top',
          end: () => `+=${Math.round(window.innerHeight * 0.7 * (N - 1))}`,
          pin: true,
          anticipatePin: 1,
          snap: { snapTo: 1 / (N - 1), duration: { min: 0.2, max: 0.5 }, delay: 0.08, ease: 'power1.inOut' },
          onUpdate: (self) => {
            if (bar.current) bar.current.style.transform = `scaleY(${self.progress})`;
            setActive(Math.min(N - 1, Math.round(self.progress * (N - 1))));
          },
        });
      }, stage);
      // the screens and fonts change the page height once they arrive
      window.addEventListener('load', () => ScrollTrigger.refresh(), { once: true });
    });
    return () => { alive = false; ctx?.revert(); trigger.current = null; };
  }, []);

  const goTo = (i) => {
    const st = trigger.current;
    if (!st) return;
    window.scrollTo({ top: st.start + ((st.end - st.start) * i) / (N - 1) + 1, behavior: 'smooth' });
  };

  return (
    <div className="lp-story__stage" ref={stage}>
      <div className="lp-story__left">
        <ol className="lp-story__rail" aria-label="The year, month by month">
          <span className="lp-story__track" aria-hidden="true"><span ref={bar} className="lp-story__fill" /></span>
          {CHAPTERS.map((c, i) => (
            <li key={c.id}>
              <button type="button" className={i === active ? 'is-active' : i < active ? 'is-done' : ''} aria-current={i === active ? 'step' : undefined} onClick={() => goTo(i)}>
                <span className="lp-story__dot" aria-hidden="true" />
                <span className="lp-story__month">{c.when}</span> {c.title}
              </button>
            </li>
          ))}
        </ol>
        <div className="lp-story__texts">
          {CHAPTERS.map((c, i) => (
            <div key={c.id} className={`lp-story__text ${i === active ? 'is-active' : ''}`} aria-hidden={i !== active}>
              <ChapterText c={c} i={i} />
            </div>
          ))}
        </div>
      </div>
      <div className="lp-story__screens">
        {CHAPTERS.map((c, i) => (
          <div key={c.id} className={`lp-story__scene ${i === active ? 'is-active' : ''}`} aria-hidden={i !== active}>
            <Devices chapter={c} />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Story() {
  const pinned = useMedia(`(min-width: 1024px) and (min-height: 640px) and ${MOTION_OK}`);
  return pinned ? <PinnedStory /> : <StackedStory />;
}

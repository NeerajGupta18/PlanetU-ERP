import { useEffect, useState } from 'react';

// Small pieces shared by the front page sections. Screens are real captures from the demo college (client/public/landing).

/** True while a media query matches, and follows changes (turning the phone, switching reduced motion on). */
export function useMedia(query) {
  const [on, setOn] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const change = () => setOn(mq.matches);
    change();
    mq.addEventListener('change', change);
    return () => mq.removeEventListener('change', change);
  }, [query]);
  return on;
}

export const MOTION_OK = '(prefers-reduced-motion: no-preference)';

/**
 * Simple fade-ins: elements with .lp-reveal fade up once as they come into view. Only when motion is allowed:
 * the hidden start state lives under .lp--motion, so without JavaScript or with reduced motion everything is simply there.
 */
export function useReveal(rootRef, enabled) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root || !enabled || !('IntersectionObserver' in window)) return undefined;
    root.classList.add('lp--motion');
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); }
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });
    root.querySelectorAll('.lp-reveal').forEach((el) => io.observe(el));
    return () => { io.disconnect(); root.classList.remove('lp--motion'); };
  }, [rootRef, enabled]);
}

/** One captured screen. Laptop captures are 1280 x 800, phone captures 780 x 1688 (390 px wide at 2x). */
export function Shot({ name, alt, phone = false, eager = false, className = '' }) {
  return (
    <img
      className={`lp-shot ${className}`} src={`/landing/${name}.webp`} alt={alt}
      width={phone ? 780 : 1280} height={phone ? 1688 : 800}
      loading={eager ? 'eager' : 'lazy'} decoding="async" fetchpriority={eager ? 'high' : undefined}
    />
  );
}

export function Laptop({ children, className = '' }) {
  return (
    <div className={`lp-laptop ${className}`}>
      <div className="lp-laptop__lid"><div className="lp-laptop__screen">{children}</div></div>
      <div className="lp-laptop__base" aria-hidden="true" />
    </div>
  );
}

export function Phone({ children, className = '' }) {
  return (
    <div className={`lp-phone ${className}`}>
      <div className="lp-phone__screen">{children}</div>
    </div>
  );
}

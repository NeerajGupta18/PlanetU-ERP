import { useEffect, useState } from 'react';
import DeviceViewer from './DeviceViewer.jsx';

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

/**
 * One captured screen. Laptop captures are 1280 x 800 with a 640 copy, phone captures 780 x 1688 with a 390 copy
 * (-sm). On phones the screens are drawn small, so `sizes` asks for the small copy even on sharp screens.
 */
export function Shot({ name, alt, phone = false, eager = false, className = '' }) {
  const [big, small] = phone ? [780, 390] : [1280, 640];
  return (
    <img
      className={`lp-shot ${className}`} src={`/landing/${name}.webp`} alt={alt}
      srcSet={`/landing/${name}-sm.webp ${small}w, /landing/${name}.webp ${big}w`}
      sizes={phone ? '(max-width: 640px) 150px, (max-width: 1023px) 220px, 270px' : '(max-width: 640px) 240px, (max-width: 1023px) 92vw, 640px'}
      width={big} height={phone ? 1688 : 800} draggable="false"
      loading={eager ? 'eager' : 'lazy'} decoding="async" fetchpriority={eager ? 'high' : undefined}
    />
  );
}

export function Laptop({ children, className = '', hint = false, label = 'A laptop showing a real screen of PlanetU' }) {
  return <DeviceViewer variant="laptop" label={label} hint={hint} className={className}>{children}</DeviceViewer>;
}

export function Phone({ children, className = '', hint = false, label = 'A phone showing a real screen of PlanetU' }) {
  return <DeviceViewer variant="phone" label={label} hint={hint} className={className}>{children}</DeviceViewer>;
}

import { useEffect, useRef, useState } from 'react';
import { MOTION_OK, useMedia } from './parts.jsx';

/**
 * A laptop or phone you can spin all the way round: the real screen on the front, sides, and a back with the PlanetU
 * mark (laptop lid) or a camera block (phone). Plain CSS 3D and pointer events, no WebGL and no library.
 *
 * The front stays in normal page flow, so the page reserves exactly the device's size and nothing jumps. touch-action
 * pan-y leaves vertical swipes to the browser, so the page always scrolls, and a sideways swipe spins the device. Only
 * transform changes, and the sway stops when the device is off screen. With reduced motion there is no sway, inertia
 * or animated reset, and it can still be turned by hand or by arrow keys.
 */
const TILT_LIMIT = 25;
const REST_TILT = { laptop: 5, phone: 0 };
const FRICTION = 0.94;
const KEY_TURN = 15;
const KEY_TILT = 5;
const DOUBLE_MS = 320;
const DRAGGED = 'planetu:device-dragged';

let hasBeenDragged = false; // the hint goes for good after the first drag on any device

const clampTilt = (v) => Math.max(-TILT_LIMIT, Math.min(TILT_LIMIT, v));

function Edges() {
  return (
    <>
      <i className="dv__edge dv__edge--left" />
      <i className="dv__edge dv__edge--right" />
      <i className="dv__edge dv__edge--top" />
      <i className="dv__edge dv__edge--bottom" />
    </>
  );
}

export default function DeviceViewer({ variant, label, hint = false, className = '', children }) {
  const motion = useMedia(MOTION_OK);
  const root = useRef(null);
  const body = useRef(null);
  const pose = useRef({ x: REST_TILT[variant], y: 0 });
  const drag = useRef(null);
  const spin = useRef({ v: 0, raf: 0, seen: true, lastUp: 0 });
  const motionRef = useRef(motion);
  motionRef.current = motion;
  const [idle, setIdle] = useState(true);
  const [showHint, setShowHint] = useState(hint && !hasBeenDragged);

  const apply = () => {
    const el = body.current;
    el.style.transform = `rotateX(${pose.current.x}deg) rotateY(${pose.current.y}deg)`;
    // Safari can paint a turned-away face on top despite backface-visibility, so the side facing away is also hidden outright
    el.classList.toggle('is-turned', Math.cos((pose.current.y * Math.PI) / 180) < 0);
  };

  // Pauses everything while off screen
  useEffect(() => {
    const el = root.current;
    if (!('IntersectionObserver' in window)) return undefined;
    const io = new IntersectionObserver(([e]) => {
      spin.current.seen = e.isIntersecting;
      el.classList.toggle('is-off', !e.isIntersecting);
    }, { threshold: 0 });
    io.observe(el);
    return () => { io.disconnect(); cancelAnimationFrame(spin.current.raf); };
  }, []);

  useEffect(() => {
    if (!hint) return undefined;
    const hide = () => setShowHint(false);
    window.addEventListener(DRAGGED, hide);
    return () => window.removeEventListener(DRAGGED, hide);
  }, [hint]);

  /** Leaves the sway from wherever it has got to, so the first touch does not make the device jump. */
  const takeOver = () => {
    if (idle && body.current) {
      const t = getComputedStyle(body.current).transform;
      if (t && t !== 'none') {
        const m = new DOMMatrix(t);
        pose.current.y = (Math.atan2(m.m31, m.m33) * 180) / Math.PI;
      }
    }
    setIdle(false);
    body.current.classList.remove('is-resetting');
    apply();
  };

  const glide = () => {
    const s = spin.current;
    cancelAnimationFrame(s.raf);
    let last = performance.now();
    const step = (now) => {
      const dt = Math.min(48, now - last); last = now;
      s.v *= FRICTION ** (dt / 16);
      if (Math.abs(s.v) < 0.005 || !s.seen) return;
      pose.current.y += s.v * dt;
      apply();
      s.raf = requestAnimationFrame(step);
    };
    s.raf = requestAnimationFrame(step);
  };

  const reset = () => {
    cancelAnimationFrame(spin.current.raf);
    setIdle(false);
    const turns = Math.round(pose.current.y / 360);
    pose.current = { x: REST_TILT[variant], y: turns * 360 };
    if (motionRef.current) body.current.classList.add('is-resetting');
    apply();
  };

  const onPointerDown = (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    cancelAnimationFrame(spin.current.raf);
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY, at: performance.now(), v: 0, moved: false };
    root.current.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x; const dy = e.clientY - d.y;
    const now = performance.now();
    if (!d.moved && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 4) return;
    if (!d.moved) {
      d.moved = true;
      takeOver();
      if (!hasBeenDragged) { hasBeenDragged = true; window.dispatchEvent(new Event(DRAGGED)); }
    }
    // Two device widths of dragging is one full turn
    const perPx = 180 / Math.max(120, root.current.clientWidth);
    pose.current.y += dx * perPx;
    if (e.pointerType === 'mouse') pose.current.x = clampTilt(pose.current.x - dy * 0.25);
    d.v = (dx * perPx) / Math.max(1, now - d.at);
    d.x = e.clientX; d.y = e.clientY; d.at = now;
    apply();
  };
  const endDrag = (e) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    const s = spin.current;
    if (d.moved) {
      if (motionRef.current && performance.now() - d.at < 80) { s.v = Math.max(-0.9, Math.min(0.9, d.v)); glide(); }
      return;
    }
    if (e.type !== 'pointerup') return;
    const now = performance.now();
    if (now - s.lastUp < DOUBLE_MS) { s.lastUp = 0; reset(); } else s.lastUp = now;
  };
  const onKeyDown = (e) => {
    const turn = { ArrowLeft: -KEY_TURN, ArrowRight: KEY_TURN }[e.key];
    const tilt = { ArrowUp: KEY_TILT, ArrowDown: -KEY_TILT }[e.key];
    if (e.key === 'Home') { e.preventDefault(); reset(); return; }
    if (turn === undefined && tilt === undefined) return;
    // At the tilt limit the up and down keys go back to scrolling the page
    if (tilt !== undefined && clampTilt(pose.current.x + tilt) === pose.current.x) return;
    e.preventDefault();
    takeOver();
    if (turn !== undefined) pose.current.y += turn;
    if (tilt !== undefined) pose.current.x = clampTilt(pose.current.x + tilt);
    apply();
  };

  const shell = variant === 'laptop' ? 'lp-laptop' : 'lp-phone';
  return (
    <div
      ref={root} tabIndex={0} role="group"
      aria-label={`${label}. Drag or use the left and right arrow keys to rotate it, up and down to tilt it, Home to reset.`}
      className={`dv dv--${variant} ${shell} ${idle && motion ? 'is-idle' : ''} ${className}`}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag}
      onKeyDown={onKeyDown}
    >
      <div className="dv__floor" aria-hidden="true" />
      <div className="dv__stage">
        <div ref={body} className="dv__body" style={{ transform: `rotateX(${REST_TILT[variant]}deg) rotateY(0deg)` }}>
          {/* Inner parts first and the screen last: where an engine does not depth-sort, plain paint order still comes out right */}
          {variant === 'laptop' ? (
            <>
              <div className="dv__base" aria-hidden="true">
                <div className="dv__under" />
                <div className="dv__deck"><i className="dv__keys" /><i className="dv__pad" /></div>
                <i className="dv__lip dv__lip--front" /><i className="dv__lip dv__lip--left" /><i className="dv__lip dv__lip--right" />
              </div>
              <Edges />
              <div className="dv__part dv__back dv__lidback" aria-hidden="true">
                <img src="/landing/brand-mark.webp" alt="" width="64" height="64" loading="lazy" draggable="false" />
                <span>PlanetU</span>
              </div>
              <div className="dv__part dv__front lp-laptop__lid"><div className="lp-laptop__screen">{children}</div></div>
            </>
          ) : (
            <>
              <div className="dv__mid" aria-hidden="true" />
              <Edges />
              <div className="dv__part dv__back dv__phoneback" aria-hidden="true">
                <i className="dv__camera"><b /><b /><b /></i>
                <img src="/landing/brand-mark.webp" alt="" width="40" height="40" loading="lazy" draggable="false" />
              </div>
              <div className="dv__part dv__front lp-phone__front"><div className="lp-phone__screen">{children}</div></div>
            </>
          )}
        </div>
      </div>
      {variant === 'laptop' && <div className="dv__room" aria-hidden="true" />}
      {showHint && <span className="dv__hint" aria-hidden="true">Drag to rotate</span>}
    </div>
  );
}

import { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Simple centered dialog. Renders nothing when `open` is false. For keyboard users it moves focus into the dialog,
 * keeps Tab inside it, closes on Escape and puts focus back where it was when it closes.
 */
export default function Modal({ open, title, onClose, children, width = 480 }) {
  const ref = useRef(null);
  const titleId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;
    const before = document.activeElement;
    const box = ref.current;
    // Focus the element marked autoFocus, else the first field, else the dialog itself
    const first = box?.querySelector('[autofocus], [data-autofocus]') || box?.querySelector('.modal__body ' + FOCUSABLE.split(', ').join(', .modal__body '));
    if (!box?.contains(document.activeElement)) (first || box)?.focus();
    const onKey = (e) => {
      // Only the dialog on top answers the keyboard (a confirm box can open over a form)
      if (box !== [...document.querySelectorAll('.modal')].pop()) return;
      if (e.key === 'Escape') { e.stopPropagation(); closeRef.current(); return; }
      if (e.key !== 'Tab' || !box) return;
      const items = [...box.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null);
      if (!items.length) return;
      const a = items[0]; const z = items[items.length - 1];
      if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
      else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
    };
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      if (before && typeof before.focus === 'function' && document.contains(before)) before.focus();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div ref={ref} className="modal" style={{ maxWidth: width }} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <div className="modal__head">
          <h3 id={titleId}>{title}</h3>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="modal__body">{children}</div>
      </div>
    </div>
  );
}

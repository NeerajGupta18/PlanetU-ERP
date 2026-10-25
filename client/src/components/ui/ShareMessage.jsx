import { useState } from 'react';
import { Check, Copy, MessageCircle } from 'lucide-react';

/**
 * A ready-to-send message: the text, a Copy button and (when there is a mobile number) a WhatsApp share link.
 * WhatsApp opens on the office's own phone or WhatsApp Web with the text filled in; nothing is sent by the app.
 *   <ShareMessage message="Dear ..." whatsapp="https://wa.me/91...?text=..." />
 */
export default function ShareMessage({ message, whatsapp, compact }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(message); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { setCopied(false); }
  };
  return (
    <div className={`share-msg ${compact ? 'share-msg--compact' : ''}`}>
      {!compact && <p className="share-msg__text">{message}</p>}
      <div className="share-msg__actions">
        <button type="button" className="btn btn--outline btn--sm" onClick={copy} aria-live="polite">
          {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />} {copied ? 'Copied' : 'Copy message'}
        </button>
        {whatsapp
          ? <a className="btn btn--outline btn--sm" href={whatsapp} target="_blank" rel="noreferrer"><MessageCircle size={14} aria-hidden="true" /> WhatsApp</a>
          : <span className="muted share-msg__none">No mobile number on record</span>}
      </div>
    </div>
  );
}

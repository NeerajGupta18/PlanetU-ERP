import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import Modal from './Modal.jsx';

/**
 * In-app replacements for the browser's confirm(), prompt() and alert().
 *
 *   const { confirm, prompt, toast } = useDialogs();
 *   if (!(await confirm('Delete this book?', { danger: true, confirmLabel: 'Delete' }))) return;
 *   const reason = await prompt('Why is this rejected?', { required: true });   // null when cancelled
 *   toast.success('Saved'); toast.error(err.message);
 *
 * confirm() resolves true / false; prompt() resolves the typed text or null.
 */
const DialogContext = createContext(null);

export const useDialogs = () => {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error('useDialogs must be used inside <DialogProvider>');
  return ctx;
};

const TOAST_ICON = { success: CheckCircle2, error: XCircle, info: Info };
const TOAST_MS = { success: 3500, info: 4000, error: 6000 };

export function DialogProvider({ children }) {
  const [dialog, setDialog] = useState(null); // { kind, message, opts, resolve }
  const [toasts, setToasts] = useState([]);
  const nextId = useRef(1);

  const open = useCallback((kind, message, opts = {}) => new Promise((resolve) => {
    setDialog({ kind, message, opts, resolve });
  }), []);

  const close = useCallback((value) => {
    setDialog((d) => { d?.resolve(value); return null; });
  }, []);

  const dismiss = useCallback((id) => setToasts((list) => list.filter((x) => x.id !== id)), []);
  const push = useCallback((tone, text) => {
    const id = nextId.current++;
    setToasts((list) => [...list.slice(-3), { id, tone, text: String(text || '') }]);
    setTimeout(() => dismiss(id), TOAST_MS[tone]);
  }, [dismiss]);

  const api = useMemo(() => ({
    confirm: (message, opts) => open('confirm', message, opts),
    prompt: (message, opts) => open('prompt', message, opts),
    toast: {
      success: (text) => push('success', text),
      error: (err) => push('error', err?.message || err),
      info: (text) => push('info', text),
    },
  }), [open, push]);

  return (
    <DialogContext.Provider value={api}>
      {children}
      {dialog && <DialogView key={dialog.message} dialog={dialog} onClose={close} />}
      <div className="toasts" aria-live="polite">
        {toasts.map((x) => {
          const Icon = TOAST_ICON[x.tone];
          return (
            <div key={x.id} className={`toast toast--${x.tone}`} role={x.tone === 'error' ? 'alert' : 'status'}>
              <Icon size={18} />
              <span>{x.text}</span>
              <button type="button" className="icon-btn" onClick={() => dismiss(x.id)} aria-label="Dismiss"><X size={14} /></button>
            </div>
          );
        })}
      </div>
    </DialogContext.Provider>
  );
}

function DialogView({ dialog, onClose }) {
  const { kind, message, opts } = dialog;
  const [text, setText] = useState(opts.defaultValue || '');
  const inputRef = useRef(null);
  const isPrompt = kind === 'prompt';
  const needsText = isPrompt && opts.required;
  const blocked = needsText && !text.trim();

  useEffect(() => { if (isPrompt) inputRef.current?.focus(); }, [isPrompt]);

  const cancel = () => onClose(isPrompt ? null : false);
  const submit = (e) => {
    e?.preventDefault();
    if (blocked) return;
    onClose(isPrompt ? text.trim() : true);
  };
  const title = opts.title || (isPrompt ? 'Please add details' : opts.danger ? 'Are you sure?' : 'Please confirm');

  return (
    <Modal open title={title} onClose={cancel} width={440}>
      <form onSubmit={submit}>
        <p className="dialog__message">
          {opts.danger && <AlertTriangle size={20} className="dialog__icon" />}
          <span>{message}</span>
        </p>
        {isPrompt && (
          opts.multiline === false ? (
            <input ref={inputRef} className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder={opts.placeholder || ''} />
          ) : (
            <textarea ref={inputRef} className="input" rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder={opts.placeholder || ''} />
          )
        )}
        <div className="form-actions">
          <button type="button" className="btn btn--outline" onClick={cancel}>{opts.cancelLabel || 'Cancel'}</button>
          <button type="submit" className={`btn ${opts.danger ? 'btn--danger' : 'btn--primary'}`} disabled={blocked} autoFocus={!isPrompt}>
            {opts.confirmLabel || (isPrompt ? 'Submit' : 'Yes, continue')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

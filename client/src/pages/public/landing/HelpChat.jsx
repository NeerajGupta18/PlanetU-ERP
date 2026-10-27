import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarCheck, CheckCircle2, MessageSquareText, Send, Sparkles, X } from 'lucide-react';
import { api } from '../../../api/http.js';
import RobotCheck from '../../../components/auth/RobotCheck.jsx';
import { FormField } from '../../../components/ui/Ui.jsx';

/**
 * The Support Help Agent: an AI assistant that answers from the product's fact sheet. Loaded only when the chat
 * bubble is clicked. It can do two things, both forms the visitor fills in: book a demo, or leave a message.
 * The "I'm not a robot" check comes before the first message.
 */

const LANGS = [['en', 'English'], ['hi', 'हिन्दी'], ['mr', 'मराठी']];
const QUICK = {
  en: ['What does PlanetU Campus ERP do?', 'Does it work on phones?', 'How long does setup take?', 'Can parents pay fees online?', 'What do the AI assistants do?', 'How much does it cost?'],
  hi: ['PlanetU Campus ERP क्या करता है?', 'क्या यह फ़ोन पर चलता है?', 'सेटअप में कितना समय लगता है?', 'क्या अभिभावक ऑनलाइन फीस भर सकते हैं?', 'AI सहायक क्या करते हैं?', 'इसकी कीमत क्या है?'],
  mr: ['PlanetU Campus ERP काय करते?', 'हे फोनवर चालते का?', 'सेटअपला किती वेळ लागतो?', 'पालक ऑनलाइन फी भरू शकतात का?', 'AI सहाय्यक काय करतात?', 'याची किंमत किती आहे?'],
};
const HELLO = {
  en: 'Hello! I am an AI assistant. I answer questions about PlanetU Campus ERP from our product facts. I never see any student\'s data.',
  hi: 'नमस्ते! मैं एक AI सहायक हूँ। मैं PlanetU Campus ERP के बारे में हमारी उत्पाद जानकारी से जवाब देता हूँ। मैं किसी विद्यार्थी का डेटा नहीं देखता।',
  mr: 'नमस्कार! मी एक AI सहाय्यक आहे. मी PlanetU Campus ERP बद्दल आमच्या उत्पादन माहितीतून उत्तरे देतो. मी कोणत्याही विद्यार्थ्याचा डेटा पाहत नाही.',
};
const DEMO_EMPTY = { name: '', institute: '', instituteType: 'college', phone: '', email: '' };
const MSG_EMPTY = { name: '', contact: '', message: '' };

export default function HelpChat({ onClose }) {
  const [lang, setLang] = useState('en');
  const [status, setStatus] = useState(null);
  const [session, setSession] = useState(null);
  const [starting, setStarting] = useState(false);
  const [log, setLog] = useState([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState('chat'); // chat | demo | message | done
  const [done, setDone] = useState('');
  const [err, setErr] = useState('');
  const panel = useRef(null);
  const input = useRef(null);
  const end = useRef(null);

  useEffect(() => { api.get('/site/chat/status').then(setStatus).catch(() => setStatus({ connected: false, maxMessage: 400 })); }, []);
  useEffect(() => { panel.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest' }); }, [log, busy, mode]);

  const start = async (captchaToken) => {
    if (!captchaToken || session || starting) return;
    setStarting(true); setErr('');
    try { setSession((await api.post('/site/chat/start', { captchaToken })).session); setTimeout(() => input.current?.focus(), 0); } catch (e) { setErr(e.message); } finally { setStarting(false); }
  };

  const send = async (message) => {
    const m = String(message ?? text).trim();
    if (!m || busy || !session) return;
    setText(''); setErr(''); setBusy(true);
    setLog((l) => [...l, { who: 'me', text: m }]);
    try {
      const r = await api.post('/site/chat/message', { session, message: m, language: lang });
      setLog((l) => [...l, { who: 'ai', text: r.reply, handover: Boolean(r.handover) }]);
    } catch (e) {
      if (e.status === 401) setSession(null);
      setLog((l) => [...l, { who: 'note', text: e.message }]);
    } finally { setBusy(false); }
  };

  const max = status?.maxMessage || 400;
  return (
    <div className="lp-chat" role="dialog" aria-modal="false" aria-labelledby="lp-chat-title" ref={panel} tabIndex={-1}>
      <header className="lp-chat__head">
        <div>
          <h2 id="lp-chat-title">PlanetU help</h2>
          <span className="ai-label"><Sparkles size={13} aria-hidden="true" /> AI assistant</span>
        </div>
        <button type="button" className="lp-chat__close" onClick={onClose} aria-label="Close the help chat"><X size={20} aria-hidden="true" /></button>
      </header>

      <div className="lp-chat__langs" role="group" aria-label="Reply language">
        {LANGS.map(([k, label]) => <button key={k} type="button" className="chip" aria-pressed={lang === k} onClick={() => setLang(k)}>{label}</button>)}
      </div>

      <div className="lp-chat__body">
        <p className="lp-chat__msg lp-chat__msg--ai">{HELLO[lang]}</p>
        {status && !status.connected && <p className="lp-chat__note" role="status">The assistant is not connected right now. You can still book a demo or leave a message, and a person will reply.</p>}

        {!session && mode === 'chat' && (
          <div className="lp-chat__check">
            <p className="muted">Please confirm you are not a robot to start.</p>
            <RobotCheck onChange={start} />
            {starting && <p className="muted" role="status">Starting...</p>}
          </div>
        )}

        <div role="log" aria-live="polite" aria-relevant="additions">
          {log.map((m, i) => (
            <div key={i} className={`lp-chat__msg lp-chat__msg--${m.who}`}>
              {m.who === 'ai' && <span className="sr-only">AI assistant: </span>}
              {m.text}
              {m.handover && mode === 'chat' && (
                <span className="lp-chat__handover">
                  <button type="button" className="btn btn--next btn--sm" onClick={() => setMode('demo')}>Book a demo</button>
                  <button type="button" className="btn btn--outline btn--sm" onClick={() => setMode('message')}>Leave a message</button>
                </span>
              )}
            </div>
          ))}
          {busy && <p className="lp-chat__msg lp-chat__msg--ai lp-chat__typing">Thinking...</p>}
        </div>

        {session && mode === 'chat' && log.length === 0 && (
          <div className="chips lp-chat__quick" aria-label="Quick questions">
            {QUICK[lang].map((qn) => <button key={qn} type="button" className="chip" disabled={busy} onClick={() => send(qn)}>{qn}</button>)}
          </div>
        )}
        {mode === 'demo' && <DemoForm session={session} onCancel={() => setMode('chat')} onDone={(t) => { setDone(t); setMode('done'); }} />}
        {mode === 'message' && <MessageForm session={session} onCancel={() => setMode('chat')} onDone={(t) => { setDone(t); setMode('done'); }} />}
        {mode === 'done' && (
          <div className="site-sent" role="status">
            <CheckCircle2 size={24} aria-hidden="true" />
            <div><p>{done}</p><button type="button" className="btn btn--outline btn--sm" onClick={() => setMode('chat')}>Back to the chat</button></div>
          </div>
        )}
        {err && <p className="form-error" role="alert">{err}</p>}
        <div ref={end} />
      </div>

      {mode === 'chat' && (
        <footer className="lp-chat__foot">
          <form className="lp-chat__form" onSubmit={(e) => { e.preventDefault(); send(); }}>
            <label htmlFor="lp-chat-input" className="sr-only">Your question</label>
            <input
              id="lp-chat-input" ref={input} className="input" value={text} maxLength={max} autoComplete="off"
              placeholder={session ? 'Ask about PlanetU...' : 'Tick "I\'m not a robot" first'} disabled={!session || busy}
              onChange={(e) => setText(e.target.value)}
            />
            <button type="submit" className="btn btn--primary lp-chat__send" disabled={!session || busy || !text.trim()} aria-label="Send"><Send size={18} aria-hidden="true" /></button>
          </form>
          <div className="lp-chat__actions">
            <button type="button" className="btn btn--outline btn--sm" disabled={!session} onClick={() => setMode('demo')}><CalendarCheck size={15} aria-hidden="true" /> Book a demo</button>
            <button type="button" className="btn btn--outline btn--sm" disabled={!session} onClick={() => setMode('message')}><MessageSquareText size={15} aria-hidden="true" /> Leave a message</button>
          </div>
          <p className="lp-chat__fine">AI answers can be wrong; our team confirms details. Do not share personal data here. <Link to="/privacy">Privacy</Link></p>
        </footer>
      )}
    </div>
  );
}

function DemoForm({ session, onCancel, onDone }) {
  const [f, setF] = useState(DEMO_EMPTY);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    try { await api.post('/site/chat/demo', { session, ...f }); onDone(`Thank you, ${f.name.split(' ')[0]}. Your demo request is in. We will call you within one working day.`); } catch (e2) { setErr(e2.message); } finally { setBusy(false); }
  };
  return (
    <form className="lp-chat__card" onSubmit={submit} noValidate>
      <h3>Book a demo</h3>
      {err && <p className="form-error" role="alert">{err}</p>}
      <FormField label="Your name" required><input className="input" autoComplete="name" value={f.name} onChange={set('name')} /></FormField>
      <FormField label="Institute name" required><input className="input" autoComplete="organization" value={f.institute} onChange={set('institute')} /></FormField>
      <FormField label="Kind of institute" required>
        <select className="input" value={f.instituteType} onChange={set('instituteType')}>
          <option value="school">School</option><option value="college">College</option><option value="university">University</option><option value="other">Other</option>
        </select>
      </FormField>
      <FormField label="Phone" required><input className="input" type="tel" autoComplete="tel" value={f.phone} onChange={set('phone')} /></FormField>
      <FormField label="Email" required><input className="input" type="email" autoComplete="email" value={f.email} onChange={set('email')} /></FormField>
      <div className="form-actions">
        <button type="button" className="btn btn--outline" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn--next" disabled={busy}>{busy ? 'Sending...' : 'Book a demo'}</button>
      </div>
    </form>
  );
}

function MessageForm({ session, onCancel, onDone }) {
  const [f, setF] = useState(MSG_EMPTY);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    try { await api.post('/site/chat/leave-message', { session, ...f }); onDone('Thank you. Your message is with our team, and a person will reply.'); } catch (e2) { setErr(e2.message); } finally { setBusy(false); }
  };
  return (
    <form className="lp-chat__card" onSubmit={submit} noValidate>
      <h3>Leave a message for our team</h3>
      {err && <p className="form-error" role="alert">{err}</p>}
      <FormField label="Your name" required><input className="input" autoComplete="name" value={f.name} onChange={set('name')} /></FormField>
      <FormField label="Phone or email" required hint="So a person can reply"><input className="input" autoComplete="email" value={f.contact} onChange={set('contact')} /></FormField>
      <FormField label="Your message" required><textarea className="input" rows={3} maxLength={1000} value={f.message} onChange={set('message')} /></FormField>
      <div className="form-actions">
        <button type="button" className="btn btn--outline" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn--primary" disabled={busy}>{busy ? 'Sending...' : 'Send message'}</button>
      </div>
    </form>
  );
}

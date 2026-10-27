/**
 * Support Help Agent: the AI-labelled chat bubble on the public landing page.
 *
 *  - Answers ONLY from one plain-text fact sheet (playbooks/support-facts.txt), on its own model key and provider
 *    (PUBLIC_LLM_*), so a busy public chat can never use up the institutes' assistants.
 *  - It can do two things, and both are forms the visitor fills in themselves: book a demo (into Demo requests)
 *    or leave a message for the team. The model has no tools and no data: whatever a visitor types, the only
 *    thing that can come back is wording.
 *  - Hands over at once, before any model call, when asked for a person, about prices, contracts or refunds, or
 *    about personal data; and after two unhelpful answers in a row. It never quotes a price.
 *  - Guards: the existing "I'm not a robot" check before the first message (a short-lived chat session), a
 *    per-connection rate limit (in the route), a message length limit, a per-session message limit, and its own
 *    daily token allowance. Every message is logged in support_chat_runs.
 */
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../src/config/env.js';
import { q, withTx } from '../src/db/pool.js';
import { HttpError } from '../src/middleware/error.js';
import { consumeCaptchaToken } from '../src/services/captcha.service.js';
import { createDemoRequest } from '../src/services/demoRequests.service.js';
import { BUSY_MESSAGE, LlmError, chat, llmStatus } from './llm.js';
import { playbook, ungroundedNumbers, untrusted } from './runner.js';
import { redactContacts } from './admissionsHelper.js';

export const MAX_MESSAGE = 400;
export const MAX_PER_SESSION = 25;
const SESSION_MINUTES = 60;
const LANGS = { en: 'English', hi: 'Hindi', mr: 'Marathi' };

/* ---------------- fixed replies (no model) ---------------- */

export const REPLIES = {
  person: {
    en: 'Of course. A person from our team will get back to you. Use "Leave a message" with your name and phone number or email, or "Book a demo".',
    hi: 'ज़रूर। हमारी टीम का कोई व्यक्ति आपसे संपर्क करेगा। अपना नाम और फ़ोन नंबर या ईमेल "संदेश छोड़ें" में लिखें, या "डेमो बुक करें" चुनें।',
    mr: 'नक्की. आमच्या टीममधील एक व्यक्ती आपल्याशी संपर्क करेल. आपले नाव आणि फोन नंबर किंवा ईमेल "संदेश ठेवा" मध्ये लिहा, किंवा "डेमो बुक करा" निवडा.',
  },
  price: {
    en: 'Prices are set per institute, by size, and our team sends a clear quote after a short talk. I cannot give prices here. Use "Book a demo" or "Leave a message" and they will get back to you.',
    hi: 'कीमत हर संस्थान के आकार के अनुसार तय होती है, और हमारी टीम छोटी बातचीत के बाद स्पष्ट कोटेशन भेजती है। मैं यहाँ कीमत नहीं बता सकता। "डेमो बुक करें" या "संदेश छोड़ें" चुनें।',
    mr: 'किंमत प्रत्येक संस्थेच्या आकारानुसार ठरते, आणि आमची टीम थोड्या चर्चेनंतर स्पष्ट कोटेशन पाठवते. मी इथे किंमत सांगू शकत नाही. "डेमो बुक करा" किंवा "संदेश ठेवा" निवडा.',
  },
  contract: {
    en: 'Contracts, billing and refunds are handled by our team, not by this chat. Use "Leave a message" and a person will reply.',
    hi: 'अनुबंध, बिलिंग और रिफंड हमारी टीम संभालती है, यह चैट नहीं। "संदेश छोड़ें" चुनें और कोई व्यक्ति जवाब देगा।',
    mr: 'करार, बिलिंग आणि परतावा आमची टीम पाहते, ही चॅट नाही. "संदेश ठेवा" निवडा आणि एक व्यक्ती उत्तर देईल.',
  },
  personal: {
    en: 'I cannot see or discuss anyone\'s personal details or records. For a student\'s records, please contact your institute\'s office. For anything else, "Leave a message" reaches our team.',
    hi: 'मैं किसी की निजी जानकारी या रिकॉर्ड नहीं देख सकता। विद्यार्थी के रिकॉर्ड के लिए अपने संस्थान के कार्यालय से संपर्क करें। बाकी किसी बात के लिए "संदेश छोड़ें" से हमारी टीम तक पहुँचें।',
    mr: 'मी कोणाचीही खाजगी माहिती किंवा नोंदी पाहू शकत नाही. विद्यार्थ्याच्या नोंदींसाठी आपल्या संस्थेच्या कार्यालयाशी संपर्क करा. इतर कशासाठी "संदेश ठेवा" वापरा.',
  },
  unknown: {
    en: 'I do not know that one, sorry. I can answer questions about what the ERP does, phones, setup, fees, attendance, exams, parents, data safety and the AI assistants.',
    hi: 'माफ़ कीजिए, इसका जवाब मुझे नहीं पता। मैं ERP के काम, फ़ोन, सेटअप, फीस, उपस्थिति, परीक्षा, अभिभावक, डेटा सुरक्षा और AI सहायकों के बारे में बता सकता हूँ।',
    mr: 'माफ करा, याचे उत्तर मला माहीत नाही. मी ERP चे काम, फोन, सेटअप, फी, उपस्थिती, परीक्षा, पालक, डेटा सुरक्षा आणि AI सहाय्यकांबद्दल सांगू शकतो.',
  },
  twice: {
    en: 'Sorry I could not help with that. Let me pass you to our team: use "Leave a message" and a person will reply, or "Book a demo".',
    hi: 'माफ़ कीजिए, मैं मदद नहीं कर सका। मैं आपको हमारी टीम तक पहुँचाता हूँ: "संदेश छोड़ें" चुनें, कोई व्यक्ति जवाब देगा, या "डेमो बुक करें"।',
    mr: 'माफ करा, मी मदत करू शकलो नाही. मी आपल्याला आमच्या टीमकडे पाठवतो: "संदेश ठेवा" निवडा, एक व्यक्ती उत्तर देईल, किंवा "डेमो बुक करा".',
  },
  capped: {
    en: 'The help chat has answered all it can for today. Please use "Book a demo" or "Leave a message" and our team will reply.',
    hi: 'आज के लिए हेल्प चैट की सीमा पूरी हो गई है। कृपया "डेमो बुक करें" या "संदेश छोड़ें" चुनें, हमारी टीम जवाब देगी।',
    mr: 'आजसाठी हेल्प चॅटची मर्यादा संपली आहे. कृपया "डेमो बुक करा" किंवा "संदेश ठेवा" निवडा, आमची टीम उत्तर देईल.',
  },
};

/* ---------------- hand-over rules (checked before any model call) ---------------- */

const RULES = [
  ['person', /\b(human|real person|a person|live (agent|person)|someone from|talk to|speak to|speak with|call me|call back|phone me|representative|customer care)\b|इंसान|व्यक्ति से|किसी से बात|बात करनी|माणसाशी|व्यक्तीशी|बोलायचे/i],
  ['price', /\b(price|prices|pricing|priced at|cost|costs|costing|how much (is|does|will|for)|charges|quote|quotation|rate card|per student|per month|per year|discount|cheaper|expensive|budget)\b|₹|\brs\.?\s?\d|\binr\b|कीमत|कितने का|दाम|किंमत|किती खर्च|किती पैसे/i],
  ['contract', /\b(contract|agreement|refund|cancel|cancellation|terms and conditions|legal|invoice|billing|payment terms|sla)\b|अनुबंध|रिफंड|करार|परतावा/i],
  ['personal', /\b(student'?s? (record|records|marks|data|details)|marks of|attendance of|result of|my (data|details|records|account)|delete my|personal (data|details|information)|aadhaa?r|password|login details)\b|आधार|पासवर्ड/i],
];

/** Which hand-over a message needs, or null. Contact details in the message count as personal data. */
export function handoverFor(text) {
  for (const [kind, re] of RULES) if (re.test(text)) return kind;
  if (redactContacts(text) !== text) return 'personal';
  return null;
}

// A reply that mentions money is never shown, whatever the fact sheet says
const MONEY = /₹|\brs\.?\s?\d|\brupees?\b|\binr\b|\blakh|\bper (month|year|student)\b|रुपये|रुपए|लाख/i;

/* ---------------- sessions (after the human check) ---------------- */

const sessions = new Map(); // sid -> { unhelpful, count, history: [{ q, a }], expires }
setInterval(() => {
  const now = Date.now();
  for (const [sid, s] of sessions) if (s.expires < now) sessions.delete(sid);
}, 60_000).unref();

/** Starts a chat after the "I'm not a robot" check. The session lasts an hour. */
export function startSession(captchaToken) {
  if (!consumeCaptchaToken(captchaToken)) throw new HttpError(400, 'Please tick "I\'m not a robot" first.');
  const sid = crypto.randomBytes(12).toString('base64url');
  sessions.set(sid, { unhelpful: 0, count: 0, history: [], expires: Date.now() + SESSION_MINUTES * 60_000 });
  return { session: jwt.sign({ typ: 'support_chat', sid }, env.JWT_SECRET, { expiresIn: `${SESSION_MINUTES}m` }) };
}

function sessionOf(token) {
  try {
    const p = jwt.verify(String(token || ''), env.JWT_SECRET);
    if (p.typ !== 'support_chat') throw new Error('wrong type');
    let s = sessions.get(p.sid);
    // After a server restart the token is still good; start a fresh memory for it
    if (!s) { s = { unhelpful: 0, count: 0, history: [], expires: p.exp * 1000 }; sessions.set(p.sid, s); }
    return { sid: p.sid, s };
  } catch {
    const e = new HttpError(401, 'The chat has timed out. Start it again.');
    e.code = 'CHAT_EXPIRED';
    throw e;
  }
}

/* ---------------- log and allowance ---------------- */

export async function publicTokensToday() {
  const { rows: [r] } = await withTx({ platform: true }, () => q(
    'select coalesce(sum(prompt_tokens + completion_tokens), 0)::int as n from support_chat_runs where created_at >= current_date',
  ));
  return r.n;
}

async function logChat({ sid, question, outcome, language, model = null, usage = { prompt: 0, completion: 0 } }) {
  const session = crypto.createHash('sha256').update(sid).digest('hex').slice(0, 32);
  await withTx({ platform: true }, () => q(
    `insert into support_chat_runs (session, question, outcome, language, model, prompt_tokens, completion_tokens)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [session, question ? String(question).slice(0, 600) : null, outcome, language, model, usage.prompt, usage.completion],
  ));
}

/* ---------------- one message ---------------- */

let facts = null;
const factSheet = () => { facts ??= playbook('support-facts'); return facts; };

/**
 * Answers one visitor message. Returns { reply, kind, handover } where kind is answered | unknown | handover |
 * capped. The visitor's own words are logged with contact details removed.
 */
export async function answer({ session, message, language = 'en' }) {
  const lang = LANGS[language] ? language : 'en';
  const { sid, s } = sessionOf(session);
  const text = String(message ?? '').replace(/\s+/g, ' ').trim();
  if (!text) throw new HttpError(400, 'Type a question first.');
  if (text.length > MAX_MESSAGE) throw new HttpError(400, `Keep your message under ${MAX_MESSAGE} characters.`);
  if (s.count >= MAX_PER_SESSION) {
    const e = new HttpError(429, 'This chat has reached its limit. Please use "Book a demo" or "Leave a message".');
    e.code = 'CHAT_LIMIT';
    throw e;
  }
  s.count += 1;
  const logged = redactContacts(text);

  const rule = handoverFor(text);
  if (rule) {
    s.unhelpful = 0;
    await logChat({ sid, question: logged, outcome: 'handover', language: lang });
    return { reply: REPLIES[rule][lang], kind: 'handover', handover: rule };
  }

  if (!llmStatus('public').connected) {
    const e = new HttpError(409, 'The help assistant is not connected right now. You can still book a demo or leave a message.');
    e.code = 'NOT_CONNECTED';
    throw e;
  }
  if ((await publicTokensToday()) >= env.PUBLIC_DAILY_TOKENS) {
    await logChat({ sid, question: logged, outcome: 'capped', language: lang });
    return { reply: REPLIES.capped[lang], kind: 'capped', handover: 'capped' };
  }

  // Earlier turns of this chat, from the server's own memory (never from the browser)
  const messages = [{ role: 'system', content: `${playbook('support')}\n\nReply in ${LANGS[lang]}.\n\nFACT SHEET:\n${factSheet()}` }];
  for (const h of s.history.slice(-3)) {
    messages.push({ role: 'user', content: untrusted('website visitor message', h.q) }, { role: 'assistant', content: h.a });
  }
  messages.push({ role: 'user', content: untrusted('website visitor message', logged) });

  let r;
  try {
    r = await chat({ channel: 'public', messages, maxTokens: 350 });
  } catch (err) {
    const outcome = err instanceof LlmError && err.code === 'busy' ? 'busy' : 'error';
    await logChat({ sid, question: logged, outcome, language: lang }).catch(() => {});
    if (err instanceof LlmError) {
      const e = err.code === 'busy' ? new HttpError(429, BUSY_MESSAGE) : new HttpError(err.code === 'not_connected' ? 409 : 424, err.code === 'not_connected' ? 'The help assistant is not connected right now. You can still book a demo or leave a message.' : err.message);
      e.code = err.code === 'busy' ? 'BUSY' : err.code === 'not_connected' ? 'NOT_CONNECTED' : 'FAILED';
      throw e;
    }
    throw err;
  }

  // Tool calls are ignored (none are offered). Unknown, money, or a number not in the fact sheet: not shown.
  let reply = String(r.message.content || '').trim();
  let kind = 'answered';
  if (!reply || /^\W*UNKNOWN\W*$/i.test(reply) || /^UNKNOWN\b/i.test(reply)) kind = 'unknown';
  else if (MONEY.test(reply)) { reply = REPLIES.price[lang]; kind = 'handover'; }
  else if (ungroundedNumbers(reply, [{ result: { facts: factSheet() } }], text).length) kind = 'unknown';

  let handover = null;
  if (kind === 'unknown') {
    s.unhelpful += 1;
    if (s.unhelpful >= 2) { reply = REPLIES.twice[lang]; handover = 'unhelpful'; s.unhelpful = 0; } else reply = REPLIES.unknown[lang];
  } else {
    s.unhelpful = 0;
    if (kind === 'handover') handover = 'price';
  }
  s.history.push({ q: logged, a: reply });
  if (s.history.length > 6) s.history.shift();
  await logChat({ sid, question: logged, outcome: handover ? 'handover' : kind, language: lang, model: r.model, usage: r.usage });
  return { reply, kind: handover ? 'handover' : kind, handover };
}

/* ---------------- the two actions: forms the visitor fills in ---------------- */

/** Book a demo from the chat: the same checks as the page's form, marked as coming from the chat. */
export async function bookDemo({ session, ...form }) {
  const { sid } = sessionOf(session);
  const r = await withTx({ platform: true }, () => createDemoRequest({ ...form, source: 'chat' }));
  await logChat({ sid, question: null, outcome: 'demo', language: null });
  return { ok: true, id: r.id };
}

const CONTACT_RE = /^([^\s@]+@[^\s@]+\.[^\s@]+|[+()\d\s-]{6,20})$/;

/** Leave a message for the team. */
export async function leaveMessage({ session, name, contact, message }) {
  const { sid } = sessionOf(session);
  const n = String(name ?? '').trim();
  const c = String(contact ?? '').trim();
  const m = String(message ?? '').trim();
  if (n.length < 2 || n.length > 100) throw new HttpError(400, 'Enter your name.');
  if (!CONTACT_RE.test(c)) throw new HttpError(400, 'Enter a phone number or an email address so we can reply.');
  if (m.length < 2) throw new HttpError(400, 'Type your message.');
  if (m.length > 1000) throw new HttpError(400, 'Shorten your message to 1,000 characters or fewer.');
  const { rows: [r] } = await withTx({ platform: true }, () => q(
    'insert into support_messages (name, contact, message) values ($1, $2, $3) returning id', [n, c, m],
  ));
  await logChat({ sid, question: null, outcome: 'message', language: null });
  return { ok: true, id: r.id };
}

/** For the vendor console. */
export async function listSupportMessages() {
  const { rows } = await q(
    `select id, name, contact, message, status, created_at as "createdAt" from support_messages
     order by (status = 'new') desc, created_at desc limit 200`,
  );
  return { messages: rows, newCount: rows.filter((r) => r.status === 'new').length };
}

export async function setSupportMessageStatus(id, status) {
  if (!['new', 'contacted', 'closed'].includes(status)) throw new HttpError(400, 'Choose new, contacted or closed.');
  const { rowCount } = await q('update support_messages set status = $2 where id = $1', [id, status]);
  if (!rowCount) throw new HttpError(404, 'That message was not found. Reload the list.');
  return { id, status };
}

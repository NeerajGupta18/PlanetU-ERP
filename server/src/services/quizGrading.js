/**
 * Pure quiz rules - no database, no clock. Questions are validated, shuffled and graded here, so the same
 * code is used when a teacher saves a quiz, when a student answers it, and in the tests.
 *
 * Question kinds (all auto-graded):
 *   single     one correct option; a wrong answer can cost `negative` x marks
 *   truefalse  like single, with the options fixed as True / False
 *   multiple   several correct options; partial credit = (right - wrong) / correct, never below zero
 *   short      free text, correct if it matches an accepted answer (case, spaces and numeric format ignored)
 * An unanswered question scores 0 and is never penalised. A quiz total never goes below 0.
 */
export const KINDS = ['single', 'multiple', 'truefalse', 'short'];
export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/** Lower-case, trimmed, single-spaced, with a trailing full stop dropped: "  Paris. " -> "paris". */
export const normText = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim().replace(/\.$/, '');

const asNumber = (s) => {
  const t = normText(s).replace(/,/g, '');
  return t !== '' && /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : null;
};

const isIndex = (v, n) => Number.isInteger(v) && v >= 0 && v < n;

/** Validates one question as typed by a teacher; returns the clean form or throws an Error with a message to show them. */
export function cleanQuestion(input, n) {
  const where = `Question ${n}`;
  const q = input || {};
  if (!KINDS.includes(q.kind)) throw new Error(`${where}: choose a question type.`);
  const text = String(q.text ?? '').trim();
  if (!text) throw new Error(`${where}: write the question.`);
  if (text.length > 1000) throw new Error(`${where}: the question is too long (1000 characters at most).`);
  const marks = Number(q.marks ?? 1);
  if (!Number.isFinite(marks) || marks <= 0 || marks > 100) throw new Error(`${where}: marks must be more than 0 and at most 100.`);
  const out = { kind: q.kind, text, marks: round2(marks), options: [], answers: [], explanation: String(q.explanation ?? '').trim().slice(0, 500) };

  if (q.kind === 'short') {
    const answers = (Array.isArray(q.answers) ? q.answers : String(q.answers ?? '').split('\n')).map((a) => String(a).trim()).filter(Boolean);
    if (!answers.length) throw new Error(`${where}: give at least one accepted answer.`);
    if (answers.some((a) => a.length > 200)) throw new Error(`${where}: an accepted answer is too long.`);
    out.answers = [...new Set(answers)].slice(0, 10);
    return out;
  }
  if (q.kind === 'truefalse') {
    const trueIsCorrect = q.options?.[0]?.correct === true;
    const falseIsCorrect = q.options?.[1]?.correct === true;
    if (trueIsCorrect === falseIsCorrect) throw new Error(`${where}: mark either True or False as the correct answer.`);
    out.options = [{ text: 'True', correct: trueIsCorrect }, { text: 'False', correct: falseIsCorrect }];
    return out;
  }
  const options = (Array.isArray(q.options) ? q.options : []).map((o) => ({ text: String(o?.text ?? '').trim(), correct: o?.correct === true }));
  if (options.length < 2) throw new Error(`${where}: give at least two options.`);
  if (options.length > 8) throw new Error(`${where}: at most 8 options.`);
  if (options.some((o) => !o.text)) throw new Error(`${where}: an option is empty.`);
  if (options.some((o) => o.text.length > 300)) throw new Error(`${where}: an option is too long (300 characters at most).`);
  if (new Set(options.map((o) => normText(o.text))).size !== options.length) throw new Error(`${where}: two options are the same.`);
  const right = options.filter((o) => o.correct).length;
  if (q.kind === 'single' && right !== 1) throw new Error(`${where}: mark exactly one option as correct.`);
  if (q.kind === 'multiple' && right < 1) throw new Error(`${where}: mark at least one option as correct.`);
  out.options = options;
  return out;
}

/** Makes a student's raw answer safe and of the right shape, or undefined when it should be treated as unanswered. */
export function cleanAnswer(question, value) {
  if (value === null || value === undefined || value === '') return undefined;
  const n = question.options.length;
  if (question.kind === 'single' || question.kind === 'truefalse') {
    return isIndex(value, n) ? value : (() => { throw new Error('That is not one of the options.'); })();
  }
  if (question.kind === 'multiple') {
    if (!Array.isArray(value)) throw new Error('Choose from the options.');
    if (!value.every((v) => isIndex(v, n))) throw new Error('That is not one of the options.');
    const set = [...new Set(value)].sort((a, b) => a - b);
    return set.length ? set : undefined;
  }
  const text = String(value).slice(0, 500);
  return text.trim() ? text : undefined;
}

/** Marks one answer. `correct` is true | 'partial' | false, or null when unanswered. */
export function gradeQuestion(question, answer, negative = 0) {
  const marks = Number(question.marks);
  if (answer === undefined || answer === null || (Array.isArray(answer) && !answer.length) || (typeof answer === 'string' && !answer.trim())) {
    return { awarded: 0, correct: null };
  }
  if (question.kind === 'single' || question.kind === 'truefalse') {
    const ok = question.options[answer]?.correct === true;
    return { awarded: ok ? marks : -round2(Number(negative) * marks), correct: ok };
  }
  if (question.kind === 'multiple') {
    const right = new Set(question.options.map((o, i) => (o.correct ? i : -1)).filter((i) => i >= 0));
    const picked = new Set(Array.isArray(answer) ? answer : []);
    const good = [...picked].filter((i) => right.has(i)).length;
    const bad = picked.size - good;
    const frac = Math.max(0, (good - bad) / right.size);
    return { awarded: round2(marks * frac), correct: frac === 1 ? true : frac > 0 ? 'partial' : false };
  }
  const given = normText(answer); const num = asNumber(answer);
  const ok = question.answers.some((a) => normText(a) === given || (num !== null && asNumber(a) === num));
  return { awarded: ok ? marks : 0, correct: ok };
}

/** Grades a whole attempt. Returns the score (floored at 0), the maximum, and each question's result. */
export function gradeAttempt(questions, answers, negative = 0) {
  const per = {}; let total = 0; let max = 0;
  for (const q of questions) {
    const r = gradeQuestion(q, answers?.[q.id], negative);
    per[q.id] = r; total += r.awarded; max += Number(q.marks);
  }
  return { score: round2(Math.max(0, total)), max: round2(max), per };
}

/** Deterministic shuffle: the same seed always gives the same order, so a reloaded page shows the same quiz. */
export function seededShuffle(items, seed) {
  let h = 2166136261;
  for (const ch of String(seed)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  const next = () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 1_000_000) / 1_000_000; };
  const a = [...items];
  for (let i = a.length - 1; i > 0; i -= 1) { const j = Math.floor(next() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/** The mark a quiz counts for, from a student's submitted attempts: their best, or their latest. */
export function countedAttempt(attempts, scoring) {
  const done = attempts.filter((a) => a.status === 'submitted' && a.score !== null);
  if (!done.length) return null;
  if (scoring === 'latest') return done.reduce((a, b) => (b.attemptNo > a.attemptNo ? b : a));
  return done.reduce((a, b) => (b.score / (b.maxScore || 1) > a.score / (a.maxScore || 1) ? b : a));
}

/** Internal marks: the quiz score scaled to the quiz's weightage (a 17/20 quiz worth 10 internal marks counts as 8.5). */
export const scaledMarks = (score, max, weightage) => (max > 0 ? round2((Number(score) / Number(max)) * Number(weightage)) : 0);

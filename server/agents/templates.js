/**
 * Message templates written by a model. The model writes wording with {placeholders} only; our code fills every
 * name, amount, date and percentage from the records, on the server, at send time.
 */

/** Why a template cannot be used, or null when it is fine. */
export function checkTemplate(t, { allowed, required, maxLength = 700 }) {
  if (typeof t !== 'string' || t.trim().length < 20) return 'too short';
  if (t.length > maxLength) return 'too long';
  if (/[0-9०-९]/.test(t)) return 'it contains digits; figures and dates must come from the records';
  if (/https?:|www\./i.test(t)) return 'it contains a web address; the link is filled in by the system';
  const used = [...t.matchAll(/\{([^{}]*)\}/g)].map((m) => m[1]);
  const unknown = used.filter((p) => !allowed.includes(p));
  if (unknown.length) return `unknown placeholder {${unknown[0]}}`;
  if (/[{}]/.test(t.replace(/\{[a-z_]+\}/g, ''))) return 'a stray curly bracket';
  const missing = required.filter((p) => !used.includes(p));
  if (missing.length) return `the {${missing[0]}} placeholder is missing`;
  return null;
}

/** The placeholders filled from records. Only ever done on the server. */
export function fillTemplate(template, values) {
  return template.replace(/\{([a-z_]+)\}/g, (m, k) => (values[k] ?? m));
}

/** The model's text without wrapping quotes. */
export const cleanDraft = (text) => String(text || '').trim().replace(/^["'“”]+|["'“”]+$/g, '');

export const LANGUAGES = { en: 'English', hi: 'Hindi', mr: 'Marathi' };

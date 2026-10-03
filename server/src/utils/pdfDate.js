import { parseISO } from './dates.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "12 Mar 2026" - the human-readable date format used across generated PDFs.
 * Accepts a 'YYYY-MM-DD'-prefixed string (our usual DATE columns) or a JS Date
 * (a raw, not-yet-serialized TIMESTAMPTZ value straight from the database). */
export const fmtDate = (value) => {
  const d = value instanceof Date ? value : parseISO(String(value).slice(0, 10));
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
};

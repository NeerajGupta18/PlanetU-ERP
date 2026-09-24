const pad = (n) => String(n).padStart(2, '0');

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseISO = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
export const addMonths = (d, n) => new Date(d.getFullYear(), d.getMonth() + n, 1);
export const startOfMonth = (d) => new Date(d.getFullYear(), d.getMonth(), 1);
export const endOfMonth = (d) => new Date(d.getFullYear(), d.getMonth() + 1, 0);
/** Monday-based week start */
export const startOfWeek = (d) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
export const todayISO = () => toISO(new Date());
export const isToday = (iso) => iso === todayISO();

export function fmtTime(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  return `${pad(h % 12 || 12)}:${pad(m)} ${h >= 12 ? 'PM' : 'AM'}`;
}
export const fmtRange = (s, e) => `${fmtTime(s)} - ${fmtTime(e)}`;

const fmt = (iso, opts) => parseISO(iso).toLocaleDateString('en-IN', opts);
export const fmtLong = (iso) => fmt(iso, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
export const fmtDay = (iso) => fmt(iso, { weekday: 'short', day: 'numeric', month: 'short' });
export const fmtDate = (iso) => fmt(iso, { day: 'numeric', month: 'short', year: 'numeric' });
export function fmtEventDates(start, end) {
  if (start === end) return fmtDate(start);
  return `${fmtDay(start)} - ${fmtDate(end)}`;
}

export function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

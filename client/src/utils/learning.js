export const ENROLL_STATUS = {
  assigned: { label: 'Not started', tone: 'gray' },
  in_progress: { label: 'In progress', tone: 'blue' },
  submitted: { label: 'Awaiting review', tone: 'amber' },
  completed: { label: 'Completed', tone: 'green' },
  rejected: { label: 'Needs resubmission', tone: 'red' },
};
export const PROVIDER_TONE = { NPTEL: 'purple', SWAYAM: 'blue', Coursera: 'blue', edX: 'blue', Udemy: 'purple', Internal: 'green', Other: 'gray' };
export const LEVEL_LABEL = { beginner: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced' };
export const STANDING = { complete: { label: 'Complete', tone: 'green' }, overdue: { label: 'Overdue', tone: 'red' }, on_track: { label: 'On track', tone: 'blue' }, none: { label: 'No compulsory work', tone: 'gray' } };
export const cr = (n) => (Number.isInteger(n) ? String(n) : Number(n).toFixed(1));
export const fileHref = (id) => `/api/files/${id}`;

export const QUIZ_STATE = {
  open: { label: 'Open', tone: 'green' }, retry: { label: 'Open: attempts left', tone: 'green' }, in_progress: { label: 'In progress', tone: 'amber' },
  upcoming: { label: 'Not open yet', tone: 'gray' }, done: { label: 'Attempted', tone: 'blue' }, missed: { label: 'Missed', tone: 'red' },
};
export const SHOW_LABEL = { after_submit: 'Show the score as soon as it is submitted', after_close: 'Show scores only after the quiz closes', never: 'Never show scores to students' };
export const KIND_LABEL = { single: 'Single answer', multiple: 'Multiple answers', truefalse: 'True / False', short: 'Short answer' };
export const fmtDateTime = (v) => (v ? new Date(v).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '-');
/** An ISO instant as the value a <input type="datetime-local"> wants (local time, no zone). */
export const toLocalInput = (v) => { if (!v) return ''; const d = new Date(v); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
export const fromLocalInput = (v) => (v ? new Date(v).toISOString() : null);
export const mmss = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const x = s % 60; return `${h ? `${h}:` : ''}${String(m).padStart(h ? 2 : 1, '0')}:${String(x).padStart(2, '0')}`; };

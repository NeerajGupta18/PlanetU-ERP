export const KIND_LABEL = { unit: 'Unit test', mid_term: 'Mid-term', term: 'Semester-end', practical: 'Practical', other: 'Other' };
export const KINDS = Object.keys(KIND_LABEL);

/** Trim trailing zeros: 90 -> "90", 72.5 -> "72.5", 36.670 -> "36.67". */
export const num = (n) => (n === null || n === undefined ? '-' : Number.isInteger(n) ? String(n) : String(+Number(n).toFixed(2)));

export const RESULT_TONE = { pass: 'green', fail: 'red', incomplete: 'gray' };
export const RESULT_LABEL = { pass: 'Pass', fail: 'Fail', incomplete: 'Incomplete' };
export const gradeTone = (s) => (s.status === 'fail' || s.status === 'absent' ? 'red' : s.status === 'pending' ? 'gray' : 'green');

/**
 * Pure grade / GPA arithmetic - no database. Everything a result shows is derived here from the raw
 * marks, so a corrected mark or an edited grading scale is reflected everywhere immediately.
 *
 * Rules:
 *  - A paper's percentage = marks / max_marks. Its grade comes from the grading scale bands.
 *  - Below the paper's pass mark (or absent) = FAIL: the paper gets the scale's lowest band and
 *    scores 0 grade points, whatever its percentage would have been.
 *  - GPA = sum(grade points x credits) / sum(credits) over EVERY paper of the exam (a failed paper
 *    drags it down). It is only computed once every paper has a mark or an absent.
 *  - Credits earned = credits of the papers that were passed.
 *  - Result: 'pass' only if no paper failed; 'fail' if any did; 'incomplete' while any mark is missing.
 */

export const DEFAULT_BANDS = [
  { grade: 'O', min: 90, points: 10 },
  { grade: 'A+', min: 80, points: 9 },
  { grade: 'A', min: 70, points: 8 },
  { grade: 'B+', min: 60, points: 7 },
  { grade: 'B', min: 50, points: 6 },
  { grade: 'C', min: 45, points: 5 },
  { grade: 'P', min: 40, points: 4 },
  { grade: 'F', min: 0, points: 0 },
];

export const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Returns a clean, descending list of bands, or throws an Error with a message fit to show the admin. */
export function normaliseBands(input) {
  if (!Array.isArray(input) || input.length < 2 || input.length > 12) throw new Error('Define between 2 and 12 grade bands.');
  const bands = input.map((b) => ({
    grade: typeof b?.grade === 'string' ? b.grade.trim() : '',
    min: Number(b?.min),
    points: Number(b?.points),
  }));
  for (const b of bands) {
    if (!b.grade || b.grade.length > 4) throw new Error('Each grade needs a name of 1 to 4 characters.');
    if (!Number.isFinite(b.min) || b.min < 0 || b.min > 100) throw new Error('Each band needs a minimum percentage from 0 to 100.');
    if (!Number.isFinite(b.points) || b.points < 0 || b.points > 100) throw new Error('Grade points must be a number from 0 to 100.');
  }
  bands.sort((a, b) => b.min - a.min);
  if (bands[bands.length - 1].min !== 0) throw new Error('The lowest band must start at 0%, so every mark has a grade.');
  for (let i = 1; i < bands.length; i += 1) {
    if (bands[i].min === bands[i - 1].min) throw new Error('Two bands start at the same percentage.');
    if (bands[i].points > bands[i - 1].points) throw new Error('A higher band cannot give fewer grade points than a lower one.');
  }
  if (new Set(bands.map((b) => b.grade.toLowerCase())).size !== bands.length) throw new Error('Two bands have the same grade name.');
  return bands;
}

/** Band for a percentage (bands sorted high to low). */
export const bandFor = (pct, bands) => bands.find((b) => pct >= b.min) || bands[bands.length - 1];
export const failBand = (bands) => bands[bands.length - 1];

/**
 * One student's outcome in one paper.
 * `entry` is { marks, absent } or null/undefined when nothing has been entered.
 */
export function paperOutcome(paper, entry, bands) {
  const base = { subject: paper.subject, maxMarks: paper.maxMarks, passMarks: paper.passMarks, credits: paper.credits };
  if (!entry) return { ...base, status: 'pending', marks: null, absent: false, pct: null, grade: null, points: null, passed: null };
  if (entry.absent) {
    const f = failBand(bands);
    return { ...base, status: 'absent', marks: null, absent: true, pct: 0, grade: f.grade, points: 0, passed: false };
  }
  const pct = round2((entry.marks / paper.maxMarks) * 100);
  const passed = entry.marks >= paper.passMarks;
  const band = passed ? bandFor(pct, bands) : failBand(bands);
  return {
    ...base, status: passed ? 'pass' : 'fail', marks: entry.marks, absent: false, pct,
    grade: band.grade, points: passed ? band.points : 0, passed,
  };
}

/** A student's whole exam: every paper outcome plus totals, percentage, GPA and the overall result. */
export function studentOutcome(papers, entriesByPaper, bands) {
  const subjects = papers.map((p) => paperOutcome(p, entriesByPaper.get(p.id), bands));
  const complete = subjects.length > 0 && subjects.every((s) => s.status !== 'pending');
  const entered = subjects.filter((s) => s.status !== 'pending');
  const maxTotal = papers.reduce((a, p) => a + p.maxMarks, 0);
  const total = entered.reduce((a, s) => a + (s.marks || 0), 0);
  const totalCredits = papers.reduce((a, p) => a + p.credits, 0);

  const out = {
    subjects, complete, total: round2(total), maxTotal: round2(maxTotal),
    pct: complete && maxTotal ? round2((total / maxTotal) * 100) : null,
    gpa: null, creditsEarned: null, totalCredits: round2(totalCredits),
    result: 'incomplete', failedSubjects: [],
  };
  if (!complete) return out;

  out.gpa = totalCredits ? round2(subjects.reduce((a, s) => a + s.points * s.credits, 0) / totalCredits) : null;
  out.creditsEarned = round2(subjects.filter((s) => s.passed).reduce((a, s) => a + s.credits, 0));
  out.failedSubjects = subjects.filter((s) => !s.passed).map((s) => s.subject);
  out.result = out.failedSubjects.length ? 'fail' : 'pass';
  return out;
}

/** Credit-weighted average of grade points across several completed exams (for a cumulative GPA). */
export function cumulativeGpa(outcomes) {
  let pts = 0; let cr = 0;
  for (const o of outcomes) {
    if (!o.complete) continue;
    for (const s of o.subjects) { pts += s.points * s.credits; cr += s.credits; }
  }
  return cr ? round2(pts / cr) : null;
}

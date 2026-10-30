/** Small helpers for dashboard KPI cards. */
export const inr0 = (n) => `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}`;

/** Short rupee form for chart axes: ₹45k, ₹1.2L. */
export const inrShort = (n) => {
  const v = Number(n) || 0;
  if (v >= 1e7) return `₹${+(v / 1e7).toFixed(1)}Cr`;
  if (v >= 1e5) return `₹${+(v / 1e5).toFixed(1)}L`;
  if (v >= 1e3) return `₹${+(v / 1e3).toFixed(0)}k`;
  return `₹${v}`;
};

/** "Up 12% on last month" / "Down 3 points on last week" - a plain comparison, no colour of its own. */
export function compare(now, before, period, { points = false } = {}) {
  if (now === null || now === undefined || before === null || before === undefined) return null;
  if (points) {
    const d = Math.round((now - before) * 10) / 10;
    return d === 0 ? `Same as ${period}` : `${d > 0 ? 'Up' : 'Down'} ${Math.abs(d)} points on ${period}`;
  }
  if (!before) return now ? `Nothing in the same days ${period}` : null;
  const d = Math.round(((now - before) / before) * 100);
  return d === 0 ? `Same as ${period}` : `${d > 0 ? 'Up' : 'Down'} ${Math.abs(d)}% on ${period}`;
}

export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Indian digit grouping: 3307500 -> 33,07,500. */
export const numIn = (n) => Math.round(Number(n) || 0).toLocaleString('en-IN');

/** Compact rupees for small cards: ₹33.1 L, ₹1.2 Cr. Pair it with inr0 as the title, so the full figure is one hover away. */
export const inrCompact = (n) => {
  const v = Number(n) || 0;
  if (Math.abs(v) >= 1e7) return `₹${+(v / 1e7).toFixed(2)} Cr`;
  if (Math.abs(v) >= 1e5) return `₹${+(v / 1e5).toFixed(1)} L`;
  return inr0(v);
};

/**
 * A change against an earlier figure, ready for a KPI card. `goodWhen` says which way is good, because more absentees
 * is bad and more fees collected is good. With `points` the figures are percentages and the change is in points.
 */
export function changeOf(now, before, period, { points = false, goodWhen = 'up' } = {}) {
  if (now === null || now === undefined || before === null || before === undefined) return null;
  const diff = points ? Math.round((now - before) * 10) / 10 : before ? Math.round(((now - before) / before) * 100) : null;
  if (diff === null) return now ? { dir: 'up', tone: goodWhen === 'up' ? 'good' : 'bad', text: `New since ${period}` } : null;
  if (diff === 0) return { dir: 'same', tone: 'flat', text: `Same as ${period}` };
  const dir = diff > 0 ? 'up' : 'down';
  return { dir, tone: dir === goodWhen ? 'good' : 'bad', text: `${dir === 'up' ? 'Up' : 'Down'} ${Math.abs(diff)}${points ? ' points' : '%'} on ${period}` };
}

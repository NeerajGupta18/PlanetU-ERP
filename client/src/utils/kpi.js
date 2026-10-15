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

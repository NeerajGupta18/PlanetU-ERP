/**
 * Pure billing arithmetic - no database, no clock. Everything that decides what an invoice says is here:
 * which months a period covers, the price, the discount, GST (CGST+SGST or IGST) and the invoice number.
 */
export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
export const monthsIn = (cycle) => (cycle === 'annual' ? 12 : 1);
export const CYCLES = ['monthly', 'annual'];

/* ------------------------------------------------------------------ dates (all 'YYYY-MM-DD' strings) */

const pad = (n) => String(n).padStart(2, '0');
const parts = (iso) => { const [y, m, d] = String(iso).split('-').map(Number); return { y, m, d }; };
const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
export const isoOf = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

/** Calendar-correct month arithmetic: 31 Jan + 1 month = 28/29 Feb. `anchorDay` keeps a 31st from drifting to the 28th forever. */
export function addMonths(iso, n, anchorDay) {
  const { y, m, d } = parts(iso);
  const total = (y * 12 + (m - 1)) + n;
  const ny = Math.floor(total / 12); const nm = (total % 12) + 1;
  return isoOf(ny, nm, Math.min(anchorDay || d, daysInMonth(ny, nm)));
}

export function addDays(iso, n) {
  const { y, m, d } = parts(iso);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return isoOf(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** Whole days from a to b (negative if b is earlier). */
export function daysBetween(a, b) {
  const pa = parts(a); const pb = parts(b);
  return Math.round((Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / 86400000);
}

export const maxDate = (a, b) => (a >= b ? a : b);

/** The period an invoice covers: [start, end), `months` long, keeping the subscription's day-of-month. */
export function periodFor(startIso, cycle, anchorDay) {
  return { start: startIso, end: addMonths(startIso, monthsIn(cycle), anchorDay) };
}

/* ------------------------------------------------------------------ Indian financial year + invoice numbers */

/** India's financial year runs April to March: 2026-10-02 is in FY 2026-27. */
export function financialYear(iso) {
  const { y, m } = parts(iso);
  const start = m >= 4 ? y : y - 1;
  return `${start}-${pad((start + 1) % 100)}`;
}

/**
 * PU/26-27/0001. GST rules allow at most 16 characters of letters, digits, "/" and "-", and require the
 * sequence to be consecutive within the year, which is why the counter lives in the database.
 */
export function invoiceNumber(prefix, fy, n) {
  return `${prefix}/${fy.slice(2)}/${String(n).padStart(4, '0')}`;
}

/* ------------------------------------------------------------------ pricing */

/**
 * What a plan costs for one billing period.
 *   base:   the plan's price for the cycle - or, if the institute has a negotiated monthly price, that x months
 *           (annual = 10 x monthly, i.e. "2 months free", mirroring the list price)
 *   extra:  students above the plan's allowance, charged per student per month, for every month of the period
 */
export function priceLines({ plan, cycle, students, customMonthlyPrice }) {
  const months = monthsIn(cycle);
  const custom = customMonthlyPrice !== null && customMonthlyPrice !== undefined && customMonthlyPrice !== '';
  const base = custom
    ? round2(Number(customMonthlyPrice) * (cycle === 'annual' ? 10 : 1))
    : round2(Number(cycle === 'annual' ? plan.annual_price : plan.monthly_price));
  const lines = [{
    description: `${plan.name} plan - ${cycle === 'annual' ? 'annual' : 'monthly'} subscription${plan.included_students ? ` (up to ${Number(plan.included_students).toLocaleString('en-IN')} students)` : ''}`,
    quantity: 1, unitPrice: base, amount: base,
  }];
  const extra = Math.max(0, (students || 0) - (plan.included_students || 0));
  const perStudent = round2(Number(plan.extra_student_price));
  if (extra > 0 && perStudent > 0) {
    const unit = round2(perStudent * months);
    lines.push({
      description: `Additional students: ${extra.toLocaleString('en-IN')} above the ${Number(plan.included_students).toLocaleString('en-IN')} included (Rs. ${perStudent.toFixed(2)} per student per month x ${months})`,
      quantity: extra, unitPrice: unit, amount: round2(extra * unit),
    });
  }
  return lines;
}

/**
 * GST on a taxable value. Supply within the same state = CGST + SGST (half the rate each, each rounded on
 * its own as on a real invoice); to another state = IGST. The two are never mixed.
 */
export function gst({ taxable, rate, supplierState, customerState }) {
  const same = String(supplierState).trim().toLowerCase() === String(customerState).trim().toLowerCase();
  if (same) {
    const half = round2((taxable * rate) / 200);
    return { cgst: half, sgst: half, igst: 0, intraState: true };
  }
  return { cgst: 0, sgst: 0, igst: round2((taxable * rate) / 100), intraState: false };
}

/** Everything the invoice header and totals need, from the lines and the tax situation. */
export function totals({ lines, discountPercent = 0, rate, supplierState, customerState }) {
  const subtotal = round2(lines.reduce((a, l) => a + l.amount, 0));
  const discount = round2((subtotal * Math.min(Math.max(Number(discountPercent) || 0, 0), 100)) / 100);
  const taxable = round2(subtotal - discount);
  const tax = gst({ taxable, rate, supplierState, customerState });
  return { subtotal, discount, taxable, taxRate: rate, ...tax, total: round2(taxable + tax.cgst + tax.sgst + tax.igst) };
}

export const toPaise = (rupees) => Math.round(Number(rupees) * 100);

/** Indian grouping, e.g. 1,23,456.50 - for emails and PDFs. */
export const inr = (n) => Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Amount in words for the invoice footer ("Rupees Twelve Thousand ... Only"). Handles up to 99,99,99,999. */
export function amountInWords(amount) {
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen',
    'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const below100 = (n) => (n < 20 ? ones[n] : `${tens[Math.floor(n / 10)]}${n % 10 ? ` ${ones[n % 10]}` : ''}`);
  const below1000 = (n) => (n >= 100 ? `${ones[Math.floor(n / 100)]} Hundred${n % 100 ? ` ${below100(n % 100)}` : ''}` : below100(n));
  const rupees = Math.floor(round2(amount)); const paise = Math.round((round2(amount) - rupees) * 100);
  const words = [];
  const crore = Math.floor(rupees / 10000000); const lakh = Math.floor((rupees % 10000000) / 100000);
  const thousand = Math.floor((rupees % 100000) / 1000); const rest = rupees % 1000;
  if (crore) words.push(`${below1000(crore)} Crore`);
  if (lakh) words.push(`${below100(lakh)} Lakh`);
  if (thousand) words.push(`${below100(thousand)} Thousand`);
  if (rest) words.push(below1000(rest));
  const r = words.length ? words.join(' ') : 'Zero';
  return `Rupees ${r}${paise ? ` and ${below100(paise)} Paise` : ''} Only`;
}

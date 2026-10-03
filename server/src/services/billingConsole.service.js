/** Read models for the vendor console: the dashboard numbers, the per-institute list, and the invoice register for your accountant. */
import { q } from '../db/pool.js';
import { HttpError } from '../middleware/error.js';
import * as calc from './billingCalc.js';
import { activeStudents, getInvoice, listInvoices, notify, profileGaps, todayISO } from './billing.service.js';
import { applicableNotices } from './billingRun.service.js';
import { buildXlsx } from './xlsx.js';
import { csvCell } from '../utils/csv.js';

/** Monthly recurring revenue from ONE subscription, before GST and before usage-based extras. */
export function monthlyValue(s) {
  const base = s.customMonthlyPrice !== null && s.customMonthlyPrice !== undefined
    ? Number(s.customMonthlyPrice)
    : (s.cycle === 'annual' ? Number(s.annualPrice) / 12 : Number(s.monthlyPrice));
  return calc.round2(base * (1 - Number(s.discountPercent || 0) / 100));
}

const SUB_ROWS = `
  select t.id as "tenantId", t.code, t.name, t.type, t.status as "tenantStatus", t.suspension_reason as "suspensionReason",
         s.plan_key as "planKey", p.name as "planName", s.cycle, s.status, s.suspended_reason as "suspendedReason",
         s.trial_ends_on as "trialEndsOn", s.current_period_end as "paidUntil", s.pending_plan_key as "pendingPlanKey",
         s.custom_monthly_price::float8 as "customMonthlyPrice", s.discount_percent::float8 as "discountPercent",
         s.grace_days as "graceDays", s.cancel_at_period_end as "cancelAtPeriodEnd",
         p.monthly_price::float8 as "monthlyPrice", p.annual_price::float8 as "annualPrice",
         bp.legal_name as "legalName", bp.state, bp.gstin, bp.billing_email as "billingEmail"
  from tenant_subscriptions s
  join tenants t on t.id = s.tenant_id
  join billing_plans p on p.key = s.plan_key
  left join billing_profiles bp on bp.tenant_id = t.id
  where t.plan <> 'demo'`;

export async function listSubscriptions({ today = todayISO() } = {}) {
  const { rows } = await q(`${SUB_ROWS} order by t.created_at, t.name`);
  const { rows: inv } = await q(
    `select tenant_id as "tenantId", count(*)::int as n, coalesce(sum(total), 0)::float8 as total,
            coalesce(sum(total) filter (where due_date < $1::date), 0)::float8 as overdue, min(number) as "firstNumber"
     from billing_invoices where status = 'open' group by tenant_id`, [today],
  );
  const open = new Map(inv.map((r) => [r.tenantId, r]));
  const out = [];
  for (const r of rows) {
    const o = open.get(r.tenantId);
    out.push({
      ...r, students: await activeStudents(r.tenantId), mrr: ['active', 'past_due'].includes(r.status) && r.planKey !== 'trial' ? monthlyValue(r) : 0,
      detailsComplete: profileGaps({ legalName: r.legalName, state: r.state }).length === 0,
      openInvoices: o?.n || 0, openAmount: o?.total || 0, overdueAmount: o?.overdue || 0,
    });
  }
  return out;
}

export async function overview({ today = todayISO() } = {}) {
  const subs = await listSubscriptions({ today });
  const byStatus = Object.fromEntries(['trialing', 'active', 'past_due', 'suspended'].map((s) => [s, subs.filter((x) => x.status === s).length]));
  const mrr = calc.round2(subs.reduce((a, s) => a + s.mrr, 0));

  const month = today.slice(0, 7);
  const fy = calc.financialYear(today);
  const fyStart = `${fy.slice(0, 4)}-04-01`;
  const { rows: [m] } = await q(
    `select coalesce(sum(amount) filter (where to_char(paid_at at time zone 'Asia/Kolkata', 'YYYY-MM') = $1), 0)::float8 as month,
            coalesce(sum(amount) filter (where (paid_at at time zone 'Asia/Kolkata')::date >= $2::date), 0)::float8 as fy
     from billing_payments`, [month, fyStart],
  );
  const { rows: [o] } = await q(
    `select coalesce(sum(total), 0)::float8 as outstanding, coalesce(sum(total) filter (where due_date < $1::date), 0)::float8 as overdue,
            count(*)::int as open, count(*) filter (where due_date < $1::date)::int as "overdueCount"
     from billing_invoices where status = 'open'`, [today],
  );
  const { rows: [review] } = await q("select count(*)::int as n from billing_orders where status = 'needs_review'");
  const { rows: invoiced } = await q(
    `select to_char(issue_date, 'YYYY-MM') as month, coalesce(sum(total), 0)::float8 as invoiced
     from billing_invoices where status <> 'void' and issue_date >= ($1::date - interval '5 months')::date - (extract(day from $1::date)::int - 1)
     group by 1 order by 1`, [today],
  );
  const { rows: collected } = await q(
    `select to_char(paid_at at time zone 'Asia/Kolkata', 'YYYY-MM') as month, coalesce(sum(amount), 0)::float8 as collected
     from billing_payments where paid_at >= ($1::date - interval '6 months') group by 1 order by 1`, [today],
  );
  const months = [...new Set([...invoiced.map((r) => r.month), ...collected.map((r) => r.month)])].sort().slice(-6);
  const series = months.map((mo) => ({
    month: mo, invoiced: invoiced.find((r) => r.month === mo)?.invoiced || 0, collected: collected.find((r) => r.month === mo)?.collected || 0,
  }));

  const soon = (d, n) => d && calc.daysBetween(today, d) >= 0 && calc.daysBetween(today, d) <= n;
  return {
    today, mrr, arr: calc.round2(mrr * 12), counts: { institutes: subs.length, ...byStatus },
    collected: { thisMonth: m.month, thisFinancialYear: m.fy, financialYear: fy },
    receivables: o, needsReview: review.n, series,
    attention: {
      overdue: subs.filter((s) => s.overdueAmount > 0).map((s) => ({ tenantId: s.tenantId, name: s.name, amount: s.overdueAmount, status: s.status })),
      suspended: subs.filter((s) => s.status === 'suspended').map((s) => ({ tenantId: s.tenantId, name: s.name, reason: s.suspendedReason })),
      trialsEnding: subs.filter((s) => s.status === 'trialing' && soon(s.trialEndsOn, 7)).map((s) => ({ tenantId: s.tenantId, name: s.name, endsOn: s.trialEndsOn, planKey: s.planKey })),
      renewalsSoon: subs.filter((s) => s.status === 'active' && !s.cancelAtPeriodEnd && soon(s.paidUntil, 14)).map((s) => ({ tenantId: s.tenantId, name: s.name, paidUntil: s.paidUntil })),
      missingDetails: subs.filter((s) => !s.detailsComplete && s.planKey !== 'trial').map((s) => ({ tenantId: s.tenantId, name: s.name })),
      cancelling: subs.filter((s) => s.cancelAtPeriodEnd).map((s) => ({ tenantId: s.tenantId, name: s.name, paidUntil: s.paidUntil })),
    },
  };
}

/** Re-sends the most relevant reminder for an open invoice (a vendor clicking "Remind"). */
export async function remindInvoice(id, { today = todayISO() } = {}) {
  const inv = await getInvoice(id);
  if (inv.status !== 'open') throw new HttpError(409, 'Only an unpaid invoice can be reminded about.');
  const { rows: [s] } = await q('select grace_days from tenant_subscriptions where tenant_id = $1', [inv.tenantId]);
  const grace = s?.grace_days ?? 7;
  const kind = applicableNotices(inv.dueDate, grace, today).slice(-1)[0] || 'pre_due';
  const sent = await notify(inv.tenantId, 'subscriptionReminder', { kind, number: inv.number, total: inv.total, dueDate: inv.dueDate, graceEnds: calc.addDays(inv.dueDate, grace) });
  if (!sent) throw new HttpError(409, 'This institute has no email address on file to remind.');
  return { sent, kind };
}

/* ---------------- the invoice register ---------------- */

const REGISTER_COLUMNS = [
  { header: 'Invoice no.', key: 'number', width: 16 }, { header: 'Date', key: 'issueDate', type: 'date' }, { header: 'Institute', key: 'instituteName', width: 28 },
  { header: 'Customer GSTIN', key: 'gstin', width: 18 }, { header: 'Place of supply', key: 'placeOfSupply', width: 18 },
  { header: 'Period from', key: 'periodStart', type: 'date' }, { header: 'Period to', key: 'periodEnd', type: 'date' }, { header: 'Plan', key: 'planKey', width: 10 },
  { header: 'Taxable value', key: 'taxable', type: 'money' }, { header: 'CGST', key: 'cgst', type: 'money' }, { header: 'SGST', key: 'sgst', type: 'money' },
  { header: 'IGST', key: 'igst', type: 'money' }, { header: 'Total', key: 'total', type: 'money' }, { header: 'Status', key: 'status', width: 9 },
  { header: 'Paid on', key: 'paidOn', type: 'date' },
];

export async function invoiceRegister(filters, opts) {
  const rows = (await listInvoices({ ...filters, limit: 5000 }, opts)).map((r) => ({ ...r, paidOn: r.paidAt ? new Date(r.paidAt).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }) : null }));
  return { columns: REGISTER_COLUMNS, rows };
}
export const registerCsv = ({ columns, rows }) => `\uFEFF${[columns.map((c) => csvCell(c.header)).join(','), ...rows.map((r) => columns.map((c) => csvCell(r[c.key])).join(','))].join('\r\n')}\r\n`;
export const registerXlsx = ({ columns, rows }) => buildXlsx([{ name: 'Invoice register', columns, rows }]);

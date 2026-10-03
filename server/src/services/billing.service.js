/**
 * Vendor-side billing: PlanetU invoices each institute for its subscription.
 *
 * Everything here runs in PLATFORM context (a vendor-console request, the billing worker, or the Razorpay
 * webhook). Institute-facing endpoints call in with a tenantId taken from the signed session, never from the
 * client, and the database lets a tenant only READ its own billing rows.
 *
 * The model, in one paragraph: every real institute has one subscription. It is paid in advance, one period
 * at a time (monthly or annual). About a week before a period ends, an invoice for the NEXT period is issued
 * and emailed. Paying it (online or recorded offline) extends "paid until". If the period passes unpaid the
 * institute is past due, and after a grace period it is locked until it pays. Plan changes take effect from
 * the next invoice; nothing is prorated.
 */
import { env } from '../config/env.js';
import { inTenant, isUuid, q, withTx } from '../db/pool.js';
import { HttpError } from '../middleware/error.js';
import { audit } from '../db/audit.js';
import { queueEmail } from './notifications.service.js';
import { GSTIN_RE, STATES, stateByName } from '../config/indianStates.js';
import * as calc from './billingCalc.js';
import { isISO, toISO } from '../utils/dates.js';

export const todayISO = () => toISO(new Date());
export const asPlatform = (fn) => withTx({ platform: true }, fn);

const PAID_PLANS = ['basic', 'standard', 'premium'];
export const METHODS = ['bank_transfer', 'upi', 'cheque', 'cash', 'other'];

const err = (status, message, code) => Object.assign(new HttpError(status, message), code ? { code } : {});

/* ================================================================== vendor identity */

export function vendorDetails() {
  return {
    name: env.BILLING_VENDOR_NAME, address: env.BILLING_VENDOR_ADDRESS, state: env.BILLING_VENDOR_STATE, gstin: env.BILLING_VENDOR_GSTIN,
    pan: env.BILLING_VENDOR_PAN, email: env.BILLING_VENDOR_EMAIL, sac: env.BILLING_SAC, bank: env.BILLING_BANK_DETAILS, upi: env.BILLING_UPI_ID,
  };
}

/* ================================================================== plans */

const PLAN_COLS = `key, name, description, monthly_price::float8 as "monthlyPrice", annual_price::float8 as "annualPrice",
  included_students as "includedStudents", extra_student_price::float8 as "extraStudentPrice", features, selectable, sort_order as "sortOrder"`;

export async function listPlans() {
  const { rows } = await q(`select ${PLAN_COLS} from billing_plans order by sort_order`);
  return rows;
}

const money = (v, label, { max = 10_000_000 } = {}) => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) throw err(400, `${label} must be zero or more.`);
  if (n > max) throw err(400, `${label} is too large.`);
  return calc.round2(n);
};

export async function updatePlan(key, body, actor) {
  const { rows: [cur] } = await q('select * from billing_plans where key = $1', [key]);
  if (!cur) throw err(404, 'Plan not found.');
  if (key === 'trial') throw err(409, 'The free trial plan is not priced.');
  const b = body || {};
  const monthly = b.monthlyPrice !== undefined ? money(b.monthlyPrice, 'Monthly price') : Number(cur.monthly_price);
  const annual = b.annualPrice !== undefined ? money(b.annualPrice, 'Annual price') : Number(cur.annual_price);
  const extra = b.extraStudentPrice !== undefined ? money(b.extraStudentPrice, 'Price per extra student', { max: 100000 }) : Number(cur.extra_student_price);
  const included = b.includedStudents !== undefined ? Number(b.includedStudents) : cur.included_students;
  if (!Number.isInteger(included) || included < 0 || included > 1_000_000) throw err(400, 'Included students must be a whole number.');
  if (monthly <= 0 || annual <= 0) throw err(400, 'A paid plan needs a monthly and an annual price above zero.');
  const name = b.name !== undefined ? String(b.name).trim() : cur.name;
  if (!name || name.length > 40) throw err(400, 'Give the plan a name of up to 40 characters.');
  const description = b.description !== undefined ? String(b.description).trim().slice(0, 300) : cur.description;
  let features = cur.features;
  if (b.features !== undefined) {
    if (!Array.isArray(b.features) || b.features.length > 12 || b.features.some((f) => typeof f !== 'string' || f.length > 120)) throw err(400, 'Features must be a short list of text lines.');
    features = b.features.map((f) => f.trim()).filter(Boolean);
  }
  const selectable = b.selectable !== undefined ? b.selectable === true : cur.selectable;
  await q(
    `update billing_plans set name = $2, description = $3, monthly_price = $4, annual_price = $5, included_students = $6,
            extra_student_price = $7, features = $8, selectable = $9, updated_at = now() where key = $1`,
    [key, name, description, monthly, annual, included, extra, JSON.stringify(features), selectable],
  );
  await audit(actor, 'billing.plan_update', 'billing_plan', key, { monthly, annual, included, extra });
  return (await listPlans()).find((p) => p.key === key);
}

async function planOrThrow(key) {
  const { rows: [p] } = await q('select * from billing_plans where key = $1', [key]);
  if (!p) throw err(400, 'Unknown plan.');
  return p;
}

/* ================================================================== billing details (who we invoice) */

const PROFILE_COLS = `legal_name as "legalName", gstin, address, city, state, pincode, billing_email as "billingEmail", billing_phone as "billingPhone"`;

export async function getProfile(tenantId) {
  const { rows: [p] } = await q(`select ${PROFILE_COLS} from billing_profiles where tenant_id = $1`, [tenantId]);
  if (p) return p;
  const { rows: [t] } = await q('select name from tenants where id = $1', [tenantId]);
  return { legalName: t?.name || '', gstin: '', address: '', city: '', state: '', pincode: '', billingEmail: '', billingPhone: '' };
}

/** What is still missing before an invoice can be issued. */
export const profileGaps = (p) => [
  ...(p.legalName?.trim() ? [] : ['legal name']), ...(stateByName(p.state) ? [] : ['state']),
];

export async function saveProfile(tenantId, body, actor) {
  const b = body || {};
  const cur = await getProfile(tenantId);
  const text = (v, label, max) => {
    const s = String(v ?? '').replace(/\s+/g, ' ').trim();
    if (s.length > max) throw err(400, `${label} is too long (${max} characters at most).`);
    return s;
  };
  const next = {
    legalName: b.legalName !== undefined ? text(b.legalName, 'Legal name', 150) : cur.legalName,
    address: b.address !== undefined ? text(b.address, 'Address', 300) : cur.address,
    city: b.city !== undefined ? text(b.city, 'City', 80) : cur.city,
    pincode: b.pincode !== undefined ? text(b.pincode, 'PIN code', 10) : cur.pincode,
    billingPhone: b.billingPhone !== undefined ? text(b.billingPhone, 'Phone', 20) : cur.billingPhone,
    billingEmail: b.billingEmail !== undefined ? text(b.billingEmail, 'Billing email', 150).toLowerCase() : cur.billingEmail,
    state: cur.state, gstin: cur.gstin,
  };
  if (b.state !== undefined) {
    const s = text(b.state, 'State', 60);
    if (s) {
      const st = stateByName(s);
      if (!st) throw err(400, 'Choose the state from the list.');
      next.state = st.name;
    } else next.state = '';
  }
  if (b.gstin !== undefined) next.gstin = text(b.gstin, 'GSTIN', 15).toUpperCase();
  if (next.billingEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(next.billingEmail)) throw err(400, 'Enter a valid billing email address.');
  if (next.pincode && !/^\d{6}$/.test(next.pincode)) throw err(400, 'PIN code must be 6 digits.');
  if (next.gstin) {
    if (!GSTIN_RE.test(next.gstin)) throw err(400, 'That GSTIN is not valid. It has 15 characters, e.g. 27AAAAA0000A1Z5.');
    const st = stateByName(next.state);
    if (!st) throw err(400, 'Choose the state first: a GSTIN must belong to it.');
    if (next.gstin.slice(0, 2) !== st.code) throw err(400, `This GSTIN starts with ${next.gstin.slice(0, 2)}, which is not ${st.name} (${st.code}). Check the state and the GSTIN.`);
  }
  await q(
    `insert into billing_profiles (tenant_id, legal_name, gstin, address, city, state, pincode, billing_email, billing_phone, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
     on conflict (tenant_id) do update set legal_name = excluded.legal_name, gstin = excluded.gstin, address = excluded.address, city = excluded.city,
       state = excluded.state, pincode = excluded.pincode, billing_email = excluded.billing_email, billing_phone = excluded.billing_phone, updated_at = now()`,
    [tenantId, next.legalName, next.gstin, next.address, next.city, next.state, next.pincode, next.billingEmail, next.billingPhone],
  );
  await audit(actor, 'billing.profile_update', 'tenant', tenantId, { tenantId, gstin: Boolean(next.gstin), state: next.state });
  return getProfile(tenantId);
}

/* ================================================================== email */

async function recipients(tenantId) {
  const { rows: [p] } = await q('select billing_email from billing_profiles where tenant_id = $1', [tenantId]);
  const { rows: admins } = await q("select email from users where tenant_id = $1 and role = 'admin' and status = 'active' order by created_at", [tenantId]);
  const seen = new Set(); const out = [];
  for (const e of [p?.billing_email, ...admins.map((a) => a.email)]) {
    const v = String(e || '').trim().toLowerCase();
    if (v && !seen.has(v)) { seen.add(v); out.push(v); }
  }
  return out;
}

/** Queues a platform-level email (sender: PlanetU) to everyone who handles billing at the institute. */
export async function notify(tenantId, template, data) {
  const { rows: [t] } = await q('select name from tenants where id = $1', [tenantId]);
  const to = await recipients(tenantId);
  for (const addr of to) {
    await queueEmail(addr, template, { vendor: env.BILLING_VENDOR_NAME, instituteName: t?.name || 'your institute', url: `${env.APP_URL}/admin/billing`, ...data });
  }
  return to.length;
}

/* ================================================================== subscriptions */

const SUB_COLS = `s.tenant_id as "tenantId", s.plan_key as "planKey", s.cycle, s.status, s.suspended_reason as "suspendedReason",
  s.trial_ends_on as "trialEndsOn", s.current_period_start as "periodStart", s.current_period_end as "paidUntil",
  s.pending_plan_key as "pendingPlanKey", s.pending_cycle as "pendingCycle", s.custom_monthly_price::float8 as "customMonthlyPrice",
  s.discount_percent::float8 as "discountPercent", s.grace_days as "graceDays", s.cancel_at_period_end as "cancelAtPeriodEnd",
  s.started_on as "startedOn"`;

async function subOrThrow(tenantId, { lock = false } = {}) {
  const { rows: [s] } = await q(`select ${SUB_COLS} from tenant_subscriptions s where s.tenant_id = $1 ${lock ? 'for update' : ''}`, [tenantId]);
  if (!s) throw err(404, 'This institute has no subscription (demo institutes are not billed).');
  return s;
}

/**
 * Creates the subscription for a new institute. A paid plan chosen at creation starts as a trial of that plan:
 * the first invoice goes out shortly before the trial ends. Demo institutes are never billed.
 */
export async function startSubscription(tenantId, planKey = 'trial', { trialDays } = {}) {
  if (planKey === 'demo') return null;
  const plan = await planOrThrow(planKey);
  const today = todayISO();
  const days = trialDays ?? env.BILLING_TRIAL_DAYS;
  const end = calc.addDays(today, days);
  await q(
    `insert into tenant_subscriptions (tenant_id, plan_key, status, trial_ends_on, current_period_start, current_period_end, started_on)
     values ($1, $2, 'trialing', $3, $4, $3, $4) on conflict (tenant_id) do nothing`,
    [tenantId, plan.key, end, today],
  );
  const { rows: [t] } = await q('select name from tenants where id = $1', [tenantId]);
  await q("insert into billing_profiles (tenant_id, legal_name) values ($1, $2) on conflict (tenant_id) do nothing", [tenantId, t?.name || '']);
  return end;
}

export async function activeStudents(tenantId) {
  return inTenant(tenantId, async () => (await q("select count(*)::int as n from students where status = 'Active'")).rows[0].n);
}

const lockReason = (sub) => ({ unpaid: 'unpaid invoice', trial_ended: 'trial ended', cancelled: 'subscription cancelled' }[sub.suspendedReason] || null);

/** Everything the billing screens need about one institute (used by both the vendor console and the institute's own page). */
export async function subscriptionView(tenantId, { today = todayISO() } = {}) {
  const sub = await subOrThrow(tenantId);
  const plans = await listPlans();
  const plan = plans.find((p) => p.key === sub.planKey);
  const { rows: [t] } = await q('select id, code, name, plan, status, suspension_reason as "suspensionReason" from tenants where id = $1', [tenantId]);
  const students = await activeStudents(tenantId);
  const profile = await getProfile(tenantId);
  const { rows: open } = await q(
    `select id, number, total::float8 as total, due_date as "dueDate", period_start as "periodStart", period_end as "periodEnd", plan_key as "planKey"
     from billing_invoices where tenant_id = $1 and status = 'open' order by due_date`, [tenantId],
  );
  const lead = env.BILLING_INVOICE_LEAD_DAYS;
  return {
    tenant: t, subscription: sub, plan, plans, students, profile, profileGaps: profileGaps(profile),
    openInvoices: open.map((i) => ({ ...i, overdue: i.dueDate < today, daysOverdue: Math.max(0, calc.daysBetween(i.dueDate, today)) })),
    // Once the next invoice has been issued there is no "next invoice date" left to promise
    nextInvoiceOn: open.length === 0 && sub.paidUntil && sub.planKey !== 'trial' && !sub.cancelAtPeriodEnd && sub.status !== 'suspended' ? calc.addDays(sub.paidUntil, -lead) : null,
    graceEndsOn: open[0] ? calc.addDays(open[0].dueDate, sub.graceDays) : null,
    locked: t.status === 'suspended' && t.suspensionReason === 'billing', lockReason: lockReason(sub),
    estimate: await estimateNext(sub, plans, students),
  };
}

/** What the next invoice will roughly be (before GST), so an institute is never surprised. */
async function estimateNext(sub, plans, students) {
  const planKey = sub.pendingPlanKey || sub.planKey;
  const plan = plans.find((p) => p.key === planKey);
  if (!plan || planKey === 'trial') return null;
  const cycle = sub.pendingCycle || sub.cycle;
  const lines = calc.priceLines({
    plan: { name: plan.name, annual_price: plan.annualPrice, monthly_price: plan.monthlyPrice, included_students: plan.includedStudents, extra_student_price: plan.extraStudentPrice },
    cycle, students, customMonthlyPrice: sub.customMonthlyPrice,
  });
  const t = calc.totals({ lines, discountPercent: sub.discountPercent, rate: env.BILLING_GST_RATE, supplierState: 'x', customerState: 'y' });
  return { planKey, cycle, subtotal: t.subtotal, discount: t.discount, taxable: t.taxable, gstRate: env.BILLING_GST_RATE };
}

const setTenantPlan = (tenantId, planKey) => q('update tenants set plan = $2 where id = $1', [tenantId, planKey]);

/**
 * Vendor-side edits to a subscription. Plan/cycle changes apply from the next invoice (nothing is prorated),
 * except that the plan shown on the institute record changes straight away.
 */
export async function updateSubscription(tenantId, body, actor, { today = todayISO() } = {}) {
  const b = body || {};
  const sub = await subOrThrow(tenantId, { lock: true });
  const set = {};
  if (b.planKey !== undefined) {
    const plan = await planOrThrow(b.planKey);
    if (plan.key === 'trial' && sub.status !== 'trialing') throw err(409, 'Only an institute that is still on trial can be moved back to the trial plan.');
    set.plan_key = plan.key; set.pending_plan_key = null; set.pending_cycle = null;
  }
  if (b.cycle !== undefined) {
    if (!calc.CYCLES.includes(b.cycle)) throw err(400, 'Billing cycle must be monthly or annual.');
    set.cycle = b.cycle;
  }
  if (b.customMonthlyPrice !== undefined) set.custom_monthly_price = b.customMonthlyPrice === null || b.customMonthlyPrice === '' ? null : money(b.customMonthlyPrice, 'Custom monthly price');
  if (b.discountPercent !== undefined) {
    const d = Number(b.discountPercent);
    if (!Number.isFinite(d) || d < 0 || d > 100) throw err(400, 'Discount must be between 0 and 100 percent.');
    set.discount_percent = calc.round2(d);
  }
  if (b.graceDays !== undefined) {
    const g = Number(b.graceDays);
    if (!Number.isInteger(g) || g < 0 || g > 60) throw err(400, 'Grace period must be a whole number of days, 0 to 60.');
    set.grace_days = g;
  }
  if (b.cancelAtPeriodEnd !== undefined) set.cancel_at_period_end = b.cancelAtPeriodEnd === true;
  if (b.trialEndsOn !== undefined) {
    if (!isISO(b.trialEndsOn)) throw err(400, 'Trial end must look like YYYY-MM-DD.');
    if (sub.status !== 'trialing') throw err(409, 'The trial end can only be changed while the institute is on trial.');
    set.trial_ends_on = b.trialEndsOn; set.current_period_end = b.trialEndsOn; set.trial_notice = null;
  }
  // A courtesy extension: "paid until" moves to the date given, and a locked institute is let back in
  let restored = false;
  if (b.extendUntil !== undefined) {
    if (!isISO(b.extendUntil) || b.extendUntil < today) throw err(400, 'Extend until a date that is today or later.');
    set.current_period_end = b.extendUntil;
    if (sub.status === 'trialing') set.trial_ends_on = b.extendUntil;
    if (sub.status === 'suspended' || sub.status === 'past_due') { set.status = 'active'; set.suspended_reason = null; }
    const r = await q("update tenants set status = 'active', suspension_reason = null where id = $1 and suspension_reason = 'billing' returning id", [tenantId]);
    restored = r.rowCount > 0;
  }
  const keys = Object.keys(set);
  if (!keys.length) throw err(400, 'Nothing to change.');
  await q(`update tenant_subscriptions set ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')}, updated_at = now() where tenant_id = $1`, [tenantId, ...keys.map((k) => set[k])]);
  if (set.plan_key) await setTenantPlan(tenantId, set.plan_key);
  await audit(actor, 'billing.subscription_update', 'tenant', tenantId, { tenantId, changes: Object.keys(b), restored });
  return subscriptionView(tenantId, { today });
}

/** An institute admin asks to switch plan/cycle from the next renewal, or cancels at the end of the paid period. */
export async function requestChange(tenantId, body, actor, { today = todayISO() } = {}) {
  const b = body || {};
  const sub = await subOrThrow(tenantId, { lock: true });
  if (b.cancelAtPeriodEnd !== undefined) {
    if (sub.status === 'suspended') throw err(409, 'This subscription is not active.');
    await q('update tenant_subscriptions set cancel_at_period_end = $2, updated_at = now() where tenant_id = $1', [tenantId, b.cancelAtPeriodEnd === true]);
    await audit(actor, b.cancelAtPeriodEnd === true ? 'billing.cancel_requested' : 'billing.cancel_withdrawn', 'tenant', tenantId, { tenantId });
  }
  if (b.planKey !== undefined) {
    const plan = await planOrThrow(b.planKey);
    if (!plan.selectable) throw err(400, 'That plan cannot be chosen here.');
    const cycle = b.cycle ?? sub.cycle;
    if (!calc.CYCLES.includes(cycle)) throw err(400, 'Billing cycle must be monthly or annual.');
    const same = plan.key === sub.planKey && cycle === sub.cycle;
    await q('update tenant_subscriptions set pending_plan_key = $2, pending_cycle = $3, updated_at = now() where tenant_id = $1',
      [tenantId, same ? null : plan.key, same ? null : cycle]);
    await audit(actor, 'billing.plan_change_requested', 'tenant', tenantId, { tenantId, planKey: plan.key, cycle });
  }
  return subscriptionView(tenantId, { today });
}

/* ================================================================== invoices */

const INVOICE_COLS = `i.id, i.tenant_id as "tenantId", i.number, i.status, i.source, i.plan_key as "planKey", i.cycle,
  i.period_start as "periodStart", i.period_end as "periodEnd", i.issue_date as "issueDate", i.due_date as "dueDate",
  i.subtotal::float8 as subtotal, i.discount::float8 as discount, i.taxable::float8 as taxable, i.tax_rate::float8 as "taxRate",
  i.cgst::float8 as cgst, i.sgst::float8 as sgst, i.igst::float8 as igst, i.total::float8 as total, i.place_of_supply as "placeOfSupply",
  i.paid_at as "paidAt", i.void_reason as "voidReason"`;

async function nextInvoiceNumber(issueDate) {
  const fy = calc.financialYear(issueDate);
  const { rows: [r] } = await q(
    `insert into billing_counters (fy, last_number) values ($1, 1)
     on conflict (fy) do update set last_number = billing_counters.last_number + 1 returning last_number`, [fy],
  );
  return calc.invoiceNumber(env.BILLING_INVOICE_PREFIX, fy, r.last_number);
}

/** Does the subscription's day-of-month chain still hold (31 Jan -> 28 Feb -> 31 Mar), or is this a fresh start? */
function anchorFor(sub, periodStart) {
  const startedDay = Number(String(sub.startedOn).slice(8, 10));
  const day = Number(periodStart.slice(8, 10));
  const lastDay = new Date(Date.UTC(Number(periodStart.slice(0, 4)), Number(periodStart.slice(5, 7)), 0)).getUTCDate();
  return day === Math.min(startedDay, lastDay) ? startedDay : day;
}

/**
 * Issues the invoice for the next period.
 *   source 'auto'            the daily run: the period that starts exactly where the paid period ends
 *   source 'manual'          the vendor says "invoice now": the next period, from today if coverage has lapsed
 *   source 'plan_selection'  an institute chose a plan (after a trial, or after being locked)
 */
export async function generateInvoice(tenantId, { source = 'manual', actor = null, today = todayISO() } = {}) {
  const sub = await subOrThrow(tenantId, { lock: true });
  const planKey = sub.pendingPlanKey || sub.planKey;
  if (planKey === 'trial') throw err(409, 'Choose a paid plan first: the free trial has nothing to invoice.', 'NO_PLAN');
  const plan = await planOrThrow(planKey);
  const cycle = sub.pendingCycle || sub.cycle;

  const profile = await getProfile(tenantId);
  const gaps = profileGaps(profile);
  if (gaps.length) throw err(409, `Billing details are incomplete (missing: ${gaps.join(', ')}). GST cannot be worked out without them.`, 'BILLING_DETAILS');

  const periodStart = source === 'auto' ? sub.paidUntil : calc.maxDate(sub.paidUntil || today, today);
  if (!periodStart) throw err(409, 'This subscription has no period to invoice.');
  const period = calc.periodFor(periodStart, cycle, anchorFor(sub, periodStart));

  const { rows: [dupe] } = await q("select number, status from billing_invoices where tenant_id = $1 and period_start = $2 and status <> 'void'", [tenantId, period.start]);
  if (dupe) throw err(409, `Invoice ${dupe.number} already covers the period starting ${period.start}.`, 'ALREADY_INVOICED');

  const students = await activeStudents(tenantId);
  const lines = calc.priceLines({ plan, cycle, students, customMonthlyPrice: sub.customMonthlyPrice === null ? null : sub.customMonthlyPrice });
  const vendor = vendorDetails();
  const t = calc.totals({ lines, discountPercent: sub.discountPercent, rate: env.BILLING_GST_RATE, supplierState: vendor.state, customerState: profile.state });

  const number = await nextInvoiceNumber(today);
  const dueDate = calc.maxDate(period.start, today);
  const { rows: [tenant] } = await q('select name from tenants where id = $1', [tenantId]);
  const customer = {
    name: profile.legalName || tenant.name, gstin: profile.gstin, state: profile.state,
    address: [profile.address, profile.city, profile.pincode].filter(Boolean).join(', '),
  };
  const { rows: [inv] } = await q(
    `insert into billing_invoices (tenant_id, number, source, plan_key, cycle, period_start, period_end, issue_date, due_date,
        subtotal, discount, taxable, tax_rate, cgst, sgst, igst, total, place_of_supply, customer, vendor, created_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21) returning id`,
    [tenantId, number, source, plan.key, cycle, period.start, period.end, today, dueDate, t.subtotal, t.discount, t.taxable, t.taxRate,
      t.cgst, t.sgst, t.igst, t.total, profile.state, JSON.stringify(customer), JSON.stringify(vendor), actor?.id ?? null],
  );
  for (const [i, l] of lines.entries()) {
    await q('insert into billing_invoice_lines (invoice_id, position, description, quantity, unit_price, amount) values ($1, $2, $3, $4, $5, $6)',
      [inv.id, i + 1, l.description, l.quantity, l.unitPrice, l.amount]);
  }
  await audit(actor, 'billing.invoice_issue', 'billing_invoice', inv.id, { tenantId, number, total: t.total, source, students });

  if (t.total === 0) {
    await settleInvoice(inv.id, { method: 'other', reference: 'No charge', note: 'Invoice total is zero (discount or complimentary plan)', actor, today, silent: true });
  } else {
    await q("insert into billing_notices (invoice_id, kind) values ($1, 'issued') on conflict do nothing", [inv.id]);
    await notify(tenantId, 'subscriptionInvoice', { number, total: t.total, dueDate, periodStart: period.start, periodEnd: period.end });
  }
  return getInvoice(inv.id);
}

export async function getInvoice(id) {
  if (!isUuid(id)) throw err(404, 'Invoice not found.');
  const { rows: [i] } = await q(
    `select ${INVOICE_COLS}, i.customer, i.vendor, t.name as "instituteName", t.code as "instituteCode"
     from billing_invoices i join tenants t on t.id = i.tenant_id where i.id = $1`, [id],
  );
  if (!i) throw err(404, 'Invoice not found.');
  const { rows: lines } = await q(
    'select position, description, quantity::float8 as quantity, unit_price::float8 as "unitPrice", amount::float8 as amount from billing_invoice_lines where invoice_id = $1 order by position', [id],
  );
  const { rows: payments } = await q(
    'select id, amount::float8 as amount, method, reference, note, paid_at as "paidAt" from billing_payments where invoice_id = $1 order by paid_at', [id],
  );
  return { ...i, lines, payments };
}

export async function listInvoices({ tenantId, status, from, to, search, limit = 500 } = {}, { today = todayISO() } = {}) {
  const where = []; const params = [];
  const param = (v) => { params.push(v); return `$${params.length}`; };
  if (tenantId) where.push(`i.tenant_id = ${param(tenantId)}`);
  if (status === 'overdue') where.push(`i.status = 'open' and i.due_date < ${param(today)}::date`);
  else if (status) where.push(`i.status = ${param(status)}`);
  if (from) where.push(`i.issue_date >= ${param(from)}::date`);
  if (to) where.push(`i.issue_date <= ${param(to)}::date`);
  if (search) {
    const like = param(`%${String(search).toLowerCase()}%`);
    where.push(`(lower(i.number) like ${like} or lower(t.name) like ${like} or lower(t.code) like ${like})`);
  }
  const todayParam = param(today);
  const { rows } = await q(
    `select ${INVOICE_COLS}, t.name as "instituteName", t.code as "instituteCode", i.customer->>'gstin' as gstin,
            (i.status = 'open' and i.due_date < ${todayParam}::date) as overdue
     from billing_invoices i join tenants t on t.id = i.tenant_id
     ${where.length ? `where ${where.join(' and ')}` : ''} order by i.issue_date desc, i.number desc limit ${Math.min(Number(limit) || 500, 5000)}`,
    params,
  );
  return rows;
}

export async function voidInvoice(id, reason, actor) {
  if (!String(reason || '').trim()) throw err(400, 'Say why this invoice is being voided.');
  const { rows: [i] } = await q('select id, tenant_id, number, status from billing_invoices where id = $1 for update', [id]);
  if (!i) throw err(404, 'Invoice not found.');
  if (i.status === 'paid') throw err(409, 'A paid invoice cannot be voided. Record a credit note in your accounts instead.');
  if (i.status === 'void') throw err(409, 'This invoice is already void.');
  await q("update billing_invoices set status = 'void', void_reason = $2, voided_at = now() where id = $1", [id, String(reason).trim().slice(0, 300)]);
  await q("update billing_orders set status = 'resolved', failure_reason = 'Invoice voided' where invoice_id = $1 and status = 'created'", [id]);
  await audit(actor, 'billing.invoice_void', 'billing_invoice', id, { tenantId: i.tenant_id, number: i.number, reason });
  return getInvoice(id);
}

/* ================================================================== money in */

/**
 * The single place a payment settles an invoice. Locks the invoice, so an online payment, its webhook and a
 * vendor recording the same transfer by hand can race each other and the invoice is still paid exactly once.
 * Returns { already: true } when it was paid already.
 */
export async function settleInvoice(invoiceId, { method, reference = '', razorpayPaymentId = null, note = '', paidAt = null, actor = null, today = todayISO(), silent = false }) {
  const { rows: [inv] } = await q(`select ${INVOICE_COLS} from billing_invoices i where i.id = $1 for update`, [invoiceId]);
  if (!inv) throw err(404, 'Invoice not found.');
  if (inv.status === 'paid') return { already: true, invoice: inv };
  if (inv.status === 'void') throw err(409, 'This invoice was voided, so it cannot be paid.');

  // A complimentary (zero-value) invoice is settled without a payment row: no money moved
  if (inv.total > 0) {
    await q(
      `insert into billing_payments (tenant_id, invoice_id, amount, method, reference, razorpay_payment_id, note, paid_at, recorded_by)
       values ($1, $2, $3, $4, $5, $6, $7, coalesce($8::timestamptz, now()), $9)`,
      [inv.tenantId, inv.id, inv.total, method, reference, razorpayPaymentId, note, paidAt, actor?.id ?? null],
    );
  }
  await q("update billing_invoices set status = 'paid', paid_at = coalesce($2::timestamptz, now()) where id = $1", [inv.id, paidAt]);

  // The paid period extends coverage; it never shortens it. The chosen plan takes effect with the invoice that carries it.
  const sub = await subOrThrow(inv.tenantId, { lock: true });
  const extends_ = !sub.paidUntil || inv.periodEnd > sub.paidUntil;
  await q(
    `update tenant_subscriptions set status = 'active', suspended_reason = null, plan_key = $2, cycle = $3,
            current_period_end = case when $4 then $5::date else current_period_end end,
            current_period_start = case when $4 and $6::date <= $7::date then $6::date else current_period_start end,
            pending_plan_key = case when pending_plan_key = $2 then null else pending_plan_key end,
            pending_cycle = case when pending_plan_key = $2 then null else pending_cycle end,
            trial_notice = null, updated_at = now()
     where tenant_id = $1`,
    [inv.tenantId, inv.planKey, inv.cycle, extends_, inv.periodEnd, inv.periodStart, today],
  );
  await setTenantPlan(inv.tenantId, inv.planKey);
  const r = await q("update tenants set status = 'active', suspension_reason = null where id = $1 and suspension_reason = 'billing' returning id", [inv.tenantId]);
  const restored = r.rowCount > 0;

  await audit(actor, 'billing.payment', 'billing_invoice', inv.id, { tenantId: inv.tenantId, number: inv.number, amount: inv.total, method, restored });
  if (!silent) {
    await notify(inv.tenantId, 'subscriptionPaid', {
      number: inv.number, amount: inv.total, paidUntil: extends_ ? inv.periodEnd : sub.paidUntil, restored,
    });
  }
  return { already: false, restored, paidUntil: extends_ ? inv.periodEnd : sub.paidUntil, invoice: { ...inv, status: 'paid' } };
}

/** The vendor records money received outside the gateway: bank transfer, UPI to the account, cheque, cash. */
export async function recordOfflinePayment(invoiceId, body, actor, { today = todayISO() } = {}) {
  const b = body || {};
  if (!METHODS.includes(b.method)) throw err(400, `Method must be one of: ${METHODS.join(', ')}.`);
  const reference = String(b.reference ?? '').trim().slice(0, 120);
  if (b.method !== 'cash' && !reference) throw err(400, 'Enter the transaction or cheque reference so the payment can be traced.');
  if (b.paidOn !== undefined && b.paidOn !== '' && !isISO(b.paidOn)) throw err(400, 'Payment date must look like YYYY-MM-DD.');
  if (b.paidOn && b.paidOn > today) throw err(400, 'The payment date cannot be in the future.');
  const { rows: [inv] } = await q('select id, status, total from billing_invoices where id = $1', [invoiceId]);
  if (!inv) throw err(404, 'Invoice not found.');
  if (b.amount !== undefined && b.amount !== '' && Math.abs(Number(b.amount) - Number(inv.total)) > 0.005) {
    throw err(400, `The invoice total is ₹${Number(inv.total).toFixed(2)}. Part payments are not supported: record the full amount received.`);
  }
  const r = await settleInvoice(invoiceId, {
    method: b.method, reference, note: String(b.note ?? '').trim().slice(0, 300), paidAt: b.paidOn ? `${b.paidOn}T12:00:00+05:30` : null, actor, today,
  });
  if (r.already) throw err(409, 'This invoice is already paid.');
  return { ...r, invoice: await getInvoice(invoiceId) };
}

/** An institute picks a plan (after the trial, or after being locked): issues the first invoice for it. */
export async function choosePlan(tenantId, body, actor, { today = todayISO() } = {}) {
  const b = body || {};
  const plan = await planOrThrow(b.planKey);
  if (!plan.selectable) throw err(400, 'That plan cannot be chosen here.');
  const cycle = b.cycle ?? 'monthly';
  if (!calc.CYCLES.includes(cycle)) throw err(400, 'Billing cycle must be monthly or annual.');
  const sub = await subOrThrow(tenantId, { lock: true });
  const live = (await q("select number from billing_invoices where tenant_id = $1 and status = 'open' order by due_date limit 1", [tenantId])).rows[0];
  if (live && sub.planKey !== 'trial') throw err(409, `Invoice ${live.number} is already waiting to be paid. Pay it, or ask for a plan change from the next renewal.`, 'OPEN_INVOICE');

  const gaps = profileGaps(await getProfile(tenantId));
  if (gaps.length) throw err(409, `Add your billing details first (missing: ${gaps.join(', ')}).`, 'BILLING_DETAILS');

  if (live) await q("update billing_invoices set status = 'void', void_reason = 'Replaced: a plan was chosen', voided_at = now() where tenant_id = $1 and status = 'open'", [tenantId]);
  await q('update tenant_subscriptions set plan_key = $2, cycle = $3, pending_plan_key = null, pending_cycle = null, cancel_at_period_end = false, updated_at = now() where tenant_id = $1', [tenantId, plan.key, cycle]);
  await setTenantPlan(tenantId, plan.key);
  const invoice = await generateInvoice(tenantId, { source: 'plan_selection', actor, today });
  return { invoice, view: await subscriptionView(tenantId, { today }) };
}

/**
 * A small summary for the banner shown across the institute admin's screens. Runs in the institute's OWN
 * (tenant) context: the billing tables let an institute read exactly its own rows, so no platform access is needed.
 */
export async function billingNotice({ today = todayISO() } = {}) {
  const { rows: [s] } = await q('select status, plan_key, trial_ends_on, current_period_end, cancel_at_period_end from tenant_subscriptions');
  if (!s) return null;
  const { rows: [i] } = await q("select number, total::float8 as total, due_date from billing_invoices where status = 'open' order by due_date limit 1");
  if (i) {
    const days = calc.daysBetween(today, i.due_date);
    if (days < 0) return { kind: 'overdue', number: i.number, total: i.total, dueDate: i.due_date, daysOverdue: -days };
    if (days <= 7) return { kind: 'due', number: i.number, total: i.total, dueDate: i.due_date, daysLeft: days };
    return null;
  }
  if (s.status === 'trialing' && s.plan_key === 'trial') {
    const days = calc.daysBetween(today, s.trial_ends_on);
    if (days <= 7) return { kind: 'trial', daysLeft: Math.max(days, 0), endsOn: s.trial_ends_on };
  }
  if (s.cancel_at_period_end && s.current_period_end) return { kind: 'cancelling', endsOn: s.current_period_end };
  return null;
}

import { env } from '../config/env.js';
import { HttpError } from '../middleware/error.js';
import { isISO } from '../utils/dates.js';
import { STATES } from '../config/indianStates.js';
import * as billing from '../services/billing.service.js';
import * as consoleSvc from '../services/billingConsole.service.js';
import * as pay from '../services/billingPayments.service.js';
import { runBilling } from '../services/billingRun.service.js';
import { streamInvoicePdf } from '../services/invoicepdf.service.js';
import { audit } from '../db/audit.js';

const { asPlatform } = billing;
const STATUSES = ['open', 'paid', 'void', 'overdue'];

/* ============================================================== vendor console (platform context) */

export const overview = async (req, res) => res.json(await consoleSvc.overview());
export const plans = async (req, res) => res.json({ plans: await billing.listPlans(), gstRate: env.BILLING_GST_RATE, trialDays: env.BILLING_TRIAL_DAYS, states: STATES });
export const updatePlan = async (req, res) => res.json({ plan: await billing.updatePlan(req.params.key, req.body, req.user) });
export const subscriptions = async (req, res) => res.json({ subscriptions: await consoleSvc.listSubscriptions() });

export async function tenantBilling(req, res) {
  const view = await billing.subscriptionView(req.params.id);
  res.json({ ...view, invoices: await billing.listInvoices({ tenantId: req.params.id, limit: 100 }), states: STATES });
}
export const updateSubscription = async (req, res) => res.json(await billing.updateSubscription(req.params.id, req.body, req.user));
export async function saveProfile(req, res) {
  await billing.saveProfile(req.params.id, req.body, req.user);
  res.json(await billing.subscriptionView(req.params.id));
}
export async function generate(req, res) {
  const invoice = await billing.generateInvoice(req.params.id, { source: 'manual', actor: req.user });
  res.status(201).json({ invoice });
}
export async function choosePlanFor(req, res) {
  res.status(201).json(await billing.choosePlan(req.params.id, req.body, req.user));
}

function invoiceFilters(req) {
  const { status, from, to, search, tenantId } = req.query;
  if (status && !STATUSES.includes(status)) throw new HttpError(400, `Status must be one of: ${STATUSES.join(', ')}.`);
  for (const [k, v] of [['from', from], ['to', to]]) if (v && !isISO(v)) throw new HttpError(400, `${k} must look like YYYY-MM-DD.`);
  return { status: status || undefined, from: from || undefined, to: to || undefined, tenantId: tenantId || undefined, search: typeof search === 'string' && search.trim() ? search.trim().slice(0, 80) : undefined };
}

export async function invoices(req, res) {
  const format = String(req.query.format || 'json').toLowerCase();
  const filters = invoiceFilters(req);
  if (format === 'json') return res.json({ invoices: await billing.listInvoices(filters) });
  if (!['csv', 'xlsx'].includes(format)) throw new HttpError(400, 'Format must be json, csv or xlsx.');
  const register = await consoleSvc.invoiceRegister(filters);
  await audit(req.user, 'billing.register_export', 'billing', null, { format, rows: register.rows.length });
  await req.tx.commit();
  if (format === 'csv') {
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="invoice-register.csv"' });
    return res.send(consoleSvc.registerCsv(register));
  }
  res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': 'attachment; filename="invoice-register.xlsx"' });
  return res.send(consoleSvc.registerXlsx(register));
}

export const invoice = async (req, res) => res.json({ invoice: await billing.getInvoice(req.params.invoiceId) });
export async function invoicePdf(req, res) {
  const inv = await billing.getInvoice(req.params.invoiceId);
  await req.tx.commit();
  streamInvoicePdf(res, inv, { filename: `invoice-${inv.number.replace(/\//g, '-')}.pdf` });
}
export const voidInvoice = async (req, res) => res.json({ invoice: await billing.voidInvoice(req.params.invoiceId, req.body?.reason, req.user) });
export async function recordPayment(req, res) {
  const r = await billing.recordOfflinePayment(req.params.invoiceId, req.body, req.user);
  res.status(201).json({ invoice: r.invoice, restored: r.restored, paidUntil: r.paidUntil });
}
export const remind = async (req, res) => res.json(await consoleSvc.remindInvoice(req.params.invoiceId));
export const runNow = async (req, res) => {
  const result = await runBilling();
  await audit(req.user, 'billing.run_now', 'billing', null, { generated: result.generated, suspended: result.suspended, reminders: result.reminders });
  res.json({ result });
};
export const reviewOrders = async (req, res) => res.json({ orders: await pay.listReviewOrders() });
export async function resolveOrder(req, res) {
  await pay.resolveReviewOrder(req.params.orderId, req.body?.note, req.user);
  res.json({ ok: true });
}

/* ============================================================== the institute's own Billing page (admin role) */
// These run in the institute admin's TENANT-scoped request, but billing data is platform-owned: each handler
// steps into platform context with the tenant id taken from the SIGNED session, never from the client.

const mine = (req) => req.user.tenantId;
const ownInvoice = async (req) => {
  const inv = await billing.getInvoice(req.params.invoiceId);
  if (inv.tenantId !== mine(req)) throw new HttpError(404, 'Invoice not found.');
  return inv;
};

export async function myBilling(req, res) {
  res.json(await asPlatform(async () => {
    const view = await billing.subscriptionView(mine(req));
    const v = billing.vendorDetails();
    return {
      ...view, states: STATES, invoices: await billing.listInvoices({ tenantId: mine(req), limit: 36 }),
      online: { enabled: env.RAZORPAY_ENABLED, keyId: env.RAZORPAY_ENABLED ? env.RAZORPAY_KEY_ID : null },
      payTo: { name: v.name, bank: v.bank, upi: v.upi, email: v.email }, gstRate: env.BILLING_GST_RATE,
    };
  }));
}
export const myProfile = async (req, res) => res.json({ profile: await asPlatform(() => billing.saveProfile(mine(req), req.body, req.user)) });
export const myChoosePlan = async (req, res) => res.status(201).json(await asPlatform(() => billing.choosePlan(mine(req), req.body, req.user)));
export const myChange = async (req, res) => res.json(await asPlatform(() => billing.requestChange(mine(req), req.body, req.user)));
export async function myInvoicePdf(req, res) {
  const inv = await asPlatform(() => ownInvoice(req));
  await req.tx.commit();
  streamInvoicePdf(res, inv, { filename: `invoice-${inv.number.replace(/\//g, '-')}.pdf` });
}
export const myOrder = async (req, res) => res.status(201).json(await asPlatform(async () => {
  await ownInvoice(req);
  return pay.createOrder({ tenantId: mine(req), invoiceId: req.params.invoiceId, user: req.user });
}));
export const myVerify = async (req, res) => res.json(await asPlatform(() => pay.verifyPayment({ tenantId: mine(req), user: req.user, body: req.body })));

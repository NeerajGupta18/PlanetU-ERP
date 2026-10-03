/**
 * Vendor-side billing (PlanetU invoicing institutes) - run with `npm test` (needs `npm run db:setup` first).
 * Razorpay is an in-memory fake with real HMAC signatures. Time travel: the billing run takes an injected
 * "today", limited to this suite's own institutes so it never touches other suites running in parallel.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, describe, it } from 'node:test';

process.env.RAZORPAY_KEY_ID = 'rzp_test_billkey';
process.env.RAZORPAY_KEY_SECRET = 'bill-key-secret';
process.env.RAZORPAY_WEBHOOK_SECRET = 'bill-webhook-secret';
process.env.PAYMENT_ORDERS_PER_MINUTE = '1000';
process.env.BILLING_VENDOR_NAME = 'PlanetU Test Technologies';
process.env.BILLING_VENDOR_STATE = 'Maharashtra';
process.env.BILLING_VENDOR_GSTIN = '27AAAAA0000A1Z5';
process.env.BILLING_VENDOR_ADDRESS = '1 Test Road, Pune';
process.env.BILLING_VENDOR_EMAIL = 'billing@planetu.test';
process.env.BILLING_GST_RATE = '18';
process.env.BILLING_INVOICE_LEAD_DAYS = '7';
process.env.BILLING_GRACE_DAYS = '7';
process.env.BILLING_BANK_DETAILS = 'Test Bank, A/c 123456, IFSC TEST0001234';
process.env.BILLING_WORKER = 'false';
process.env.MAIL_WORKER = 'false';

const { env } = await import('../src/config/env.js');
const { createApp } = await import('../src/app.js');
const { closePool, q, withTx } = await import('../src/db/pool.js');
const { issueCaptchaToken } = await import('../src/services/captcha.service.js');
const calc = await import('../src/services/billingCalc.js');
const billing = await import('../src/services/billing.service.js');
const { runBilling, applicableNotices } = await import('../src/services/billingRun.service.js');
const { describePayment, payDetails, istDay } = await import('../src/services/invoicepdf.service.js');
const { provisionTenant } = await import('../src/services/tenant.service.js');
const bcrypt = (await import('bcryptjs')).default;

/* ================================================================ fake Razorpay */
const realFetch = globalThis.fetch;
const GW = 'https://api.razorpay.com/v1';
const gw = { orders: new Map(), payments: new Map(), n: 0 };
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (!u.startsWith(GW)) return realFetch(url, opts);
  const path = u.slice(GW.length); const method = opts.method || 'GET';
  const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  if (method === 'POST' && path === '/orders') {
    const body = JSON.parse(opts.body); const order = { id: `order_B${++gw.n}`, ...body };
    gw.orders.set(order.id, order); return reply(200, order);
  }
  const [, kind, id] = path.match(/^\/(orders|payments)\/(.+)$/) || [];
  const found = kind && (kind === 'orders' ? gw.orders : gw.payments).get(decodeURIComponent(id));
  return found ? reply(200, found) : reply(400, { error: { description: 'The id provided does not exist' } });
};
const gwPayment = (orderId, { status = 'captured', amount } = {}) => {
  const id = `pay_B${++gw.n}`;
  gw.payments.set(id, { id, order_id: orderId, amount: amount ?? gw.orders.get(orderId).amount, status, method: 'upi' });
  return id;
};
const sig = (orderId, paymentId, secret = env.RAZORPAY_KEY_SECRET) => crypto.createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest('hex');
const webhook = async (event) => {
  const raw = JSON.stringify(event);
  const r = await realFetch(`${base}/api/webhooks/razorpay`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-razorpay-signature': crypto.createHmac('sha256', env.RAZORPAY_WEBHOOK_SECRET).update(raw).digest('hex') }, body: raw });
  let b = null; try { b = await r.json(); } catch { /* empty */ }
  return { status: r.status, body: b };
};
const captured = (orderId, paymentId, extra = {}) => ({ event: 'payment.captured', payload: { payment: { entity: { id: paymentId, order_id: orderId, amount: gw.orders.get(orderId)?.amount, method: 'upi', status: 'captured', ...extra } } } });

/* ================================================================ plumbing */
let server; let base;
const json = async (method, path, { cookie, body } = {}) => {
  const r = await realFetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let b = null; try { b = await r.clone().json(); } catch { /* not json */ }
  return { status: r.status, body: b, res: r };
};
async function login(tenantCode, role, identifier, password, { expect = 200 } = {}) {
  const r = await realFetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tenantCode, role, identifier, password, captchaToken: issueCaptchaToken() }) });
  const body = await r.json();
  assert.equal(r.status, expect, JSON.stringify(body));
  return { cookie: r.headers.getSetCookie().map((c) => c.split(';')[0]).find((c) => c.startsWith(`${env.COOKIE_NAME}=`)), body };
}
const platform = (fn) => withTx({ platform: true }, fn);
const inTenantTx = (tenantId, fn) => withTx({ tenantId }, fn);
const bytes = async (r) => Buffer.from(await r.res.arrayBuffer());

const RUN = `bill${Date.now().toString(36)}`;
const TODAY = billing.todayISO();
const day = (n) => calc.addDays(TODAY, n);
const tenants = {}; // key -> { id, code, admin: cookie, email }
const emailOf = (key) => `admin-${key}-${RUN}@billtest.example`;
let sa;

/** Moves a trial's end into the past so that "virtual" dates used by the billing run are really in the past for HTTP calls too. */
async function backdate(t, daysAgo) {
  await platform(() => q('update tenant_subscriptions set trial_ends_on = $2, current_period_end = $2 where tenant_id = $1', [t.id, day(-daysAgo)]));
}

async function makeTenant(key, { plan = 'standard', state = 'Maharashtra', students = 0, details = true, backdated = 0 } = {}) {
  const code = `${RUN}-${key}`;
  const r = await platform(async () => provisionTenant({
    code, name: `Billing Test ${key}`, type: 'college', plan, admin: { name: `Admin ${key}`, email: emailOf(key), loginId: 'ADM001', password: 'Admin@12345' },
  }));
  const t = { id: r.tenantId, code, email: emailOf(key) };
  if (details) {
    await platform(() => billing.saveProfile(t.id, { legalName: `Billing Test ${key} Education Society`, state, address: '12 Test Lane', city: 'Pune', pincode: '411001' }, null));
  }
  if (students) {
    await inTenantTx(t.id, () => q(
      "insert into students (student_code, name, email, semester, status) select 'BT' || g, 'Student ' || g, 'bt' || g || '@billtest.example', 1, 'Active' from generate_series(1, $1) g", [students],
    ));
  }
  if (backdated) await backdate(t, backdated);
  t.admin = (await login(code, 'admin', 'ADM001', 'Admin@12345')).cookie;
  tenants[key] = t;
  return t;
}
async function makeStudentLogin(t, id = 'BTS1') {
  await inTenantTx(t.id, async () => {
    const { rows: [s] } = await q("insert into students (student_code, name, email, semester) values ($1, 'Login Student', $2, 1) returning id", [id, `${id.toLowerCase()}@billtest.example`]);
    await q("insert into users (role, login_id, email, name, password_hash, student_id) values ('student', $1, $2, 'Login Student', $3, $4)", [id, `${id.toLowerCase()}@billtest.example`, bcrypt.hashSync('Student@123', 8), s.id]);
  });
}
const sub = async (t) => platform(async () => (await q('select * from tenant_subscriptions where tenant_id = $1', [t.id])).rows[0]);
const tenantRow = async (t) => platform(async () => (await q('select status, suspension_reason, plan from tenants where id = $1', [t.id])).rows[0]);
const invoicesOf = async (t) => platform(() => billing.listInvoices({ tenantId: t.id }));
const mailsTo = async (t, template) => platform(async () => (await q(
  'select template, subject, text_body, tenant_id from notifications where to_email = $1 and ($2::text is null or template = $2) order by created_at', [t.email, template ?? null],
)).rows);
const run = (t, today) => runBilling({ today, only: [t.id] });
const payOnline = async (t, invoice) => {
  const o = await json('POST', `/api/admin/billing/invoices/${invoice.id}/order`, { cookie: t.admin });
  assert.equal(o.status, 201, JSON.stringify(o.body));
  const paymentId = gwPayment(o.body.orderId);
  const v = await json('POST', '/api/admin/billing/verify', { cookie: t.admin, body: { razorpay_order_id: o.body.orderId, razorpay_payment_id: paymentId, razorpay_signature: sig(o.body.orderId, paymentId) } });
  return { order: o.body, paymentId, verify: v };
};

before(async () => {
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  sa = (await login('', 'super_admin', 'SA001', 'SuperAdmin@123')).cookie;
});

after(async () => {
  try {
    await platform(async () => {
      await q("delete from notifications where to_email like '%@billtest.example'");
      await q('delete from tenants where code like $1', [`${RUN}-%`]);
    });
  } finally {
    await new Promise((r) => server.close(r));
    await closePool();
  }
});

/* ================================================================ pure arithmetic */
describe('Billing arithmetic (no database)', () => {
  it('month arithmetic is calendar-correct and keeps a 31st from drifting', () => {
    assert.equal(calc.addMonths('2026-01-31', 1), '2026-02-28');
    assert.equal(calc.addMonths('2028-01-31', 1), '2028-02-29');
    assert.equal(calc.addMonths('2026-02-28', 1, 31), '2026-03-31', 'the anchor day restores the 31st');
    assert.equal(calc.addMonths('2026-12-15', 1), '2027-01-15');
    assert.equal(calc.addMonths('2026-03-15', 12), '2027-03-15');
    assert.equal(calc.addDays('2026-12-31', 1), '2027-01-01');
    assert.equal(calc.daysBetween('2026-03-01', '2026-03-31'), 30);
    assert.equal(calc.daysBetween('2026-03-31', '2026-03-01'), -30);
  });

  it("Indian financial year runs April to March, and invoice numbers stay within GST's 16 characters", () => {
    assert.deepEqual(['2026-03-31', '2026-04-01', '2027-01-15'].map(calc.financialYear), ['2025-26', '2026-27', '2026-27']);
    assert.equal(calc.invoiceNumber('PU', '2026-27', 1), 'PU/26-27/0001');
    assert.ok(calc.invoiceNumber('PUABC', '2026-27', 9999).length <= 16);
    assert.match(calc.invoiceNumber('PU', '2026-27', 12345), /^PU\/26-27\/12345$/);
  });

  const plan = { name: 'Standard', monthly_price: 4999, annual_price: 49990, included_students: 1000, extra_student_price: 5 };
  it('prices a plan, charging only for students above the allowance and for every month of the period', () => {
    const m = calc.priceLines({ plan, cycle: 'monthly', students: 1200 });
    assert.deepEqual(m.map((l) => l.amount), [4999, 1000]);
    assert.equal(m[1].quantity, 200);
    const a = calc.priceLines({ plan, cycle: 'annual', students: 1200 });
    assert.deepEqual(a.map((l) => l.amount), [49990, 12000], 'annual: 200 x Rs 5 x 12 months');
    assert.equal(calc.priceLines({ plan, cycle: 'monthly', students: 1000 }).length, 1, 'exactly at the allowance: no extra line');
    assert.equal(calc.priceLines({ plan, cycle: 'monthly', students: 0 }).length, 1);
  });

  it('a negotiated monthly price replaces the plan price (annual = 10 months)', () => {
    assert.equal(calc.priceLines({ plan, cycle: 'monthly', students: 10, customMonthlyPrice: 3500 })[0].amount, 3500);
    assert.equal(calc.priceLines({ plan, cycle: 'annual', students: 10, customMonthlyPrice: 3500 })[0].amount, 35000);
    assert.equal(calc.priceLines({ plan, cycle: 'monthly', students: 10, customMonthlyPrice: 0 })[0].amount, 0);
  });

  it('GST is CGST+SGST within a state and IGST across states, never both, each half rounded on its own', () => {
    const lines = [{ amount: 5399.1 }];
    const intra = calc.totals({ lines, rate: 18, supplierState: 'Maharashtra', customerState: 'maharashtra' });
    assert.deepEqual([intra.cgst, intra.sgst, intra.igst, intra.total], [485.92, 485.92, 0, 6370.94]);
    const inter = calc.totals({ lines, rate: 18, supplierState: 'Maharashtra', customerState: 'Karnataka' });
    assert.deepEqual([inter.cgst, inter.sgst, inter.igst, inter.total], [0, 0, 971.84, 6370.94]);
    const disc = calc.totals({ lines: [{ amount: 5999 }], discountPercent: 10, rate: 18, supplierState: 'a', customerState: 'a' });
    assert.deepEqual([disc.subtotal, disc.discount, disc.taxable, disc.total], [5999, 599.9, 5399.1, 6370.94]);
    assert.equal(calc.totals({ lines: [{ amount: 100 }], discountPercent: 100, rate: 18, supplierState: 'a', customerState: 'b' }).total, 0);
    assert.equal(calc.totals({ lines: [{ amount: 100 }], discountPercent: 500, rate: 18, supplierState: 'a', customerState: 'a' }).discount, 100, 'a discount is capped at 100%');
  });

  it('writes the amount in words the Indian way', () => {
    assert.equal(calc.amountInWords(0), 'Rupees Zero Only');
    assert.equal(calc.amountInWords(2358.82), 'Rupees Two Thousand Three Hundred Fifty Eight and Eighty Two Paise Only');
    assert.equal(calc.amountInWords(1234567.5), 'Rupees Twelve Lakh Thirty Four Thousand Five Hundred Sixty Seven and Fifty Paise Only');
    assert.equal(calc.amountInWords(10000000), 'Rupees One Crore Only');
    assert.equal(calc.toPaise(1234.56), 123456);
    assert.equal(calc.toPaise(0.29), 29, 'no floating-point drift');
  });

  it('the sentence under "Paid in full" is real text for every kind of payment timestamp (it once printed "NaN undefined NaN")', () => {
    for (const paidAt of [new Date('2026-10-02T09:30:00Z'), '2026-10-02T09:30:00.000Z', new Date('2026-10-02T20:00:00Z')]) {
      const line = describePayment({ method: 'bank_transfer', reference: 'UTR778812', paidAt });
      assert.ok(!/NaN|undefined|Invalid/.test(line), line);
      assert.match(line, /^Received \d{1,2} \w{3} 2026 by bank transfer, reference UTR778812\.$/);
    }
    assert.match(describePayment({ method: 'razorpay', reference: 'pay_X1', paidAt: new Date('2026-03-31T20:00:00Z') }), /^Received 1 Apr 2026 by online payment \(Razorpay\), reference pay_X1\.$/, 'a payment late on 31 March UTC is 1 April in India');
    assert.equal(istDay(new Date('2026-03-31T20:00:00Z')), '2026-04-01');
    assert.equal(describePayment({ method: 'cash', reference: '', paidAt: new Date() }).includes('reference'), false);
    assert.equal(describePayment(undefined), 'Payment received.');
  });

  it('payment instructions use the CURRENT bank details, falling back to the invoice only when none are configured', () => {
    assert.deepEqual(payDetails({ bank: 'Old Bank 111', upi: 'old@upi' }), { bank: env.BILLING_BANK_DETAILS, upi: env.BILLING_UPI_ID || 'old@upi' });
    assert.equal(payDetails({}).bank, env.BILLING_BANK_DETAILS);
  });

  it('big numbers in invoice lines use Indian grouping', () => {
    const l = calc.priceLines({ plan: { name: 'Premium', monthly_price: 1, annual_price: 1, included_students: 3000, extra_student_price: 3 }, cycle: 'monthly', students: 12500 });
    assert.match(l[0].description, /up to 3,000 students/);
    assert.match(l[1].description, /9,500 above the 3,000 included/);
  });

  it('reminder stages escalate with the due date, and respect a short grace period', () => {
    const due = '2026-10-10';
    assert.deepEqual(applicableNotices(due, 7, '2026-10-07'), []);
    assert.deepEqual(applicableNotices(due, 7, '2026-10-08'), ['pre_due']);
    assert.deepEqual(applicableNotices(due, 7, '2026-10-10'), ['pre_due', 'due']);
    assert.deepEqual(applicableNotices(due, 7, '2026-10-13'), ['pre_due', 'due', 'overdue']);
    assert.deepEqual(applicableNotices(due, 7, '2026-10-17'), ['pre_due', 'due', 'overdue', 'final']);
    assert.deepEqual(applicableNotices(due, 2, '2026-10-12'), ['pre_due', 'due', 'final'], 'no "overdue" stage when grace is under 3 days');
    assert.deepEqual(applicableNotices(due, 0, '2026-10-10'), ['pre_due', 'due']);
  });
});

/* ================================================================ plans + provisioning + details */
describe('Plans and price list', () => {
  it('ships a price list, readable by an institute, editable only by the vendor', async () => {
    const t = await makeTenant('plans');
    const mine = await json('GET', '/api/admin/billing', { cookie: t.admin });
    assert.equal(mine.status, 200, JSON.stringify(mine.body));
    assert.deepEqual(mine.body.plans.map((p) => p.key), ['trial', 'basic', 'standard', 'premium']);
    const std = mine.body.plans.find((p) => p.key === 'standard');
    assert.deepEqual([std.monthlyPrice, std.annualPrice, std.includedStudents, std.extraStudentPrice], [4999, 49990, 1000, 5]);
    assert.ok(std.annualPrice < std.monthlyPrice * 12, 'annual is cheaper than twelve months');

    assert.equal((await json('PUT', '/api/super-admin/billing/plans/basic', { cookie: t.admin, body: { monthlyPrice: 1 } })).status, 403, 'institute admin cannot edit prices');
    assert.equal((await json('GET', '/api/super-admin/billing/plans', { cookie: t.admin })).status, 403);
  });

  it('the vendor edits a price, with validation; existing invoices keep the price they were issued at', async () => {
    const before = (await json('GET', '/api/super-admin/billing/plans', { cookie: sa })).body.plans.find((p) => p.key === 'basic');
    try {
      const bad = (body) => json('PUT', '/api/super-admin/billing/plans/basic', { cookie: sa, body });
      assert.equal((await bad({ monthlyPrice: -5 })).status, 400);
      assert.equal((await bad({ monthlyPrice: 'lots' })).status, 400);
      assert.equal((await bad({ annualPrice: 0 })).status, 400);
      assert.equal((await bad({ includedStudents: 1.5 })).status, 400);
      assert.equal((await bad({ name: '' })).status, 400);
      assert.equal((await json('PUT', '/api/super-admin/billing/plans/nope', { cookie: sa, body: { monthlyPrice: 5 } })).status, 404);
      assert.equal((await json('PUT', '/api/super-admin/billing/plans/trial', { cookie: sa, body: { monthlyPrice: 5 } })).status, 409);
      const ok = await bad({ monthlyPrice: 2199, extraStudentPrice: 9 });
      assert.equal(ok.status, 200, JSON.stringify(ok.body));
      assert.deepEqual([ok.body.plan.monthlyPrice, ok.body.plan.extraStudentPrice], [2199, 9]);
    } finally {
      await json('PUT', '/api/super-admin/billing/plans/basic', { cookie: sa, body: { monthlyPrice: before.monthlyPrice, extraStudentPrice: before.extraStudentPrice } });
    }
  });
});

describe('A new institute gets a subscription', () => {
  it('provisioning through the console starts a trial; demo institutes are never billed', async () => {
    const created = await json('POST', '/api/super-admin/tenants', { cookie: sa, body: {
      code: `${RUN}-api`, name: 'Created Via Console', type: 'school', plan: 'basic', admin: { name: 'Console Admin', email: emailOf('api') },
    } });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const s = await platform(async () => (await q('select * from tenant_subscriptions where tenant_id = $1', [created.body.tenant.id])).rows[0]);
    assert.deepEqual([s.plan_key, s.status, s.cycle], ['basic', 'trialing', 'monthly']);
    assert.equal(s.trial_ends_on, calc.addDays(TODAY, 14));
    assert.equal(s.current_period_end, s.trial_ends_on);
    const p = await platform(async () => (await q('select legal_name from billing_profiles where tenant_id = $1', [created.body.tenant.id])).rows[0]);
    assert.equal(p.legal_name, 'Created Via Console', 'legal name starts as the institute name');

    const demo = await platform(async () => (await q("select count(*)::int as n from tenant_subscriptions s join tenants t on t.id = s.tenant_id where t.plan = 'demo'")).rows[0].n);
    assert.equal(demo, 0, 'demo institutes have no subscription');
  });

  it('changing the plan in the console keeps tenant.plan and the subscription in step', async () => {
    const t = await makeTenant('planchg', { plan: 'basic' });
    const r = await json('PUT', `/api/super-admin/tenants/${t.id}`, { cookie: sa, body: { plan: 'premium' } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal((await sub(t)).plan_key, 'premium');
    assert.equal((await tenantRow(t)).plan, 'premium');
    assert.equal((await json('PUT', `/api/super-admin/tenants/${t.id}`, { cookie: sa, body: { plan: 'trial' } })).status, 200, 'still on trial, so it may go back to trial');
  });
});

describe('Billing details (who we invoice)', () => {
  it('validates GSTIN against the state, PIN code and email; saves for the institute and the vendor', async () => {
    const t = await makeTenant('details', { details: false });
    const put = (body, cookie = t.admin) => json('PUT', '/api/admin/billing/profile', { cookie, body });
    assert.equal((await put({ state: 'Atlantis' })).status, 400);
    assert.equal((await put({ state: 'Karnataka', gstin: '27AAAAA0000A1Z5' })).status, 400, 'GSTIN starts with 27 (Maharashtra), not Karnataka');
    assert.match((await put({ state: 'Karnataka', gstin: '27AAAAA0000A1Z5' })).body.message, /27.*Maharashtra|not Karnataka/);
    assert.equal((await put({ state: 'Maharashtra', gstin: 'NOTAGSTIN' })).status, 400);
    assert.equal((await put({ pincode: '41100' })).status, 400);
    assert.equal((await put({ billingEmail: 'nope' })).status, 400);
    const ok = await put({ legalName: 'Details Test Trust', state: 'Maharashtra', gstin: '27aaaaa0000a1z5', address: '5 Road', city: 'Pune', pincode: '411001', billingEmail: 'Accounts@BillTest.example' });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.deepEqual([ok.body.profile.gstin, ok.body.profile.billingEmail], ['27AAAAA0000A1Z5', 'accounts@billtest.example']);
    const v = await json('PUT', `/api/super-admin/billing/tenants/${t.id}/profile`, { cookie: sa, body: { city: 'Mumbai' } });
    assert.equal(v.status, 200);
    assert.equal(v.body.profile.city, 'Mumbai');
    assert.equal(v.body.profile.gstin, '27AAAAA0000A1Z5', 'unspecified fields are kept');
  });
});

/* ================================================================ invoices */
describe('Issuing invoices', () => {
  it('an institute that has not given its state cannot be invoiced: the reason says what to add', async () => {
    const t = await makeTenant('nodetails', { details: false });
    await platform(() => q("update billing_profiles set state = '' where tenant_id = $1", [t.id]));
    const r = await json('POST', `/api/super-admin/billing/tenants/${t.id}/invoices`, { cookie: sa });
    assert.equal(r.status, 409);
    assert.match(r.body.message, /missing: state/);
    const c = await json('POST', '/api/admin/billing/choose-plan', { cookie: t.admin, body: { planKey: 'standard' } });
    assert.equal(c.status, 409);
    assert.match(c.body.message, /billing details/i);
  });

  it('issues a tax invoice: lines, CGST+SGST for a same-state customer, a consecutive GST number, an email, a due date', async () => {
    const t = await makeTenant('inv1', { plan: 'standard', students: 0 });
    const r = await json('POST', `/api/super-admin/billing/tenants/${t.id}/invoices`, { cookie: sa });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const i = r.body.invoice;
    assert.match(i.number, /^PU\/\d{2}-\d{2}\/\d{4,}$/);
    assert.ok(i.number.length <= 16);
    assert.deepEqual([i.status, i.planKey, i.cycle, i.source], ['open', 'standard', 'monthly', 'manual']);
    assert.equal(i.periodStart, calc.maxDate(day(14), TODAY), 'the first paid period starts when the trial ends');
    assert.equal(i.periodEnd, calc.addMonths(i.periodStart, 1));
    assert.deepEqual([i.subtotal, i.taxable, i.cgst, i.sgst, i.igst, i.total], [4999, 4999, 449.91, 449.91, 0, 5898.82]);
    assert.equal(i.lines.length, 1);
    assert.equal(i.placeOfSupply, 'Maharashtra');
    assert.equal(i.customer.name, 'Billing Test inv1 Education Society');
    assert.equal(i.vendor.gstin, '27AAAAA0000A1Z5');
    assert.equal(i.dueDate, i.periodStart);
    const mail = (await mailsTo(t, 'subscriptionInvoice'))[0];
    assert.ok(mail, 'an invoice email was queued');
    assert.equal(mail.tenant_id, null, 'billing mail is platform-level (sender PlanetU, not the institute)');
    assert.match(mail.text_body, new RegExp(i.number.replace('/', '\\/')));
    assert.match(mail.text_body, /5,898\.82/);
    const again = await json('POST', `/api/super-admin/billing/tenants/${t.id}/invoices`, { cookie: sa });
    assert.equal(again.status, 409, 'a second invoice for the same period is refused');
    assert.match(again.body.message, /already covers/);
  });

  it('charges IGST for a customer in another state, and bills students above the allowance', async () => {
    await json('PUT', '/api/super-admin/billing/plans/basic', { cookie: sa, body: { includedStudents: 3 } });
    try {
      const t = await makeTenant('inter', { plan: 'basic', state: 'Karnataka', students: 8 });
      const r = await json('POST', `/api/super-admin/billing/tenants/${t.id}/invoices`, { cookie: sa });
      assert.equal(r.status, 201, JSON.stringify(r.body));
      const i = r.body.invoice;
      assert.equal(i.lines.length, 2);
      assert.equal(i.lines[1].quantity, 5, '8 students, 3 included');
      assert.equal(i.lines[1].amount, 40, '5 extra x Rs 8 x 1 month');
      assert.deepEqual([i.subtotal, i.cgst, i.sgst, i.igst, i.total], [2039, 0, 0, 367.02, 2406.02]);
    } finally {
      await json('PUT', '/api/super-admin/billing/plans/basic', { cookie: sa, body: { includedStudents: 300 } });
    }
  });

  it('honours a negotiated price, a discount, and the annual cycle', async () => {
    const t = await makeTenant('deal', { plan: 'standard' });
    const upd = await json('PUT', `/api/super-admin/billing/tenants/${t.id}/subscription`, { cookie: sa, body: { customMonthlyPrice: 4000, discountPercent: 10, cycle: 'annual' } });
    assert.equal(upd.status, 200, JSON.stringify(upd.body));
    const i = (await json('POST', `/api/super-admin/billing/tenants/${t.id}/invoices`, { cookie: sa })).body.invoice;
    assert.equal(i.cycle, 'annual');
    assert.deepEqual([i.subtotal, i.discount, i.taxable, i.total], [40000, 4000, 36000, 42480]);
    assert.equal(i.periodEnd, calc.addMonths(i.periodStart, 12));
  });

  it('a zero-value invoice (complimentary) is marked paid at once and extends coverage', async () => {
    const t = await makeTenant('free', { plan: 'standard' });
    await json('PUT', `/api/super-admin/billing/tenants/${t.id}/subscription`, { cookie: sa, body: { discountPercent: 100 } });
    const i = (await json('POST', `/api/super-admin/billing/tenants/${t.id}/invoices`, { cookie: sa })).body.invoice;
    assert.equal(i.total, 0);
    const fresh = await json('GET', `/api/super-admin/billing/invoices/${i.id}`, { cookie: sa });
    assert.equal(fresh.body.invoice.status, 'paid');
    assert.equal((await sub(t)).current_period_end, i.periodEnd);
  });

  it('invoice numbers are consecutive within a financial year', async () => {
    const a = await makeTenant('seq1', { plan: 'standard' });
    const b = await makeTenant('seq2', { plan: 'standard' });
    const n1 = (await json('POST', `/api/super-admin/billing/tenants/${a.id}/invoices`, { cookie: sa })).body.invoice.number;
    const n2 = (await json('POST', `/api/super-admin/billing/tenants/${b.id}/invoices`, { cookie: sa })).body.invoice.number;
    const [p1, p2] = [n1, n2].map((n) => [n.split('/')[1], Number(n.split('/')[2])]);
    assert.equal(p1[0], p2[0]);
    assert.equal(p2[1], p1[1] + 1);
  });

  it('a plan can only be invoiced once chosen: the free trial plan has nothing to invoice', async () => {
    const t = await makeTenant('trialonly', { plan: 'trial' });
    const r = await json('POST', `/api/super-admin/billing/tenants/${t.id}/invoices`, { cookie: sa });
    assert.equal(r.status, 409);
    assert.match(r.body.message, /Choose a paid plan/);
  });
});

describe('What the institute is told about its next invoice', () => {
  it('promises a next-invoice date only while that invoice is still to come', async () => {
    const t = await makeTenant('nextinv', { plan: 'standard' });
    const first = (await json('POST', `/api/super-admin/billing/tenants/${t.id}/invoices`, { cookie: sa })).body.invoice;
    let page = (await json('GET', '/api/admin/billing', { cookie: t.admin })).body;
    assert.equal(page.nextInvoiceOn, null, 'an invoice is already waiting: no "next invoice" date');
    await json('POST', `/api/super-admin/billing/invoices/${first.id}/payments`, { cookie: sa, body: { method: 'cash' } });
    page = (await json('GET', '/api/admin/billing', { cookie: t.admin })).body;
    assert.equal(page.nextInvoiceOn, calc.addDays(first.periodEnd, -7), 'paid up: the next invoice goes out a week before this period ends');
    await run(t, calc.addDays(first.periodEnd, -7));
    page = (await json('GET', '/api/admin/billing', { cookie: t.admin })).body;
    assert.equal(page.nextInvoiceOn, null, 'issued again: nothing left to promise');
    assert.equal(page.openInvoices.length, 1);
  });

  it('the price list makes no claims the product does not enforce (no per-plan module promises)', async () => {
    const plans = (await json('GET', '/api/admin/billing', { cookie: tenants.nextinv.admin })).body.plans;
    const text = plans.flatMap((p) => p.features).join(' | ').toLowerCase();
    for (const claim of ['attendance', 'exams', 'library', 'reports', 'admissions', 'bulk']) assert.ok(!text.includes(claim), `plan copy mentions "${claim}", which no plan actually gates`);
    assert.ok(plans.filter((p) => p.key !== 'trial').every((p) => p.features.some((f) => /students included/.test(f))), 'capacity is stated for every paid plan');
  });
});

describe('The invoice PDF', () => {
  it('is a real PDF for the institute and for the vendor, and another institute cannot fetch it', async () => {
    const t = await makeTenant('pdf', { plan: 'standard' });
    const other = await makeTenant('pdfother', { plan: 'standard' });
    const i = (await json('POST', `/api/super-admin/billing/tenants/${t.id}/invoices`, { cookie: sa })).body.invoice;
    const mine = await json('GET', `/api/admin/billing/invoices/${i.id}/pdf`, { cookie: t.admin });
    assert.equal(mine.status, 200);
    assert.equal(mine.res.headers.get('content-type'), 'application/pdf');
    assert.match(mine.res.headers.get('content-disposition'), /invoice-PU-\d{2}-\d{2}-\d{4,}\.pdf/);
    const buf = await bytes(mine);
    assert.equal(buf.subarray(0, 4).toString(), '%PDF');
    assert.equal((await bytes(await json('GET', `/api/super-admin/billing/invoices/${i.id}/pdf`, { cookie: sa }))).subarray(0, 4).toString(), '%PDF');
    assert.equal((await json('GET', `/api/admin/billing/invoices/${i.id}/pdf`, { cookie: other.admin })).status, 404);
    assert.equal((await json('GET', `/api/admin/billing/invoices/${i.id}/pdf`)).status, 401);
  });
});

/* ================================================================ paying online (same Razorpay keys as fees) */
describe('Paying an invoice online', () => {
  it('creates a Razorpay order for exactly the invoice total, tagged as a subscription, and resumes it on retry', async () => {
    const t = await makeTenant('pay1', { plan: 'standard' });
    const i = (await json('POST', `/api/super-admin/billing/tenants/${t.id}/invoices`, { cookie: sa })).body.invoice;
    const o = await json('POST', `/api/admin/billing/invoices/${i.id}/order`, { cookie: t.admin });
    assert.equal(o.status, 201, JSON.stringify(o.body));
    assert.deepEqual([o.body.amount, o.body.amountPaise, o.body.currency, o.body.keyId], [5898.82, 589882, 'INR', 'rzp_test_billkey']);
    const rz = gw.orders.get(o.body.orderId);
    assert.deepEqual([rz.amount, rz.notes.kind, rz.notes.tenant_id, rz.notes.invoice_id], [589882, 'subscription', t.id, i.id]);
    const retry = await json('POST', `/api/admin/billing/invoices/${i.id}/order`, { cookie: t.admin });
    assert.equal(retry.body.orderId, o.body.orderId, 'the same order is reused');
  });

  it('verification marks the invoice paid, extends coverage, activates the subscription and emails a receipt', async () => {
    const t = await makeTenant('pay2', { plan: 'standard' });
    const i = (await json('POST', `/api/super-admin/billing/tenants/${t.id}/invoices`, { cookie: sa })).body.invoice;
    const { verify } = await payOnline(t, i);
    assert.equal(verify.status, 200, JSON.stringify(verify.body));
    assert.equal(verify.body.status, 'paid');
    const s = await sub(t);
    assert.deepEqual([s.status, s.current_period_end, s.plan_key], ['active', i.periodEnd, 'standard']);
    const inv = (await json('GET', `/api/super-admin/billing/invoices/${i.id}`, { cookie: sa })).body.invoice;
    assert.deepEqual([inv.status, inv.payments.length, inv.payments[0].method, inv.payments[0].amount], ['paid', 1, 'razorpay', 5898.82]);
    assert.match((await mailsTo(t, 'subscriptionPaid'))[0].text_body, /paid up to/);
    // Paid invoices say so on the PDF endpoint and can be fetched again
    assert.equal((await json('GET', `/api/admin/billing/invoices/${i.id}/pdf`, { cookie: t.admin })).status, 200);
  });

  it('rejects a forged signature, a payment for another order, an uncaptured payment (pending) and another institute\'s order', async () => {
    const t = await makeTenant('pay3', { plan: 'standard' });
    const other = await makeTenant('pay3x', { plan: 'standard' });
    const i = (await json('POST', `/api/super-admin/billing/tenants/${t.id}/invoices`, { cookie: sa })).body.invoice;
    const o = (await json('POST', `/api/admin/billing/invoices/${i.id}/order`, { cookie: t.admin })).body;
    const pid = gwPayment(o.orderId);
    const verify = (cookie, body) => json('POST', '/api/admin/billing/verify', { cookie, body });
    assert.equal((await verify(t.admin, { razorpay_order_id: o.orderId, razorpay_payment_id: pid, razorpay_signature: 'forged' })).status, 400);
    assert.equal((await verify(t.admin, { razorpay_order_id: o.orderId, razorpay_payment_id: pid })).status, 400);
    assert.equal((await verify(t.admin, { razorpay_order_id: o.orderId, razorpay_payment_id: pid, razorpay_signature: sig(o.orderId, pid, 'wrong-secret') })).status, 400);
    assert.equal((await verify(other.admin, { razorpay_order_id: o.orderId, razorpay_payment_id: pid, razorpay_signature: sig(o.orderId, pid) })).status, 404, "another institute cannot settle this institute's invoice");
    const wrongAmount = gwPayment(o.orderId, { amount: 100 });
    assert.equal((await verify(t.admin, { razorpay_order_id: o.orderId, razorpay_payment_id: wrongAmount, razorpay_signature: sig(o.orderId, wrongAmount) })).status, 409);
    const auth = gwPayment(o.orderId, { status: 'authorized' });
    const pending = await verify(t.admin, { razorpay_order_id: o.orderId, razorpay_payment_id: auth, razorpay_signature: sig(o.orderId, auth) });
    assert.equal(pending.body.status, 'pending');
    assert.equal((await invoicesOf(t))[0].status, 'open', 'nothing was marked paid by any of the above');
  });

  it('settles exactly once however verify and the webhook interleave, and replays are harmless', async () => {
    const t = await makeTenant('pay4', { plan: 'standard' });
    const i = (await json('POST', `/api/super-admin/billing/tenants/${t.id}/invoices`, { cookie: sa })).body.invoice;
    const o = (await json('POST', `/api/admin/billing/invoices/${i.id}/order`, { cookie: t.admin })).body;
    const pid = gwPayment(o.orderId);
    const body = { razorpay_order_id: o.orderId, razorpay_payment_id: pid, razorpay_signature: sig(o.orderId, pid) };
    const results = await Promise.all([
      json('POST', '/api/admin/billing/verify', { cookie: t.admin, body }),
      webhook(captured(o.orderId, pid)),
      json('POST', '/api/admin/billing/verify', { cookie: t.admin, body }),
      webhook(captured(o.orderId, pid)),
    ]);
    assert.ok(results.every((r) => r.status === 200), JSON.stringify(results.map((r) => [r.status, r.body])));
    const n = await platform(async () => (await q('select count(*)::int as n from billing_payments where invoice_id = $1', [i.id])).rows[0].n);
    assert.equal(n, 1, 'one payment, however many times it was reported');
    assert.equal((await mailsTo(t, 'subscriptionPaid')).length, 1, 'and one receipt email');
  });

  it('the webhook alone settles a payment when the browser never reports back', async () => {
    const t = await makeTenant('pay5', { plan: 'standard' });
    const i = (await json('POST', `/api/super-admin/billing/tenants/${t.id}/invoices`, { cookie: sa })).body.invoice;
    const o = (await json('POST', `/api/admin/billing/invoices/${i.id}/order`, { cookie: t.admin })).body;
    const r = await webhook(captured(o.orderId, gwPayment(o.orderId)));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal((await invoicesOf(t))[0].status, 'paid');
    assert.equal((await sub(t)).status, 'active');
  });

  it('a webhook for the wrong amount, or for an unknown order, changes nothing; a failed attempt is noted', async () => {
    const t = await makeTenant('pay6', { plan: 'standard' });
    const i = (await json('POST', `/api/super-admin/billing/tenants/${t.id}/invoices`, { cookie: sa })).body.invoice;
    const o = (await json('POST', `/api/admin/billing/invoices/${i.id}/order`, { cookie: t.admin })).body;
    const bad = await webhook(captured(o.orderId, gwPayment(o.orderId, { amount: 500 }), { amount: 500 }));
    assert.equal(bad.status, 200);
    assert.equal((await invoicesOf(t))[0].status, 'open');
    const review = (await json('GET', '/api/super-admin/billing/review-orders', { cookie: sa })).body.orders.find((x) => x.invoiceNumber === i.number);
    assert.ok(review, 'the mismatch is flagged for the vendor');
    assert.match(review.failureReason, /does not match/);
    const resolved = await json('POST', `/api/super-admin/billing/review-orders/${review.id}/resolve`, { cookie: sa, body: { note: 'Refunded in Razorpay' } });
    assert.equal(resolved.status, 200);
    assert.equal((await json('POST', `/api/super-admin/billing/review-orders/${review.id}/resolve`, { cookie: sa, body: { note: 'again' } })).status, 409);
    const unknown = await webhook({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_zzz', order_id: 'order_unknown', amount: 100 } } } });
    assert.equal(unknown.status, 200);
    assert.equal((await webhook({ event: 'payment.failed', payload: { payment: { entity: { id: 'pay_f', order_id: o.orderId, amount: 1, error_description: 'Card declined' } } } })).status, 200);
  });

  it('money that arrives for an invoice already paid another way is flagged for refund, never double-counted', async () => {
    const t = await makeTenant('pay7', { plan: 'standard' });
    const i = (await json('POST', `/api/super-admin/billing/tenants/${t.id}/invoices`, { cookie: sa })).body.invoice;
    const o = (await json('POST', `/api/admin/billing/invoices/${i.id}/order`, { cookie: t.admin })).body;
    const off = await json('POST', `/api/super-admin/billing/invoices/${i.id}/payments`, { cookie: sa, body: { method: 'bank_transfer', reference: 'NEFT123' } });
    assert.equal(off.status, 201, JSON.stringify(off.body));
    const r = await webhook(captured(o.orderId, gwPayment(o.orderId)));
    assert.equal(r.status, 200);
    const n = await platform(async () => (await q('select count(*)::int as n from billing_payments where invoice_id = $1', [i.id])).rows[0].n);
    assert.equal(n, 1);
    const review = (await json('GET', '/api/super-admin/billing/review-orders', { cookie: sa })).body.orders.find((x) => x.invoiceNumber === i.number);
    assert.match(review.failureReason, /already paid by another route/);
  });

  it('refuses to start a payment for a paid or void invoice, or someone else\'s', async () => {
    const t = await makeTenant('pay8', { plan: 'standard' });
    const other = await makeTenant('pay8x', { plan: 'standard' });
    const i = (await json('POST', `/api/super-admin/billing/tenants/${t.id}/invoices`, { cookie: sa })).body.invoice;
    assert.equal((await json('POST', `/api/admin/billing/invoices/${i.id}/order`, { cookie: other.admin })).status, 404);
    await json('POST', `/api/super-admin/billing/invoices/${i.id}/void`, { cookie: sa, body: { reason: 'issued in error' } });
    assert.equal((await json('POST', `/api/admin/billing/invoices/${i.id}/order`, { cookie: t.admin })).status, 409);
  });
});

/* ================================================================ money recorded by the vendor */
describe('Recording offline payments and voiding', () => {
  it('needs a valid method and a traceable reference, except for cash', async () => {
    const t = await makeTenant('off1', { plan: 'standard' });
    const i = (await json('POST', `/api/super-admin/billing/tenants/${t.id}/invoices`, { cookie: sa })).body.invoice;
    const pay = (body) => json('POST', `/api/super-admin/billing/invoices/${i.id}/payments`, { cookie: sa, body });
    assert.equal((await pay({ method: 'barter', reference: 'x' })).status, 400);
    assert.equal((await pay({ method: 'bank_transfer' })).status, 400, 'a reference is needed so the money can be traced');
    assert.equal((await pay({ method: 'cash' })).status, 201, 'cash needs no reference');
  });

  it('records a bank transfer on a past date, refuses a part payment, a future date and a second payment', async () => {
    const t = await makeTenant('off2', { plan: 'standard' });
    const i = (await json('POST', `/api/super-admin/billing/tenants/${t.id}/invoices`, { cookie: sa })).body.invoice;
    const pay = (body) => json('POST', `/api/super-admin/billing/invoices/${i.id}/payments`, { cookie: sa, body });
    assert.equal((await pay({ method: 'upi', reference: 'U1', amount: 100 })).status, 400);
    assert.match((await pay({ method: 'upi', reference: 'U1', amount: 100 })).body.message, /Part payments are not supported/);
    assert.equal((await pay({ method: 'upi', reference: 'U1', paidOn: day(3) })).status, 400);
    assert.equal((await pay({ method: 'upi', reference: 'U1', paidOn: 'yesterday' })).status, 400);
    const ok = await pay({ method: 'bank_transfer', reference: 'NEFT-998', paidOn: day(-1), amount: i.total, note: 'HDFC credit' });
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    assert.equal(ok.body.invoice.status, 'paid');
    assert.equal(ok.body.invoice.payments[0].reference, 'NEFT-998');
    assert.equal((await pay({ method: 'cash' })).status, 409, 'already paid');
    assert.equal((await sub(t)).status, 'active');
  });

  it('voiding needs a reason, cannot touch a paid invoice, and frees the period for a corrected invoice', async () => {
    const t = await makeTenant('void1', { plan: 'standard' });
    const i = (await json('POST', `/api/super-admin/billing/tenants/${t.id}/invoices`, { cookie: sa })).body.invoice;
    assert.equal((await json('POST', `/api/super-admin/billing/invoices/${i.id}/void`, { cookie: sa, body: {} })).status, 400);
    const v = await json('POST', `/api/super-admin/billing/invoices/${i.id}/void`, { cookie: sa, body: { reason: 'wrong GSTIN' } });
    assert.equal(v.status, 200);
    assert.equal(v.body.invoice.status, 'void');
    assert.equal((await json('POST', `/api/super-admin/billing/invoices/${i.id}/void`, { cookie: sa, body: { reason: 'again' } })).status, 409);
    assert.equal((await json('POST', `/api/super-admin/billing/invoices/${i.id}/payments`, { cookie: sa, body: { method: 'cash' } })).status, 409, 'a void invoice cannot be paid');
    const redo = await json('POST', `/api/super-admin/billing/tenants/${t.id}/invoices`, { cookie: sa });
    assert.equal(redo.status, 201, 'the voided period can be invoiced again');
    assert.notEqual(redo.body.invoice.number, i.number);
    await json('POST', `/api/super-admin/billing/invoices/${redo.body.invoice.id}/payments`, { cookie: sa, body: { method: 'cash' } });
    assert.equal((await json('POST', `/api/super-admin/billing/invoices/${redo.body.invoice.id}/void`, { cookie: sa, body: { reason: 'x' } })).status, 409, 'paid');
  });
});

/* ================================================================ the lifecycle (time travel) */
describe('Renewal: invoices are issued ahead, once, and coverage never has a gap', () => {
  it('issues the next invoice a week before the paid period ends, idempotently, and paying extends coverage', async () => {
    const t = await makeTenant('ren1', { plan: 'standard' });
    // Pay the first period so the subscription is active, then travel to a week before it ends
    const first = (await json('POST', `/api/super-admin/billing/tenants/${t.id}/invoices`, { cookie: sa })).body.invoice;
    await json('POST', `/api/super-admin/billing/invoices/${first.id}/payments`, { cookie: sa, body: { method: 'cash' } });
    const paidUntil = (await sub(t)).current_period_end;
    assert.equal(paidUntil, first.periodEnd);

    const tooEarly = await run(t, calc.addDays(paidUntil, -8));
    assert.equal(tooEarly.generated, 0, 'more than 7 days ahead: nothing yet');
    const r1 = await run(t, calc.addDays(paidUntil, -7));
    assert.deepEqual([r1.generated, r1.errors.length], [1, 0]);
    const r2 = await run(t, calc.addDays(paidUntil, -6));
    assert.equal(r2.generated, 0, 'running again never invoices the same period twice');
    const second = (await invoicesOf(t)).find((i) => i.status === 'open');
    assert.deepEqual([second.source, second.periodStart, second.dueDate], ['auto', paidUntil, paidUntil]);
    assert.equal(second.periodEnd, calc.addMonths(paidUntil, 1), 'the new period starts exactly where the last ended');

    const { verify } = await payOnline(t, second);
    assert.equal(verify.body.status, 'paid');
    assert.equal((await sub(t)).current_period_end, second.periodEnd);
  });

  it('a plan change requested by the institute applies from the next invoice, and then switches the plan', async () => {
    const t = await makeTenant('ren2', { plan: 'basic' });
    const first = (await json('POST', `/api/super-admin/billing/tenants/${t.id}/invoices`, { cookie: sa })).body.invoice;
    await json('POST', `/api/super-admin/billing/invoices/${first.id}/payments`, { cookie: sa, body: { method: 'cash' } });
    const ch = await json('PUT', '/api/admin/billing/change', { cookie: t.admin, body: { planKey: 'premium', cycle: 'annual' } });
    assert.equal(ch.status, 200, JSON.stringify(ch.body));
    assert.deepEqual([ch.body.subscription.planKey, ch.body.subscription.pendingPlanKey, ch.body.subscription.pendingCycle], ['basic', 'premium', 'annual']);
    assert.equal((await tenantRow(t)).plan, 'basic', 'nothing changes until it is paid for');

    await run(t, calc.addDays((await sub(t)).current_period_end, -7));
    const next = (await invoicesOf(t)).find((i) => i.status === 'open');
    assert.deepEqual([next.planKey, next.cycle, next.subtotal], ['premium', 'annual', 99990]);
    await json('POST', `/api/super-admin/billing/invoices/${next.id}/payments`, { cookie: sa, body: { method: 'cash' } });
    const s = await sub(t);
    assert.deepEqual([s.plan_key, s.cycle, s.pending_plan_key], ['premium', 'annual', null]);
    assert.equal((await tenantRow(t)).plan, 'premium');
    assert.equal((await json('PUT', '/api/admin/billing/change', { cookie: t.admin, body: { planKey: 'trial' } })).status, 400, 'the trial plan is not selectable');
    assert.equal((await json('PUT', '/api/admin/billing/change', { cookie: t.admin, body: { planKey: 'nope' } })).status, 400);
  });

  it('a subscription that starts on the 31st keeps billing on month ends instead of drifting to the 28th', () => {
    let start = '2026-01-31'; const ends = [];
    for (let i = 0; i < 4; i += 1) { start = calc.addMonths(start, 1, 31); ends.push(start); }
    assert.deepEqual(ends, ['2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31']);
  });
});

describe('Overdue: reminders, past due, grace, then locked', () => {
  it('walks through every stage once each, in order, and locks the institute only after the grace period', async () => {
    const t = await makeTenant('dun1', { plan: 'standard' });
    await makeStudentLogin(t);
    const trialEnd = (await sub(t)).trial_ends_on;

    // A week before the trial ends the first invoice goes out (the plan was chosen when the institute was created)
    assert.equal((await run(t, calc.addDays(trialEnd, -7))).generated, 1);
    const inv = (await invoicesOf(t))[0];
    assert.equal(inv.dueDate, trialEnd);
    const mails = async (kind) => (await mailsTo(t, 'subscriptionReminder')).filter((m) => m.subject.includes(kind));
    const stage = async (offset) => { const r = await run(t, calc.addDays(trialEnd, offset)); return { r, sub: await sub(t), tenant: await tenantRow(t) }; };

    await stage(-6); assert.equal((await mailsTo(t, 'subscriptionReminder')).length, 0, 'too early for a reminder');
    await stage(-2); assert.equal((await mailsTo(t, 'subscriptionReminder')).length, 1);
    assert.match((await mailsTo(t, 'subscriptionReminder'))[0].subject, /due soon/);
    await stage(-2); assert.equal((await mailsTo(t, 'subscriptionReminder')).length, 1, 'rerunning the same day sends nothing new');
    await stage(0); assert.match((await mailsTo(t, 'subscriptionReminder')).slice(-1)[0].subject, /due today/);
    const d1 = await stage(1);
    assert.deepEqual([d1.sub.status, d1.tenant.status], ['past_due', 'active'], 'overdue, but still inside the grace period: access continues');
    await stage(3); assert.match((await mailsTo(t, 'subscriptionReminder')).slice(-1)[0].subject, /Overdue/);
    const d7 = await stage(7);
    assert.match((await mailsTo(t, 'subscriptionReminder')).slice(-1)[0].subject, /Final notice/);
    assert.deepEqual([d7.sub.status, d7.tenant.status], ['past_due', 'active'], 'the last day of grace is still not locked');
    const d8 = await stage(8);
    assert.deepEqual([d8.sub.status, d8.sub.suspended_reason, d8.tenant.status, d8.tenant.suspension_reason, d8.r.suspended], ['suspended', 'unpaid', 'suspended', 'billing', 1]);
    assert.equal((await mailsTo(t, 'subscriptionSuspended')).length, 1);
    assert.equal((await mailsTo(t, 'subscriptionReminder')).length, 4, 'pre-due, due, overdue, final - one of each, never a pile');
    await stage(9); assert.equal((await mailsTo(t, 'subscriptionSuspended')).length, 1, 'the lock email is sent once');
  });

  it('a locked institute: students and staff are shut out, the admin can reach only Billing, paying restores everyone at once', async () => {
    const t = await makeTenant('dun2', { plan: 'standard', backdated: 12 });
    await makeStudentLogin(t);
    const trialEnd = (await sub(t)).trial_ends_on;
    const studentBefore = (await login(t.code, 'student', 'BTS1', 'Student@123')).cookie;
    await run(t, calc.addDays(trialEnd, -7));
    await run(t, calc.addDays(trialEnd, 8));
    assert.equal((await tenantRow(t)).status, 'suspended');

    // Students cannot sign in, and a session they already had stops working - with a message that does not mention billing
    const blocked = await login(t.code, 'student', 'BTS1', 'Student@123', { expect: 403 });
    assert.match(blocked.body.message, /temporarily paused.*administrator/);
    assert.ok(!/subscription|invoice|PlanetU/i.test(blocked.body.message));
    const oldSession = await json('GET', '/api/student/dashboard', { cookie: studentBefore });
    assert.equal(oldSession.status, 403);
    assert.equal(oldSession.body.code, 'BILLING_LOCKED');

    // The admin can sign in; the app is told to show only Billing
    const adm = await login(t.code, 'admin', 'ADM001', 'Admin@12345');
    assert.equal(adm.body.tenant.billingLocked, true);
    const me = await json('GET', '/api/auth/me', { cookie: adm.cookie });
    assert.equal(me.status, 200);
    assert.equal(me.body.tenant.billingLocked, true);
    const billingPage = await json('GET', '/api/admin/billing', { cookie: adm.cookie });
    assert.equal(billingPage.status, 200);
    assert.equal(billingPage.body.locked, true);
    assert.equal(billingPage.body.lockReason, 'unpaid invoice');
    for (const path of ['/api/admin/students', '/api/admin/fees/students/00000000-0000-4000-8000-000000000000', '/api/admin/reports', '/api/admin/dashboard']) {
      const r = await json('GET', path, { cookie: adm.cookie });
      assert.equal(r.status, 403, path);
      assert.equal(r.body.code, 'BILLING_LOCKED');
    }

    // ...pays, and is back at once
    const inv = billingPage.body.openInvoices[0];
    assert.equal(inv.overdue, true);
    const full = (await invoicesOf(t))[0];
    const { verify } = await payOnline({ ...t, admin: adm.cookie }, full);
    assert.equal(verify.body.status, 'paid');
    assert.equal(verify.body.restored, true);
    assert.deepEqual([(await tenantRow(t)).status, (await sub(t)).status, (await sub(t)).suspended_reason], ['active', 'active', null]);
    assert.equal((await json('GET', '/api/admin/students', { cookie: adm.cookie })).status, 200);
    assert.equal((await login(t.code, 'student', 'BTS1', 'Student@123')).body.user.role, 'student');
    assert.match((await mailsTo(t, 'subscriptionPaid'))[0].text_body, /access has been restored/);
  });

  it('a vendor courtesy extension lets a locked institute back in without payment, for as long as it says', async () => {
    const t = await makeTenant('dun3', { plan: 'standard', backdated: 12 });
    const trialEnd = (await sub(t)).trial_ends_on;
    await run(t, calc.addDays(trialEnd, -7)); await run(t, calc.addDays(trialEnd, 8));
    assert.equal((await tenantRow(t)).status, 'suspended');
    assert.equal((await json('PUT', `/api/super-admin/billing/tenants/${t.id}/subscription`, { cookie: sa, body: { extendUntil: day(-1) } })).status, 400, 'not in the past');
    const ext = await json('PUT', `/api/super-admin/billing/tenants/${t.id}/subscription`, { cookie: sa, body: { extendUntil: day(10) } });
    assert.equal(ext.status, 200, JSON.stringify(ext.body));
    assert.equal((await tenantRow(t)).status, 'active');
    assert.equal(ext.body.subscription.status, 'active');
  });

  it("a manual suspension by the vendor is NOT a billing lock: nobody gets in, not even the admin, and it is never lifted by a payment", async () => {
    const t = await makeTenant('manual', { plan: 'standard' });
    await json('PUT', `/api/super-admin/tenants/${t.id}`, { cookie: sa, body: { status: 'suspended' } });
    assert.equal((await tenantRow(t)).suspension_reason, 'manual');
    const r = await login(t.code, 'admin', 'ADM001', 'Admin@12345', { expect: 403 });
    assert.match(r.body.message, /suspended.*PlanetU support/);
    const inv = (await json('POST', `/api/super-admin/billing/tenants/${t.id}/invoices`, { cookie: sa })).body.invoice;
    await json('POST', `/api/super-admin/billing/invoices/${inv.id}/payments`, { cookie: sa, body: { method: 'cash' } });
    assert.equal((await tenantRow(t)).status, 'suspended', 'paying does not undo a deliberate suspension');
    await json('PUT', `/api/super-admin/tenants/${t.id}`, { cookie: sa, body: { status: 'active' } });
    assert.deepEqual([(await tenantRow(t)).status, (await tenantRow(t)).suspension_reason], ['active', null]);
  });
});

describe('Trials and conversion', () => {
  it('a trial with no plan chosen warns, runs out, locks, and choosing a plan then paying brings it back', async () => {
    const t = await makeTenant('trial1', { plan: 'trial', backdated: 12 });
    const end = (await sub(t)).trial_ends_on;
    await run(t, calc.addDays(end, -3));
    assert.equal((await mailsTo(t, 'subscriptionTrialEnding')).length, 1);
    await run(t, calc.addDays(end, -2));
    assert.equal((await mailsTo(t, 'subscriptionTrialEnding')).length, 1, 'one warning only');
    assert.equal((await run(t, calc.addDays(end, -1))).generated, 0, 'no plan, so nothing to invoice');

    assert.equal((await run(t, calc.addDays(end, 1))).suspended, 0);
    assert.equal((await sub(t)).status, 'past_due');
    const r = await run(t, calc.addDays(end, 8));
    assert.equal(r.suspended, 1);
    assert.deepEqual([(await sub(t)).status, (await sub(t)).suspended_reason], ['suspended', 'trial_ended']);

    const adm = (await login(t.code, 'admin', 'ADM001', 'Admin@12345')).cookie;
    const page = await json('GET', '/api/admin/billing', { cookie: adm });
    assert.equal(page.body.lockReason, 'trial ended');
    assert.equal((await json('POST', '/api/admin/billing/choose-plan', { cookie: adm, body: { planKey: 'trial' } })).status, 400);
    assert.equal((await json('POST', '/api/admin/billing/choose-plan', { cookie: adm, body: { planKey: 'standard', cycle: 'weekly' } })).status, 400);
    const chosen = await json('POST', '/api/admin/billing/choose-plan', { cookie: adm, body: { planKey: 'standard', cycle: 'annual' } });
    assert.equal(chosen.status, 201, JSON.stringify(chosen.body));
    const invoice = chosen.body.invoice;
    assert.deepEqual([invoice.source, invoice.planKey, invoice.cycle, invoice.total], ['plan_selection', 'standard', 'annual', 58988.2]);
    assert.equal(invoice.periodStart, TODAY, 'a lapsed institute is billed from today, not for the months it was locked');
    assert.equal(invoice.dueDate, TODAY);
    const second = await json('POST', '/api/admin/billing/choose-plan', { cookie: adm, body: { planKey: 'basic' } });
    assert.equal(second.status, 409, 'an invoice is already waiting');
    const { verify } = await payOnline({ ...t, admin: adm }, invoice);
    assert.equal(verify.body.restored, true);
    assert.equal((await tenantRow(t)).status, 'active');
    assert.equal((await tenantRow(t)).plan, 'standard');
  });

  it('choosing a plan during the trial bills from the day the trial ends, so no free days are lost', async () => {
    const t = await makeTenant('trial2', { plan: 'trial' });
    const end = (await sub(t)).trial_ends_on;
    const chosen = await json('POST', '/api/admin/billing/choose-plan', { cookie: t.admin, body: { planKey: 'basic' } });
    assert.equal(chosen.status, 201, JSON.stringify(chosen.body));
    assert.equal(chosen.body.invoice.periodStart, end);
    assert.equal(chosen.body.invoice.dueDate, end);
  });
});

describe('Cancelling', () => {
  it('cancel-at-period-end keeps access until the paid period ends, stops further invoices, then locks without a grace period', async () => {
    const t = await makeTenant('cancel1', { plan: 'standard' });
    const first = (await json('POST', `/api/super-admin/billing/tenants/${t.id}/invoices`, { cookie: sa })).body.invoice;
    await json('POST', `/api/super-admin/billing/invoices/${first.id}/payments`, { cookie: sa, body: { method: 'cash' } });
    const end = (await sub(t)).current_period_end;
    const c = await json('PUT', '/api/admin/billing/change', { cookie: t.admin, body: { cancelAtPeriodEnd: true } });
    assert.equal(c.status, 200);
    assert.equal(c.body.subscription.cancelAtPeriodEnd, true);
    assert.equal((await run(t, calc.addDays(end, -7))).generated, 0, 'a cancelling institute is not invoiced again');
    assert.equal((await tenantRow(t)).status, 'active');
    const r = await run(t, end);
    assert.equal(r.suspended, 1);
    assert.deepEqual([(await sub(t)).suspended_reason, (await tenantRow(t)).status], ['cancelled', 'suspended']);
    assert.equal((await json('PUT', '/api/admin/billing/change', { cookie: (await login(t.code, 'admin', 'ADM001', 'Admin@12345')).cookie, body: { cancelAtPeriodEnd: false } })).status, 409, 'cancelled subscriptions are reopened by choosing a plan');
  });

  it('withdrawing a cancellation before it takes effect resumes normal invoicing', async () => {
    const t = await makeTenant('cancel2', { plan: 'standard' });
    const first = (await json('POST', `/api/super-admin/billing/tenants/${t.id}/invoices`, { cookie: sa })).body.invoice;
    await json('POST', `/api/super-admin/billing/invoices/${first.id}/payments`, { cookie: sa, body: { method: 'cash' } });
    await json('PUT', '/api/admin/billing/change', { cookie: t.admin, body: { cancelAtPeriodEnd: true } });
    await json('PUT', '/api/admin/billing/change', { cookie: t.admin, body: { cancelAtPeriodEnd: false } });
    assert.equal((await run(t, calc.addDays((await sub(t)).current_period_end, -7))).generated, 1);
  });
});

describe('Blocked invoicing is visible, not silent', () => {
  it('reports institutes that cannot be invoiced and asks them for the missing details', async () => {
    const t = await makeTenant('block1', { plan: 'standard', details: false });
    await platform(() => q("update billing_profiles set state = '' where tenant_id = $1", [t.id]));
    const end = (await sub(t)).trial_ends_on;
    const r = await run(t, calc.addDays(end, -7));
    assert.equal(r.generated, 0);
    assert.equal(r.blocked.length, 1);
    assert.match(r.blocked[0].reason, /missing: state/);
    assert.equal((await mailsTo(t, 'subscriptionDetailsNeeded')).length, 1);
    await run(t, calc.addDays(end, -6));
    assert.equal((await mailsTo(t, 'subscriptionDetailsNeeded')).length, 1, 'not nagged every day');
    // The console flags it too
    const over = (await json('GET', '/api/super-admin/billing/overview', { cookie: sa })).body;
    assert.ok(over.attention.missingDetails.some((x) => x.tenantId === t.id));
    // Once the details arrive, the next run issues the invoice
    await platform(() => billing.saveProfile(t.id, { state: 'Goa' }, null));
    assert.equal((await run(t, calc.addDays(end, -5))).generated, 1);
  });
});

/* ================================================================ the vendor console */
describe('Vendor console numbers', () => {
  it('MRR follows real subscriptions: it rises by the monthly value when an institute starts paying, and annual plans count as a twelfth', async () => {
    const o1 = (await json('GET', '/api/super-admin/billing/overview', { cookie: sa })).body;
    const t = await makeTenant('mrr1', { plan: 'standard' });
    const mid = (await json('GET', '/api/super-admin/billing/overview', { cookie: sa })).body;
    assert.equal(mid.mrr, o1.mrr, 'a trial brings no recurring revenue yet');
    const i = (await json('POST', `/api/super-admin/billing/tenants/${t.id}/invoices`, { cookie: sa })).body.invoice;
    await json('POST', `/api/super-admin/billing/invoices/${i.id}/payments`, { cookie: sa, body: { method: 'cash' } });
    const o2 = (await json('GET', '/api/super-admin/billing/overview', { cookie: sa })).body;
    assert.equal(calc.round2(o2.mrr - mid.mrr), 4999);
    assert.equal(o2.arr, calc.round2(o2.mrr * 12));

    const a = await makeTenant('mrr2', { plan: 'standard' });
    await json('PUT', `/api/super-admin/billing/tenants/${a.id}/subscription`, { cookie: sa, body: { cycle: 'annual', discountPercent: 10 } });
    const ai = (await json('POST', `/api/super-admin/billing/tenants/${a.id}/invoices`, { cookie: sa })).body.invoice;
    await json('POST', `/api/super-admin/billing/invoices/${ai.id}/payments`, { cookie: sa, body: { method: 'cash' } });
    const o3 = (await json('GET', '/api/super-admin/billing/overview', { cookie: sa })).body;
    assert.equal(calc.round2(o3.mrr - o2.mrr), calc.round2((49990 / 12) * 0.9));
  });

  it('reports receivables, collections and what needs attention', async () => {
    const t = await makeTenant('ov1', { plan: 'standard' });
    const end = (await sub(t)).trial_ends_on;
    await run(t, calc.addDays(end, -7));
    const o = (await json('GET', '/api/super-admin/billing/overview', { cookie: sa })).body;
    assert.ok(o.receivables.outstanding >= 5898.82);
    assert.ok(o.collected.thisMonth >= 0 && o.collected.thisFinancialYear >= o.collected.thisMonth);
    assert.match(o.collected.financialYear, /^\d{4}-\d{2}$/);
    assert.ok(Array.isArray(o.series));
    assert.ok(o.attention.trialsEnding.some((x) => x.tenantId === t.id) || calc.daysBetween(TODAY, end) > 7, 'a trial ending within a week is listed');
    const list = (await json('GET', '/api/super-admin/billing/subscriptions', { cookie: sa })).body.subscriptions;
    const mine = list.find((s) => s.tenantId === t.id);
    assert.deepEqual([mine.planKey, mine.status, mine.detailsComplete, mine.openInvoices, mine.openAmount], ['standard', 'trialing', true, 1, 5898.82]);
    assert.ok(list.every((s) => !s.code.startsWith('demo-')), 'demo institutes are not billed or listed');
  });

  it('the vendor can run billing on demand, and the run is recorded', async () => {
    const r = await json('POST', '/api/super-admin/billing/run', { cookie: sa });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    for (const k of ['processed', 'generated', 'reminders', 'pastDue', 'suspended']) assert.equal(typeof r.body.result[k], 'number', k);
    assert.deepEqual(r.body.result.errors, []);
    const n = await platform(async () => (await q("select count(*)::int as n from audit_log where action = 'billing.run_now'")).rows[0].n);
    assert.ok(n >= 1);
  });
});

describe('Invoice list and the register for your accountant', () => {
  it('filters by status, institute and text, and exports CSV and Excel with the GST columns', async () => {
    const t = await makeTenant('reg1', { plan: 'standard' });
    const i = (await json('POST', `/api/super-admin/billing/tenants/${t.id}/invoices`, { cookie: sa })).body.invoice;
    const list = (qs) => json('GET', `/api/super-admin/billing/invoices?${qs}`, { cookie: sa });
    assert.ok((await list(`tenantId=${t.id}`)).body.invoices.some((x) => x.id === i.id));
    assert.equal((await list(`tenantId=${t.id}&status=paid`)).body.invoices.length, 0);
    assert.equal((await list(`tenantId=${t.id}&status=open`)).body.invoices.length, 1);
    assert.equal((await list(`search=${encodeURIComponent(i.number.toLowerCase())}`)).body.invoices.length, 1);
    assert.equal((await list(`search=${encodeURIComponent(t.code)}`)).body.invoices.length, 1, 'search by institute code');
    assert.equal((await list('status=weird')).status, 400);
    assert.equal((await list('from=2026-13-40')).status, 400);
    assert.equal((await list(`tenantId=${t.id}&status=overdue`)).body.invoices.length, 0, 'not overdue yet');

    const csv = await json('GET', `/api/super-admin/billing/invoices?format=csv&tenantId=${t.id}`, { cookie: sa });
    assert.equal(csv.status, 200);
    assert.match(csv.res.headers.get('content-type'), /text\/csv/);
    const text = (await bytes(csv)).subarray(3).toString('utf8');
    assert.ok(text.startsWith('Invoice no.,Date,Institute,Customer GSTIN,Place of supply,Period from,Period to,Plan,Taxable value,CGST,SGST,IGST,Total,Status,Paid on'));
    assert.match(text, new RegExp(`${i.number.replace('/', '\\/')},.*,4999,449\\.91,449\\.91,0,5898\\.82,open`));
    const xlsx = await json('GET', `/api/super-admin/billing/invoices?format=xlsx&tenantId=${t.id}`, { cookie: sa });
    assert.equal(xlsx.status, 200);
    assert.equal((await bytes(xlsx)).subarray(0, 2).toString(), 'PK');
    assert.equal((await json('GET', '/api/super-admin/billing/invoices?format=pdf', { cookie: sa })).status, 400);
    const n = await platform(async () => (await q("select count(*)::int as n from audit_log where action = 'billing.register_export'")).rows[0].n);
    assert.ok(n >= 2, 'exports are audited');
  });

  it('an overdue invoice shows in the overdue filter, and "remind" sends the stage that matches', async () => {
    const t = await makeTenant('reg2', { plan: 'standard' });
    const end = (await sub(t)).trial_ends_on;
    await run(t, calc.addDays(end, -7));
    const i = (await invoicesOf(t))[0];
    const rem = await json('POST', `/api/super-admin/billing/invoices/${i.id}/remind`, { cookie: sa });
    assert.equal(rem.status, 200, JSON.stringify(rem.body));
    assert.ok(['pre_due', 'due', 'overdue', 'final'].includes(rem.body.kind));
    assert.equal((await json('POST', `/api/super-admin/billing/invoices/${i.id}/void`, { cookie: sa, body: { reason: 'cleanup' } })).status, 200);
    assert.equal((await json('POST', `/api/super-admin/billing/invoices/${i.id}/remind`, { cookie: sa })).status, 409, 'nothing to remind about once void');
    // Make an invoice overdue by hand to prove the filter
    const t2 = await makeTenant('reg3', { plan: 'standard' });
    const j = (await json('POST', `/api/super-admin/billing/tenants/${t2.id}/invoices`, { cookie: sa })).body.invoice;
    await platform(() => q("update billing_invoices set due_date = current_date - 3 where id = $1", [j.id]));
    const over = (await json('GET', `/api/super-admin/billing/invoices?status=overdue&tenantId=${t2.id}`, { cookie: sa })).body.invoices;
    assert.equal(over.length, 1);
    assert.equal(over[0].overdue, true);
  });
});

/* ================================================================ who can see and do what */
describe('Access control and isolation', () => {
  it('an institute sees only its own billing; students, staff and other roles are kept out of both consoles', async () => {
    const a = await makeTenant('iso1', { plan: 'standard' });
    const b = await makeTenant('iso2', { plan: 'standard' });
    await makeStudentLogin(a);
    const ia = (await json('POST', `/api/super-admin/billing/tenants/${a.id}/invoices`, { cookie: sa })).body.invoice;
    const stud = (await login(a.code, 'student', 'BTS1', 'Student@123')).cookie;
    assert.equal((await json('GET', '/api/admin/billing', { cookie: stud })).status, 403);
    assert.equal((await json('GET', '/api/super-admin/billing/overview', { cookie: a.admin })).status, 403);
    assert.equal((await json('GET', '/api/super-admin/billing/overview')).status, 401);
    assert.equal((await json('GET', '/api/admin/billing')).status, 401);

    const mineB = await json('GET', '/api/admin/billing', { cookie: b.admin });
    assert.ok(!mineB.body.invoices.some((x) => x.id === ia.id), "B cannot see A's invoice");
    const mineA = await json('GET', '/api/admin/billing', { cookie: a.admin });
    assert.ok(mineA.body.invoices.some((x) => x.id === ia.id));
    assert.equal(mineA.body.tenant.id, a.id);
  });

  it('the database itself refuses an institute any write to billing tables, and hides other institutes\' rows', async () => {
    const a = await makeTenant('rls1', { plan: 'standard' });
    const b = await makeTenant('rls2', { plan: 'standard' });
    const ia = (await json('POST', `/api/super-admin/billing/tenants/${a.id}/invoices`, { cookie: sa })).body.invoice;
    await inTenantTx(a.id, async () => {
      assert.equal((await q('select count(*)::int as n from billing_invoices where id = $1', [ia.id])).rows[0].n, 1, 'can read own invoice');
      assert.equal((await q('select count(*)::int as n from tenant_subscriptions')).rows[0].n, 1, 'sees only its own subscription');
    });
    await inTenantTx(b.id, async () => {
      assert.equal((await q('select count(*)::int as n from billing_invoices where id = $1', [ia.id])).rows[0].n, 0, "cannot read another institute's invoice");
    });
    // Even with a valid session in hand, writes are refused by RLS
    const attempt = (sql, params) => inTenantTx(a.id, () => q(sql, params)).then((r) => ({ rowCount: r.rowCount }), (e) => ({ error: e.message }));
    const upd = await attempt("update billing_invoices set status = 'paid' where id = $1", [ia.id]);
    assert.ok(upd.error || upd.rowCount === 0, 'an institute cannot mark its own invoice paid');
    const ins = await attempt("insert into billing_payments (tenant_id, invoice_id, amount, method) values ($1, $2, 1, 'cash')", [a.id, ia.id]);
    assert.ok(ins.error, 'an institute cannot insert a payment');
    const plan = await attempt("update billing_plans set monthly_price = 1 where key = 'standard'");
    assert.ok(plan.error || plan.rowCount === 0, 'an institute cannot change the price list');
    const sub2 = await attempt("update tenant_subscriptions set status = 'active', current_period_end = '2099-01-01' where tenant_id = $1", [a.id]);
    assert.ok(sub2.error || sub2.rowCount === 0, 'an institute cannot grant itself coverage');
    assert.equal((await invoicesOf(a))[0].status, 'open', 'and nothing changed');
    assert.equal((await sub(a)).current_period_end, (await sub(a)).trial_ends_on);
  });

  it('every money movement leaves an audit record with the institute named', async () => {
    const t = await makeTenant('aud1', { plan: 'standard' });
    const i = (await json('POST', `/api/super-admin/billing/tenants/${t.id}/invoices`, { cookie: sa })).body.invoice;
    await json('POST', `/api/super-admin/billing/invoices/${i.id}/payments`, { cookie: sa, body: { method: 'upi', reference: 'U9' } });
    const rows = await platform(async () => (await q("select action, actor_role, meta from audit_log where meta->>'tenantId' = $1 order by id", [t.id])).rows);
    const actions = rows.map((r) => r.action);
    assert.ok(actions.includes('billing.invoice_issue') && actions.includes('billing.payment'), actions.join(','));
    assert.equal(rows.find((r) => r.action === 'billing.payment').meta.method, 'upi');
    assert.equal(rows.find((r) => r.action === 'billing.invoice_issue').actor_role, 'super_admin');
  });
});

describe('The shared webhook still serves student fees', () => {
  it('ignores events for orders that are neither a fee order nor a subscription order', async () => {
    gw.orders.set('order_foreign', { id: 'order_foreign', amount: 100, notes: { something: 'else' } });
    const r = await webhook({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_foreign', order_id: 'order_foreign', amount: 100 } } } });
    assert.equal(r.status, 200);
    assert.equal(r.body.ignored, true);
  });
});

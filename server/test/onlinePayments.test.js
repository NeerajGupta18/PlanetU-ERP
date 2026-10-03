/**
 * Online fee payments (Razorpay) - run with `npm test` (needs `npm run db:setup` first).
 * Razorpay's API is replaced by an in-memory fake, so no network or real keys are involved; the
 * signatures are computed with the same HMAC scheme Razorpay uses, so the verification code is
 * genuinely exercised.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, describe, it } from 'node:test';

process.env.RAZORPAY_KEY_ID = 'rzp_test_unitkey';
process.env.RAZORPAY_KEY_SECRET = 'unit-key-secret';
process.env.RAZORPAY_WEBHOOK_SECRET = 'unit-webhook-secret';
process.env.PAYMENT_ORDERS_PER_MINUTE = '1000'; // the suite creates far more orders than the real per-minute limit allows

const { env } = await import('../src/config/env.js');
const { createApp } = await import('../src/app.js');
const { closePool, q, withTx } = await import('../src/db/pool.js');
const { issueCaptchaToken } = await import('../src/services/captcha.service.js');

/* ---------- a fake Razorpay ---------- */
const realFetch = globalThis.fetch;
const GW = 'https://api.razorpay.com/v1';
const gw = { orders: new Map(), payments: new Map(), n: 0, calls: [] };
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (!u.startsWith(GW)) return realFetch(url, opts);
  const path = u.slice(GW.length);
  const method = opts.method || 'GET';
  gw.calls.push({ method, path, body: opts.body ? JSON.parse(opts.body) : null, auth: opts.headers?.Authorization });
  const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  if (method === 'POST' && path === '/orders') {
    const body = JSON.parse(opts.body);
    const order = { id: `order_T${++gw.n}`, ...body };
    gw.orders.set(order.id, order);
    return reply(200, order);
  }
  const [, kind, id] = path.match(/^\/(orders|payments)\/(.+)$/) || [];
  const found = kind && (kind === 'orders' ? gw.orders : gw.payments).get(decodeURIComponent(id));
  return found ? reply(200, found) : reply(400, { error: { description: 'The id provided does not exist' } });
};
/** Registers a payment against an order on the fake gateway. */
const gwPayment = (orderId, { status = 'captured', amount } = {}) => {
  const id = `pay_T${++gw.n}`;
  gw.payments.set(id, { id, order_id: orderId, amount: amount ?? gw.orders.get(orderId).amount, status, method: 'upi' });
  return id;
};
const checkoutSig = (orderId, paymentId, secret = env.RAZORPAY_KEY_SECRET) => crypto.createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest('hex');

/* ---------- plumbing ---------- */
let server; let base;
const json = async (method, path, { cookie, body } = {}) => {
  const r = await realFetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let b = null; try { b = await r.json(); } catch { /* empty */ }
  return { status: r.status, body: b };
};
async function login(tenantCode, role, identifier, password) {
  const r = await realFetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tenantCode, role, identifier, password, captchaToken: issueCaptchaToken() }) });
  assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
  return r.headers.getSetCookie().map((c) => c.split(';')[0]).find((c) => c.startsWith(`${env.COOKIE_NAME}=`));
}
const webhook = async (event, { secret = env.RAZORPAY_WEBHOOK_SECRET, sign = true } = {}) => {
  const raw = JSON.stringify(event);
  const sig = crypto.createHmac('sha256', secret).update(raw).digest('hex');
  const r = await realFetch(`${base}/api/webhooks/razorpay`, { method: 'POST', headers: { 'content-type': 'application/json', ...(sign ? { 'x-razorpay-signature': sig } : {}) }, body: raw });
  let b = null; try { b = await r.json(); } catch { /* empty */ }
  return { status: r.status, body: b };
};
const capturedEvent = (orderId, paymentId, extra = {}) => ({
  event: 'payment.captured',
  payload: { payment: { entity: { id: paymentId, order_id: orderId, amount: gw.orders.get(orderId)?.amount, method: 'upi', status: 'captured', ...extra } } },
});

const YEAR = `test-online-${Date.now()}`;
let admin; let student; let otherStudent; let tenantId; let studentId; let tuitionId; let labId;
const ledger = async () => (await json('GET', '/api/student/fees', { cookie: student })).body.summary;
const paymentsCount = async () => (await withTx({ tenantId }, () => q("select count(*)::int as n from payments where student_id = $1 and method = 'online'", [studentId]))).rows[0].n;
const orderRow = async (rzpOrderId) => (await withTx({ tenantId }, () => q('select * from online_payment_orders where razorpay_order_id = $1', [rzpOrderId]))).rows[0];

before(async () => {
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  admin = await login('demo-university', 'admin', 'ADM001', 'Admin@123');
  student = await login('demo-university', 'student', 'MIT2026001', 'Student@123');
  otherStudent = await login('demo-university', 'student', 'MIT2026002', 'Student@123');
  tenantId = (await withTx({ platform: true }, () => q("select id from tenants where code = 'demo-university'"))).rows[0].id;
  ({ rows: [{ student_id: studentId }] } = await withTx({ tenantId }, () => q("select student_id from users where login_id = 'MIT2026001'")));
  const { rows: [{ id: courseId }] } = await withTx({ tenantId }, () => q('select id from courses limit 1'));
  const st = await json('POST', '/api/admin/fees/structures', { cookie: admin, body: { name: 'Online Plan', courseId, academicYear: YEAR, items: [{ label: 'Tuition', amount: 30000 }, { label: 'Lab Fee', amount: 5000 }] } });
  await json('POST', `/api/admin/fees/structures/${st.body.structure.id}/assign`, { cookie: admin, body: { studentId } });
  const items = (await json('GET', '/api/student/fees', { cookie: student })).body.items;
  tuitionId = items.find((i) => i.label === 'Tuition').id;
  labId = items.find((i) => i.label === 'Lab Fee').id;
});
after(async () => {
  await withTx({ tenantId }, async () => {
    await q('delete from online_payment_orders where student_id = $1', [studentId]);
    await q('delete from payments where student_id = $1', [studentId]);
    await q('delete from student_fee_items where student_id = $1', [studentId]);
    await q('delete from fee_structures where academic_year = $1', [YEAR]);
    await q("delete from notifications where template = 'paymentReceived'");
  });
  globalThis.fetch = realFetch;
  await new Promise((r) => server.close(r));
  await closePool();
});

describe('Creating an order', () => {
  it('tells the student portal that online payment is on, exposing only the PUBLIC key', async () => {
    const r = await json('GET', '/api/student/fees/online/config', { cookie: student });
    assert.deepEqual(r.body, { enabled: true, keyId: 'rzp_test_unitkey' });
    assert.ok(!JSON.stringify(r.body).includes('unit-key-secret'));
  });

  it('computes the amount on the server: the full balance of the chosen charge, sent to Razorpay in paise', async () => {
    const r = await json('POST', '/api/student/fees/online/orders', { cookie: student, body: { feeItemId: labId } });
    assert.equal(r.status, 201);
    assert.equal(r.body.amount, 5000);
    assert.equal(r.body.amountPaise, 500000);
    assert.equal(r.body.keyId, 'rzp_test_unitkey');
    const call = gw.calls.filter((c) => c.path === '/orders').at(-1);
    assert.equal(call.body.amount, 500000);
    assert.equal(call.body.currency, 'INR');
    assert.equal(call.body.notes.tenant_id, tenantId);
    assert.equal(call.auth, `Basic ${Buffer.from('rzp_test_unitkey:unit-key-secret').toString('base64')}`);
    assert.equal((await orderRow(r.body.orderId)).status, 'created');
  });

  it('rejects over-payment, sub-rupee amounts, someone else\'s / invalid charges, and a missing student role', async () => {
    const over = await json('POST', '/api/student/fees/online/orders', { cookie: student, body: { feeItemId: labId, amount: 5000.01 } });
    assert.equal(over.status, 400);
    assert.equal((await json('POST', '/api/student/fees/online/orders', { cookie: student, body: { feeItemId: labId, amount: 0.5 } })).status, 400);
    assert.equal((await json('POST', '/api/student/fees/online/orders', { cookie: student, body: { feeItemId: 'not-a-uuid' } })).status, 400);
    assert.equal((await json('POST', '/api/student/fees/online/orders', { cookie: otherStudent, body: { feeItemId: labId } })).status, 400); // not their charge
    assert.equal((await json('POST', '/api/student/fees/online/orders', { body: {} })).status, 401);
    assert.equal((await json('POST', '/api/student/fees/online/orders', { cookie: admin, body: {} })).status, 403);
  });

  it('refuses when there is nothing to pay, and when online payment is switched off', async () => {
    assert.equal((await json('POST', '/api/student/fees/online/orders', { cookie: otherStudent, body: {} })).status, 409);
    const key = process.env.RAZORPAY_KEY_ID; process.env.RAZORPAY_KEY_ID = '';
    try {
      assert.deepEqual((await json('GET', '/api/student/fees/online/config', { cookie: student })).body, { enabled: false, keyId: null });
      assert.equal((await json('POST', '/api/student/fees/online/orders', { cookie: student, body: { feeItemId: labId } })).status, 503);
    } finally { process.env.RAZORPAY_KEY_ID = key; }
  });
});

describe('Browser verification', () => {
  let orderId;
  it('a forged signature is rejected and nothing is recorded', async () => {
    orderId = (await json('POST', '/api/student/fees/online/orders', { cookie: student, body: { feeItemId: labId } })).body.orderId;
    const payId = gwPayment(orderId);
    const r = await json('POST', '/api/student/fees/online/verify', { cookie: student, body: { razorpay_order_id: orderId, razorpay_payment_id: payId, razorpay_signature: checkoutSig(orderId, payId, 'wrong-secret') } });
    assert.equal(r.status, 400);
    assert.equal(await paymentsCount(), 0);
  });

  it('a payment that is authorized but not yet captured stays pending (the webhook finishes it later)', async () => {
    const payId = gwPayment(orderId, { status: 'authorized' });
    const r = await json('POST', '/api/student/fees/online/verify', { cookie: student, body: { razorpay_order_id: orderId, razorpay_payment_id: payId, razorpay_signature: checkoutSig(orderId, payId) } });
    assert.equal(r.status, 200);
    assert.equal(r.body.status, 'pending');
    assert.equal(await paymentsCount(), 0);
  });

  it('another student cannot claim this order, even with a valid signature', async () => {
    const payId = gwPayment(orderId);
    const r = await json('POST', '/api/student/fees/online/verify', { cookie: otherStudent, body: { razorpay_order_id: orderId, razorpay_payment_id: payId, razorpay_signature: checkoutSig(orderId, payId) } });
    assert.equal(r.status, 404);
  });

  it('a captured payment is recorded in the ordinary ledger with a receipt, and a repeat is harmless', async () => {
    const payId = gwPayment(orderId);
    const body = { razorpay_order_id: orderId, razorpay_payment_id: payId, razorpay_signature: checkoutSig(orderId, payId) };
    const r = await json('POST', '/api/student/fees/online/verify', { cookie: student, body });
    assert.equal(r.status, 200);
    assert.equal(r.body.status, 'paid');
    assert.match(r.body.receiptNo, /^RCPT\d{4}-\d{5}$/);

    const summary = await ledger();
    assert.equal(summary.paid, 5000);
    assert.equal(summary.outstanding, 30000);
    const pays = (await json('GET', '/api/student/fees/payments', { cookie: student })).body.payments;
    const mine = pays.find((p) => p.receiptNo === r.body.receiptNo);
    assert.equal(mine.method, 'online');
    assert.equal(mine.reference, payId);
    assert.equal((await orderRow(orderId)).status, 'paid');

    assert.equal((await json('POST', '/api/student/fees/online/verify', { cookie: student, body })).body.status, 'paid');
    assert.equal(await paymentsCount(), 1); // still one

    const pdf = await realFetch(`${base}/api/student/fees/payments/${mine.id}/receipt.pdf`, { headers: { cookie: student } });
    assert.equal(pdf.status, 200);
    assert.equal(Buffer.from(await pdf.arrayBuffer()).slice(0, 5).toString('latin1'), '%PDF-');
  });

  it('queues a payment-received email for the student', async () => {
    const { rows } = await withTx({ tenantId }, () => q("select subject from notifications where template = 'paymentReceived'"));
    assert.ok(rows.length >= 1);
    assert.match(rows[0].subject, /^Payment received - receipt RCPT/);
  });
});

describe('Webhook (the student closed the tab)', () => {
  let orderId;
  it('rejects a missing or wrong signature', async () => {
    const ev = { event: 'payment.captured', payload: { payment: { entity: { id: 'pay_x', order_id: 'order_x', amount: 100 } } } };
    assert.equal((await webhook(ev, { sign: false })).status, 400);
    assert.equal((await webhook(ev, { secret: 'not-the-secret' })).status, 400);
  });

  it('settles a captured payment on its own, allocating oldest-first, and a replay never double-records', async () => {
    orderId = (await json('POST', '/api/student/fees/online/orders', { cookie: student, body: { amount: 10000 } })).body.orderId; // whole-balance scope, an instalment
    const payId = gwPayment(orderId);
    const before = await ledger();
    const r = await webhook(capturedEvent(orderId, payId)); // no tenant in payload -> resolved through Razorpay's order notes
    assert.equal(r.status, 200);
    assert.equal(r.body.status, 'paid');
    const after1 = await ledger();
    assert.equal(after1.paid - before.paid, 10000);
    assert.equal((await orderRow(orderId)).status, 'paid');

    assert.equal((await webhook(capturedEvent(orderId, payId))).status, 200);
    assert.equal((await ledger()).paid, after1.paid);
    assert.equal(await paymentsCount(), 2);
  });

  it('also understands order.paid, which carries our notes in the payload', async () => {
    orderId = (await json('POST', '/api/student/fees/online/orders', { cookie: student, body: { amount: 500 } })).body.orderId;
    const payId = gwPayment(orderId);
    const ev = { event: 'order.paid', payload: { order: { entity: { id: orderId, notes: gw.orders.get(orderId).notes } }, payment: { entity: { id: payId, order_id: orderId, amount: 50000, method: 'card' } } } };
    const calls = gw.calls.length;
    assert.equal((await webhook(ev)).body.status, 'paid');
    assert.equal(gw.calls.length, calls); // tenant came from the payload: no extra call to Razorpay
  });

  it('ignores events for orders that are not ours, and unrelated event types, with a 200 so Razorpay stops retrying', async () => {
    const stranger = await webhook({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_z', order_id: 'order_not_ours', amount: 100 } } } });
    assert.equal(stranger.status, 200);
    assert.equal(stranger.body.ignored, true);
    assert.equal((await webhook({ event: 'refund.processed', payload: {} })).body.ignored, true);
  });

  it('records a failed attempt as a note without ending the order, so the student can retry', async () => {
    const o = (await json('POST', '/api/student/fees/online/orders', { cookie: student, body: { amount: 100 } })).body.orderId;
    const r = await webhook({ event: 'payment.failed', payload: { payment: { entity: { id: 'pay_f', order_id: o, amount: 10000, error_description: 'Payment declined by bank' } } } });
    assert.equal(r.body.recorded, 'failed');
    const row = await orderRow(o);
    assert.equal(row.status, 'created');
    assert.equal(row.failure_reason, 'Payment declined by bank');
    // ...and the retry on the same order then succeeds
    assert.equal((await webhook(capturedEvent(o, gwPayment(o)))).body.status, 'paid');
  });
});

describe('When the money arrives but the ledger can no longer take it', () => {
  let mismatchOrder; let staleOrder;
  it('a captured amount that differs from the order is flagged for review, not recorded', async () => {
    mismatchOrder = (await json('POST', '/api/student/fees/online/orders', { cookie: student, body: { amount: 500 } })).body.orderId;
    const before = await paymentsCount();
    const r = await webhook(capturedEvent(mismatchOrder, gwPayment(mismatchOrder, { amount: 49900 }), { amount: 49900 }));
    assert.equal(r.body.recorded, 'needs_review');
    assert.equal(await paymentsCount(), before);
    assert.equal((await orderRow(mismatchOrder)).status, 'needs_review');
  });

  it('a charge settled by cash while the student was paying is flagged for review instead of failing the webhook', async () => {
    staleOrder = (await json('POST', '/api/student/fees/online/orders', { cookie: student, body: { feeItemId: tuitionId, amount: 1000 } })).body.orderId;
    const outstanding = (await ledger()).outstanding;
    assert.equal((await json('POST', '/api/admin/fees/payments', { cookie: admin, body: { studentId, amount: outstanding, method: 'cash' } })).status, 201);
    const before = await paymentsCount();
    const r = await webhook(capturedEvent(staleOrder, gwPayment(staleOrder)));
    assert.equal(r.status, 200); // must NOT be an error, or Razorpay would retry for days
    assert.equal(r.body.status, 'needs_review');
    assert.equal(await paymentsCount(), before);
    const row = await orderRow(staleOrder);
    assert.equal(row.status, 'needs_review');
    assert.match(row.failure_reason, /not open|outstanding/i);
  });

  it('admins see these orders, must say how they resolved them, and can then close them', async () => {
    const list = (await json('GET', '/api/admin/fees/online-orders?status=needs_review', { cookie: admin })).body.orders;
    const mine = list.find((o) => o.razorpayOrderId === staleOrder);
    assert.ok(mine);
    assert.equal(mine.studentCode, 'MIT2026001');
    assert.equal((await json('PUT', `/api/admin/fees/online-orders/${mine.id}/resolve`, { cookie: admin, body: {} })).status, 400);
    assert.equal((await json('PUT', `/api/admin/fees/online-orders/${mine.id}/resolve`, { cookie: admin, body: { note: 'Refunded in Razorpay dashboard' } })).status, 200);
    assert.equal((await orderRow(staleOrder)).status, 'resolved');
    assert.equal((await json('PUT', `/api/admin/fees/online-orders/${mine.id}/resolve`, { cookie: admin, body: { note: 'again' } })).status, 409);
    // students cannot use the admin endpoints
    assert.equal((await json('GET', '/api/admin/fees/online-orders', { cookie: student })).status, 403);
  });
});

describe('Tenant isolation', () => {
  it('another institute can neither see nor settle this institute\'s orders', async () => {
    const collegeAdmin = await login('demo-college', 'admin', 'ADM001', 'Admin@123');
    const seen = (await json('GET', '/api/admin/fees/online-orders', { cookie: collegeAdmin })).body.orders;
    assert.equal(seen.length, 0);
    const { rows } = await withTx({}, () => q('select count(*)::int as n from online_payment_orders'));
    assert.equal(rows[0].n, 0); // no tenant context -> RLS shows nothing
  });
});

/**
 * Admission wizard (Phase 2) - run with `npm test` (needs `npm run db:setup` first).
 * Covers: saving the form step by step and resuming, the application fee (settings, office-collected and online through a
 * fake Razorpay), walk-in applications, bulk decisions and the merit list.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, describe, it } from 'node:test';

process.env.RAZORPAY_KEY_ID = 'rzp_test_wizard';
process.env.RAZORPAY_KEY_SECRET = 'wizard-key-secret';
process.env.RAZORPAY_WEBHOOK_SECRET = 'wizard-webhook-secret';
process.env.PUBLIC_CREATE_LIMIT = '1000';
process.env.PUBLIC_LOOKUP_LIMIT = '1000';
process.env.PUBLIC_FEE_ORDER_LIMIT = '1000';

const { env } = await import('../src/config/env.js');
const { createApp } = await import('../src/app.js');
const { closePool, q, withTx } = await import('../src/db/pool.js');
const { issueCaptchaToken } = await import('../src/services/captcha.service.js');

/* ---------- a fake Razorpay (same idea as onlinePayments.test.js) ---------- */
const realFetch = globalThis.fetch;
const GW = 'https://api.razorpay.com/v1';
const gw = { orders: new Map(), payments: new Map(), n: 0 };
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (!u.startsWith(GW)) return realFetch(url, opts);
  const path = u.slice(GW.length);
  const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  if ((opts.method || 'GET') === 'POST' && path === '/orders') {
    const order = { id: `order_W${++gw.n}`, ...JSON.parse(opts.body) };
    gw.orders.set(order.id, order);
    return reply(200, order);
  }
  const [, kind, id] = path.match(/^\/(orders|payments)\/(.+)$/) || [];
  const found = kind && (kind === 'orders' ? gw.orders : gw.payments).get(decodeURIComponent(id));
  return found ? reply(200, found) : reply(400, { error: { description: 'The id provided does not exist' } });
};
const gwPayment = (orderId, { status = 'captured' } = {}) => {
  const id = `pay_W${++gw.n}`;
  gw.payments.set(id, { id, order_id: orderId, amount: gw.orders.get(orderId).amount, status, method: 'upi' });
  return id;
};
const sig = (orderId, paymentId) => crypto.createHmac('sha256', env.RAZORPAY_KEY_SECRET).update(`${orderId}|${paymentId}`).digest('hex');

/* ---------- plumbing ---------- */
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(100, 66)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40)]);
const CODE = `test-adm-wiz-${Date.now().toString(36)}`;
let server; let base; let tenantId; let courseA; let courseB; let admin; let sa; let otherAdmin;

const json = async (method, path, { cookie, body, headers = {} } = {}) => {
  const r = await realFetch(`${base}${path}`, {
    method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let b = null; try { b = await r.json(); } catch { /* empty */ }
  return { status: r.status, body: b, headers: r.headers };
};
async function login(tenantCode, role, identifier, password) {
  const r = await json('POST', '/api/auth/login', { body: { tenantCode, role, identifier, password, captchaToken: issueCaptchaToken() } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.headers.getSetCookie().map((c) => c.split(';')[0]).find((c) => c.startsWith(`${env.COOKIE_NAME}=`));
}
const P = `/api/public/${CODE}/admissions`;
const acc = (c) => ({ 'x-access-code': c.accessCode });
const email = () => `wiz${Math.random().toString(36).slice(2, 9)}@example.com`;

/** Step 1 only: just enough to start. */
const start = (over = {}) => json('POST', `${P}/applications`, { body: { captchaToken: issueCaptchaToken(), courseId: courseA, name: 'Wizard Applicant', email: email(), phone: '9000000010', ...over } });
const step = (c, n, body) => json('PUT', `${P}/applications/${c.id}/steps/${n}`, { headers: acc(c), body });
const view = (c) => json('GET', `${P}/applications/${c.id}`, { headers: acc(c) });
const upload = (c, docType) => {
  const f = new FormData(); f.set('docType', docType); f.set('file', new Blob([docType === 'photo' ? PNG : PDF]), `${docType}.pdf`);
  return realFetch(`${base}${P}/applications/${c.id}/documents`, { method: 'POST', headers: acc(c), body: f });
};
const submit = (c) => json('POST', `${P}/applications/${c.id}/submit`, { headers: acc(c) });
const STEP2 = { dob: '2006-05-05', gender: 'Female', address: '12 Park Road, Pune', personal: { nationality: 'Indian', category: 'General', bloodGroup: 'O+' } };
const STEP3 = { guardian: { fatherName: 'Ramesh', motherName: 'Sita', name: 'Ramesh', relation: 'Father', phone: '9000000011', email: 'ramesh@example.com', occupation: 'Engineer' } };
const STEP4 = { previousEducation: { institution: 'ABC Junior College', qualification: 'HSC', board: 'State Board', year: '2024', percentage: '88.5', tenth: { board: 'State Board', year: '2022', percentage: '90' } }, entrance: { exam: 'JEE Main', rollNo: 'JM123', score: '91.2' } };

/** Walks the whole wizard and submits. `percentage` shapes the merit order. */
async function complete(over = {}, percentage = '88.5') {
  const c = (await start(over)).body;
  assert.equal((await step(c, 1, {})).status, 200);
  assert.equal((await step(c, 2, STEP2)).status, 200);
  assert.equal((await step(c, 3, STEP3)).status, 200);
  assert.equal((await step(c, 4, { ...STEP4, previousEducation: { ...STEP4.previousEducation, percentage } })).status, 200);
  for (const t of ['photo', 'id_proof', 'marksheet']) assert.equal((await upload(c, t)).status, 201);
  return c;
}
const adminGet = (id) => json('GET', `/api/admin/admissions/${id}`, { cookie: admin });
const verifyAll = async (id) => {
  for (const d of (await adminGet(id)).body.application.documents) await json('PUT', `/api/admin/admissions/${id}/documents/${d.id}`, { cookie: admin, body: { status: 'verified' } });
};
const setSettings = (body) => json('PUT', '/api/admin/admissions/settings', { cookie: admin, body });

before(async () => {
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  sa = await login('', 'super_admin', 'SA001', 'SuperAdmin@123');
  const t = await json('POST', '/api/super-admin/tenants', { cookie: sa, body: { code: CODE, name: 'Wizard Test College', type: 'college', admin: { name: 'Adm', email: `a@${CODE}.example` } } });
  assert.equal(t.status, 201);
  tenantId = t.body.tenant.id;
  await withTx({ tenantId }, async () => {
    courseA = (await q("insert into courses (code, name, full_name, years) values ('BSC', 'B.Sc', 'Bachelor of Science', 3) returning id")).rows[0].id;
    courseB = (await q("insert into courses (code, name, full_name, years) values ('BCA', 'BCA', 'Bachelor of Computer Applications', 3) returning id")).rows[0].id;
  });
  const first = await login(CODE, 'admin', 'ADM001', t.body.admin.temporaryPassword);
  const ch = await realFetch(`${base}/api/auth/change-password`, {
    method: 'POST', headers: { 'content-type': 'application/json', cookie: first },
    body: JSON.stringify({ currentPassword: t.body.admin.temporaryPassword, newPassword: 'Changed@12345' }),
  });
  admin = ch.headers.getSetCookie().map((c) => c.split(';')[0]).find((c) => c.startsWith(`${env.COOKIE_NAME}=`));
  otherAdmin = await login('demo-school', 'admin', 'ADM001', 'Admin@123');
});
after(async () => {
  await withTx({ platform: true }, () => q("delete from tenants where code like 'test-adm-wiz-%'"));
  globalThis.fetch = realFetch;
  await new Promise((r) => server.close(r));
  await closePool();
});

describe('The form is saved step by step', () => {
  it('starts with a course, a name and an email - nothing else is needed for a draft', async () => {
    const r = await start();
    assert.equal(r.status, 201);
    assert.match(r.body.applicationNo, /^APP\d{4}-\d{5}$/);
    const v = (await view(r.body)).body.application;
    assert.equal(v.status, 'draft');
    assert.equal(v.step, 1);
    assert.equal(v.form.dob, null);
    assert.equal(v.fee.status, 'none');
  });

  it('keeps each step, moves the "furthest step" forward, and a later visit finds everything again', async () => {
    const c = (await start()).body;
    assert.equal((await step(c, 2, STEP2)).body.application.step, 3);
    assert.equal((await step(c, 3, STEP3)).body.application.step, 4);
    const four = (await step(c, 4, STEP4)).body.application;
    assert.equal(four.step, 5);
    assert.equal(four.form.previousEducation.tenth.percentage, '90');
    assert.equal(four.form.entrance.exam, 'JEE Main');
    // Going back to an earlier step does not lose progress
    assert.equal((await step(c, 2, { address: '99 New Road' })).body.application.step, 5);

    // "Resume": number + access code on another device
    const found = await json('POST', `${P}/applications/lookup`, { body: { applicationNo: c.applicationNo, accessCode: c.accessCode } });
    assert.equal(found.status, 200);
    assert.equal(found.body.application.form.address, '99 New Road');
    assert.equal(found.body.application.form.guardian.motherName, 'Sita');
    assert.equal(found.body.application.form.personal.category, 'General');
  });

  it('refuses a wrong access code, a step outside 1-6 and bad values', async () => {
    const c = (await start()).body;
    assert.equal((await json('PUT', `${P}/applications/${c.id}/steps/2`, { headers: { 'x-access-code': 'nope' }, body: STEP2 })).status, 404);
    assert.equal((await step(c, 9, {})).status, 400);
    assert.equal((await step(c, 2, { dob: '2999-01-01' })).status, 400);
    assert.equal((await step(c, 2, { personal: { category: 'Martian' } })).status, 400);
    assert.equal((await step(c, 4, { previousEducation: { percentage: 'a lot' } })).status, 400);
    assert.equal((await step(c, 1, { email: 'not-an-email' })).status, 400);
    assert.equal((await step(c, 1, { courseId: '11111111-1111-1111-1111-111111111111' })).status, 400);
  });

  it('lets the applicant change the course while it is still a draft', async () => {
    const c = (await start()).body;
    const r = await step(c, 1, { courseId: courseB });
    assert.equal(r.status, 200);
    assert.equal(r.body.application.form.courseId, courseB);
  });

  it('cannot submit until each step is complete - and says which step to go back to', async () => {
    const c = (await start({ phone: '' })).body;
    let r = await submit(c);
    assert.equal(r.status, 400); assert.equal(r.body.code, 'STEP_COURSE');
    await step(c, 1, { phone: '9000000012' });
    r = await submit(c); assert.equal(r.body.code, 'STEP_PERSONAL');
    await step(c, 2, STEP2);
    r = await submit(c); assert.equal(r.body.code, 'STEP_PARENTS');
    await step(c, 3, STEP3);
    r = await submit(c); assert.equal(r.body.code, 'STEP_DOCUMENTS');
    for (const t of ['photo', 'id_proof', 'marksheet']) await upload(c, t);
    r = await submit(c);
    assert.equal(r.status, 200);
    assert.equal(r.body.application.status, 'submitted');
    assert.equal(r.body.application.step, 6);
    // And nothing can be edited afterwards
    assert.equal((await step(c, 2, { address: 'Elsewhere' })).status, 409);
  });

  it('accepts the optional signature as a document', async () => {
    const c = (await start()).body;
    assert.equal((await upload(c, 'signature')).status, 201);
    const v = (await view(c)).body.application;
    assert.ok(v.documents.some((d) => d.docType === 'signature'));
    assert.ok(!v.requiredDocuments.includes('signature'));
  });
});

describe('Admissions settings', () => {
  it('shows the fee and instructions to applicants, and can close applications', async () => {
    const put = await setSettings({ applicationFee: 0, accepting: false, instructions: 'Keep your marksheet ready.' });
    assert.equal(put.status, 200);
    const info = (await json('GET', `${P}/info`)).body;
    assert.equal(info.settings.accepting, false);
    assert.equal(info.settings.instructions, 'Keep your marksheet ready.');
    assert.equal((await start()).status, 403);
    await setSettings({ applicationFee: 0, accepting: true, instructions: '' });
    assert.equal((await start()).status, 201);
  });

  it('rejects a negative or silly fee, and is closed to everyone but the office', async () => {
    assert.equal((await setSettings({ applicationFee: -5 })).status, 400);
    assert.equal((await setSettings({ applicationFee: 'lots' })).status, 400);
    const c = (await start()).body;
    assert.equal((await json('PUT', '/api/admin/admissions/settings', { body: { applicationFee: 1 } })).status, 401);
    void c;
  });
});

describe('Application fee collected by the office (online payment off)', () => {
  const saved = {};
  before(() => { for (const k of ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET']) { saved[k] = process.env[k]; delete process.env[k]; } });
  after(async () => { Object.assign(process.env, saved); await setSettings({ applicationFee: 0, accepting: true, instructions: '' }); });

  it('lets the applicant submit with the fee pending, but the office cannot accept until it is recorded', async () => {
    await setSettings({ applicationFee: 500, accepting: true, instructions: '' });
    const c = await complete();
    assert.equal((await view(c)).body.application.fee.status, 'pending');
    assert.equal((await view(c)).body.application.fee.amount, 500);
    assert.equal((await json('POST', `${P}/applications/${c.id}/fee/order`, { headers: acc(c) })).status, 503);
    assert.equal((await submit(c)).status, 200);

    await verifyAll(c.id);
    const refused = await json('POST', `/api/admin/admissions/${c.id}/decision`, { cookie: admin, body: { decision: 'accept' } });
    assert.equal(refused.status, 409);
    assert.match(refused.body.message, /fee/i);

    const paid = await json('PUT', `/api/admin/admissions/${c.id}/fee`, { cookie: admin, body: { action: 'paid', reference: 'Cash receipt 17' } });
    assert.equal(paid.status, 200);
    assert.equal(paid.body.application.feeStatus, 'paid');
    assert.equal(paid.body.application.feeReference, 'Cash receipt 17');
    assert.equal((await json('PUT', `/api/admin/admissions/${c.id}/fee`, { cookie: admin, body: { action: 'paid' } })).status, 409);
    assert.equal((await json('POST', `/api/admin/admissions/${c.id}/decision`, { cookie: admin, body: { decision: 'accept' } })).status, 200);
  });

  it('a waiver needs a reason', async () => {
    const c = await complete();
    await submit(c);
    assert.equal((await json('PUT', `/api/admin/admissions/${c.id}/fee`, { cookie: admin, body: { action: 'waived' } })).status, 400);
    const r = await json('PUT', `/api/admin/admissions/${c.id}/fee`, { cookie: admin, body: { action: 'waived', reference: 'Staff ward' } });
    assert.equal(r.body.application.feeStatus, 'waived');
  });
});

describe('Application fee paid online', () => {
  before(() => setSettings({ applicationFee: 750, accepting: true, instructions: '' }));
  after(() => setSettings({ applicationFee: 0, accepting: true, instructions: '' }));

  it('must be paid before the application can be submitted', async () => {
    const c = await complete();
    const r = await submit(c);
    assert.equal(r.status, 400); assert.equal(r.body.code, 'STEP_PAYMENT');
  });

  it('creates an order for the fee the SERVER holds, verifies the signed result and then lets the applicant submit', async () => {
    const c = await complete();
    const o = await json('POST', `${P}/applications/${c.id}/fee/order`, { headers: acc(c) });
    assert.equal(o.status, 201);
    assert.equal(o.body.amountPaise, 75000);
    assert.equal(o.body.keyId, 'rzp_test_wizard');
    assert.ok(!JSON.stringify(o.body).includes('wizard-key-secret'));
    assert.equal(gw.orders.get(o.body.orderId).notes.kind, 'application_fee');

    const pay = gwPayment(o.body.orderId);
    const bad = await json('POST', `${P}/applications/${c.id}/fee/verify`, { headers: acc(c), body: { razorpay_order_id: o.body.orderId, razorpay_payment_id: pay, razorpay_signature: 'forged' } });
    assert.equal(bad.status, 400);
    assert.equal((await view(c)).body.application.fee.status, 'pending');

    const ok = await json('POST', `${P}/applications/${c.id}/fee/verify`, { headers: acc(c), body: { razorpay_order_id: o.body.orderId, razorpay_payment_id: pay, razorpay_signature: sig(o.body.orderId, pay) } });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.status, 'paid');
    assert.equal(ok.body.application.fee.status, 'paid');
    assert.equal(ok.body.application.fee.reference, pay);
    assert.equal((await submit(c)).status, 200);

    // verifying again is harmless, and there is nothing left to order
    assert.equal((await json('POST', `${P}/applications/${c.id}/fee/verify`, { headers: acc(c), body: { razorpay_order_id: o.body.orderId, razorpay_payment_id: pay, razorpay_signature: sig(o.body.orderId, pay) } })).status, 200);
    assert.equal((await json('POST', `${P}/applications/${c.id}/fee/order`, { headers: acc(c) })).status, 409);
  });

  it("does not trust a payment that is not captured, or one for another application's order", async () => {
    const c = await complete(); const d = await complete();
    const o = (await json('POST', `${P}/applications/${c.id}/fee/order`, { headers: acc(c) })).body;
    const pending = gwPayment(o.orderId, { status: 'authorized' });
    const r = await json('POST', `${P}/applications/${c.id}/fee/verify`, { headers: acc(c), body: { razorpay_order_id: o.orderId, razorpay_payment_id: pending, razorpay_signature: sig(o.orderId, pending) } });
    assert.equal(r.body.status, 'pending');
    assert.equal(r.body.application.fee.status, 'pending');
    // someone else's order, signed correctly, still cannot be claimed by a different application
    const cross = await json('POST', `${P}/applications/${d.id}/fee/verify`, { headers: acc(d), body: { razorpay_order_id: o.orderId, razorpay_payment_id: pending, razorpay_signature: sig(o.orderId, pending) } });
    assert.equal(cross.status, 404);
  });

  it('settles from the webhook when the applicant closes the tab right after paying (and only once)', async () => {
    const c = await complete();
    const o = (await json('POST', `${P}/applications/${c.id}/fee/order`, { headers: acc(c) })).body;
    const pay = gwPayment(o.orderId);
    const send = async () => {
      const raw = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: pay, order_id: o.orderId, amount: gw.orders.get(o.orderId).amount, method: 'upi', status: 'captured' } } } });
      const s = crypto.createHmac('sha256', env.RAZORPAY_WEBHOOK_SECRET).update(raw).digest('hex');
      const r = await realFetch(`${base}/api/webhooks/razorpay`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-razorpay-signature': s }, body: raw });
      return r.status;
    };
    assert.equal(await send(), 200);
    assert.equal(await send(), 200);
    const v = (await view(c)).body.application;
    assert.equal(v.fee.status, 'paid');
    const { rows } = await withTx({ tenantId }, () => q('select status from application_fee_orders where application_id = $1', [c.id]));
    assert.deepEqual(rows.map((x) => x.status), ['paid']);
    assert.equal((await submit(c)).status, 200);
  });
});

describe('Walk-in applications (typed in by the office)', () => {
  it('goes straight to review with the documents the office scanned already verified', async () => {
    const body = { courseId: courseA, name: 'Walk In', email: email(), phone: '9000000020', ...STEP2, ...STEP3, ...STEP4 };
    const r = await json('POST', '/api/admin/admissions/walk-in', { cookie: admin, body });
    assert.equal(r.status, 201);
    const a = r.body.application;
    assert.equal(a.status, 'submitted'); assert.equal(a.source, 'walk_in');
    assert.ok(r.body.accessCode);
    for (const t of ['photo', 'id_proof', 'marksheet']) {
      const f = new FormData(); f.set('docType', t); f.set('file', new Blob([t === 'photo' ? PNG : PDF]), `${t}.pdf`);
      const up = await realFetch(`${base}/api/admin/admissions/${a.id}/documents`, { method: 'POST', headers: { cookie: admin }, body: f });
      assert.equal(up.status, 201);
    }
    const full = (await adminGet(a.id)).body.application;
    assert.equal(full.documents.length, 3);
    assert.ok(full.documents.every((d) => d.status === 'verified'));
    assert.equal((await json('POST', `/api/admin/admissions/${a.id}/decision`, { cookie: admin, body: { decision: 'accept' } })).status, 200);
    // the applicant can use the same number and code to look at their application
    const found = await json('POST', `${P}/applications/lookup`, { body: { applicationNo: a.applicationNo, accessCode: r.body.accessCode } });
    assert.equal(found.status, 200);
  });

  it('needs the same details as an online application, rejects a repeat, and is the office only', async () => {
    const mail = email();
    const ok = { courseId: courseA, name: 'Walk Twice', email: mail, phone: '9000000021', ...STEP2, ...STEP3 };
    assert.equal((await json('POST', '/api/admin/admissions/walk-in', { cookie: admin, body: { ...ok, guardian: {} } })).body.message.includes('guardian'), true);
    assert.equal((await json('POST', '/api/admin/admissions/walk-in', { cookie: admin, body: ok })).status, 201);
    assert.equal((await json('POST', '/api/admin/admissions/walk-in', { cookie: admin, body: ok })).status, 409);
    assert.equal((await json('POST', '/api/admin/admissions/walk-in', { body: ok })).status, 401);
  });

  it('records the fee when the applicant pays at the counter', async () => {
    await setSettings({ applicationFee: 300, accepting: true, instructions: '' });
    try {
      const base0 = { courseId: courseA, phone: '9000000022', ...STEP2, ...STEP3 };
      const paid = await json('POST', '/api/admin/admissions/walk-in', { cookie: admin, body: { ...base0, name: 'Paid Walker', email: email(), feeStatus: 'paid', feeReference: 'Receipt 5' } });
      assert.equal(paid.body.application.feeStatus, 'paid');
      const owing = await json('POST', '/api/admin/admissions/walk-in', { cookie: admin, body: { ...base0, name: 'Owing Walker', email: email() } });
      assert.equal(owing.body.application.feeStatus, 'pending');
    } finally { await setSettings({ applicationFee: 0, accepting: true, instructions: '' }); }
  });
});

describe('Deciding on many applications at once', () => {
  it('accepts those that can be accepted and says why the others cannot', async () => {
    const good1 = await complete(); const good2 = await complete(); const unverified = await complete();
    for (const c of [good1, good2, unverified]) await submit(c);
    await verifyAll(good1.id); await verifyAll(good2.id);
    const r = await json('POST', '/api/admin/admissions/bulk-decision', { cookie: admin, body: { ids: [good1.id, good2.id, unverified.id], decision: 'accept' } });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.done.sort(), [good1.id, good2.id].sort());
    assert.equal(r.body.failed.length, 1);
    assert.equal(r.body.failed[0].id, unverified.id);
    assert.equal(r.body.failed[0].applicationNo, unverified.applicationNo);
    assert.match(r.body.failed[0].reason, /Verify these documents/);
    assert.equal((await adminGet(good1.id)).body.application.status, 'accepted');
    assert.equal((await adminGet(unverified.id)).body.application.status, 'submitted'); // the failed one is untouched
  });

  it('needs a note to reject or waitlist, a valid decision and a sensible list', async () => {
    const c = await complete(); await submit(c);
    const url = '/api/admin/admissions/bulk-decision';
    assert.equal((await json('POST', url, { cookie: admin, body: { ids: [c.id], decision: 'reject' } })).status, 400);
    assert.equal((await json('POST', url, { cookie: admin, body: { ids: [c.id], decision: 'explode' } })).status, 400);
    assert.equal((await json('POST', url, { cookie: admin, body: { ids: [], decision: 'accept' } })).status, 400);
    assert.equal((await json('POST', url, { cookie: admin, body: { ids: ['x'], decision: 'accept' } })).status, 400);
    const ok = await json('POST', url, { cookie: admin, body: { ids: [c.id], decision: 'waitlist', note: 'Seats are full' } });
    assert.deepEqual(ok.body.done, [c.id]);
    assert.equal((await adminGet(c.id)).body.application.status, 'waitlisted');
  });

  it("does not touch another institute's applications", async () => {
    const c = await complete(); await submit(c);
    const r = await json('POST', '/api/admin/admissions/bulk-decision', { cookie: otherAdmin, body: { ids: [c.id], decision: 'reject', note: 'No' } });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.done, []);
    assert.equal(r.body.failed.length, 1);
    assert.equal((await adminGet(c.id)).body.application.status, 'submitted');
  });
});

describe('Merit list', () => {
  let ids;
  before(async () => {
    ids = {};
    for (const [key, pct, course] of [['low', '61', courseB], ['high', '94', courseB], ['mid', '78', courseB], ['tie', '78', courseB]]) {
      const c = await complete({ courseId: course, name: `Merit ${key}` }, pct);
      await submit(c);
      ids[key] = c;
    }
  });

  it('ranks each course by qualifying percentage, with ties sharing a rank', async () => {
    const r = await json('GET', `/api/admin/admissions/merit-list?courseId=${courseB}`, { cookie: admin });
    assert.equal(r.status, 200);
    const names = r.body.rows.map((x) => `${x.rank}:${x.name}`);
    assert.equal(names[0], '1:Merit high');
    assert.ok(names.includes('2:Merit mid') && names.includes('2:Merit tie'));
    assert.equal(names[3], '4:Merit low');
  });

  it('uses a merit score the office sets instead of the percentage', async () => {
    const set = await json('PUT', `/api/admin/admissions/${ids.low.id}/merit`, { cookie: admin, body: { meritScore: 99.5 } });
    assert.equal(set.status, 200);
    assert.equal(set.body.application.meritValue, 99.5);
    const r = await json('GET', `/api/admin/admissions/merit-list?courseId=${courseB}`, { cookie: admin });
    assert.equal(r.body.rows[0].name, 'Merit low');
    assert.equal((await json('PUT', `/api/admin/admissions/${ids.low.id}/merit`, { cookie: admin, body: { meritScore: 5000 } })).status, 400);
    await json('PUT', `/api/admin/admissions/${ids.low.id}/merit`, { cookie: admin, body: { meritScore: null } });
    assert.equal((await json('GET', `/api/admin/admissions/merit-list?courseId=${courseB}`, { cookie: admin })).body.rows[0].name, 'Merit high');
  });

  it('downloads as CSV and PDF', async () => {
    const csv = await realFetch(`${base}/api/admin/admissions/merit-list?courseId=${courseB}&format=csv`, { headers: { cookie: admin } });
    assert.equal(csv.status, 200);
    const text = await csv.text();
    assert.match(text, /Rank,Application no\.,Name,Course,Merit/);
    assert.match(text, /Merit high/);
    const pdf = await realFetch(`${base}/api/admin/admissions/merit-list?courseId=${courseB}&format=pdf`, { headers: { cookie: admin } });
    assert.equal(pdf.status, 200);
    assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');
    assert.equal((await json('GET', '/api/admin/admissions/merit-list?format=docx', { cookie: admin })).status, 400);
  });

  it('is filtered and counted for the pipeline cards', async () => {
    const list = await json('GET', `/api/admin/admissions?courseId=${courseB}`, { cookie: admin });
    assert.ok(list.body.applications.every((a) => a.courseId === courseB));
    assert.equal(typeof list.body.counts.feePending, 'number');
    assert.equal(typeof list.body.counts.drafts, 'number');
  });
});

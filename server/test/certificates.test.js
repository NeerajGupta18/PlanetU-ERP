/** Certificates (Phase 2) - run with `npm test` (needs `npm run db:setup` first). */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { env } from '../src/config/env.js';
import { createApp } from '../src/app.js';
import { closePool, q, withTx } from '../src/db/pool.js';
import { issueCaptchaToken } from '../src/services/captcha.service.js';

let server; let base; let tenantId; let admin; let student; let student2; let employee; let schoolAdmin; let studentId; let student2Id;

const json = async (method, path, { cookie, body } = {}) => {
  const r = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let b = null; try { b = await r.json(); } catch { /* empty */ }
  return { status: r.status, body: b };
};
async function login(tenantCode, role, identifier, password) {
  const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tenantCode, role, identifier, password, captchaToken: issueCaptchaToken() }) });
  assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
  return r.headers.getSetCookie().map((c) => c.split(';')[0]).find((c) => c.startsWith(`${env.COOKIE_NAME}=`));
}
const pdfOf = async (path, cookie) => {
  const r = await fetch(`${base}${path}`, { headers: { cookie } });
  return { status: r.status, bytes: Buffer.from(await r.arrayBuffer()), type: r.headers.get('content-type') };
};
const ask = (cookie, certType, purpose = 'Opening a bank account') => json('POST', '/api/student/certificates', { cookie, body: { certType, purpose } });
const decide = (id, body) => json('PUT', `/api/admin/certificates/${id}`, { cookie: admin, body });
const cleanup = async () => withTx({ tenantId }, async () => {
  await q('delete from certificate_requests where student_id = any($1)', [[studentId, student2Id]]);
  await q('delete from student_fee_items where student_id = any($1) and label = $2', [[studentId, student2Id], 'Cert test dues']);
  await q("delete from notifications where template = 'certificateUpdate'");
});

before(async () => {
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  admin = await login('demo-college', 'admin', 'ADM001', 'Admin@123');
  student = await login('demo-college', 'student', 'STU2026001', 'Student@123');
  student2 = await login('demo-college', 'student', 'STU2026002', 'Student@123');
  employee = await login('demo-college', 'employee', 'EMP001', 'Employee@123');
  schoolAdmin = await login('demo-school', 'admin', 'ADM001', 'Admin@123');
  tenantId = (await withTx({ platform: true }, () => q("select id from tenants where code = 'demo-college'"))).rows[0].id;
  const ids = (await withTx({ tenantId }, () => q("select id, student_code from students where student_code in ('STU2026001', 'STU2026002')"))).rows;
  studentId = ids.find((r) => r.student_code === 'STU2026001').id;
  student2Id = ids.find((r) => r.student_code === 'STU2026002').id;
  await cleanup();
});
after(async () => {
  await cleanup();
  await new Promise((r) => server.close(r));
  await closePool();
});

describe('Asking for a certificate (student)', () => {
  it('lists the kinds on offer and makes a request', async () => {
    const empty = await json('GET', '/api/student/certificates', { cookie: student });
    assert.deepEqual(Object.keys(empty.body.types), ['bonafide', 'character', 'noc', 'transfer']);
    const r = await ask(student, 'bonafide');
    assert.equal(r.status, 201);
    assert.equal(r.body.request.status, 'requested');
    assert.equal(r.body.request.certLabel, 'Bonafide certificate');
    assert.equal(r.body.request.certificateNo, null);
    assert.equal((await json('GET', '/api/student/certificates', { cookie: student })).body.requests.length, 1);
  });

  it('does not allow a second open request of the same kind, a made-up kind or a missing purpose', async () => {
    assert.equal((await ask(student, 'bonafide')).status, 409);
    assert.equal((await ask(student, 'diploma')).status, 400);
    assert.equal((await ask(student, 'noc', '   ')).status, 400);
    assert.equal((await ask(student, 'noc', 'x'.repeat(301))).status, 400);
  });

  it('is for students only, and each student sees only their own', async () => {
    assert.equal((await json('GET', '/api/student/certificates', { cookie: employee })).status, 403);
    assert.equal((await json('GET', '/api/student/certificates', { cookie: student2 })).body.requests.length, 0);
  });
});

describe('Issuing (office)', () => {
  it('shows the waiting request, issues it with a number from the institute series and emails the student', async () => {
    const list = await json('GET', '/api/admin/certificates?status=requested', { cookie: admin });
    assert.equal(list.body.requests.length, 1);
    assert.equal(list.body.counts.requested, 1);
    const id = list.body.requests[0].id;
    assert.equal(list.body.requests[0].studentCode, 'STU2026001');

    // Not issued yet, so there is nothing to download
    assert.equal((await pdfOf(`/api/student/certificates/${id}/pdf`, student)).status, 409);

    const r = await decide(id, { decision: 'issue', remark: 'Collect the original from the office' });
    assert.equal(r.status, 200);
    assert.equal(r.body.request.status, 'issued');
    assert.match(r.body.request.certificateNo, /^CERT\d{4}-\d{5}$/);
    assert.equal((await decide(id, { decision: 'issue' })).status, 409); // only once

    const mails = (await withTx({ tenantId }, () => q("select subject, text_body from notifications where template = 'certificateUpdate' and to_email like 'aarav.sharma%'"))).rows;
    assert.equal(mails.length, 1);
    assert.match(mails[0].subject, /Bonafide certificate is ready/);
    assert.ok(mails[0].text_body.includes(r.body.request.certificateNo));
  });

  it('gives the student a real PDF of their own certificate, and nobody else', async () => {
    const mine = (await json('GET', '/api/student/certificates', { cookie: student })).body.requests.find((x) => x.status === 'issued');
    const own = await pdfOf(`/api/student/certificates/${mine.id}/pdf`, student);
    assert.equal(own.status, 200);
    assert.equal(own.type, 'application/pdf');
    assert.equal(own.bytes.subarray(0, 5).toString(), '%PDF-');
    assert.equal((await pdfOf(`/api/student/certificates/${mine.id}/pdf`, student2)).status, 404);
    assert.equal((await pdfOf(`/api/admin/certificates/${mine.id}/pdf`, admin)).status, 200);
    assert.equal((await pdfOf(`/api/admin/certificates/${mine.id}/pdf`, schoolAdmin)).status, 404);
    assert.equal((await pdfOf(`/api/admin/certificates/${mine.id}/pdf`, student)).status, 403);
  });

  it('rejects a request only with a reason, and tells the student', async () => {
    const r = await ask(student2, 'noc', 'Internship at a company');
    const id = r.body.request.id;
    assert.equal((await decide(id, { decision: 'reject' })).status, 400);
    const done = await decide(id, { decision: 'reject', remark: 'Please submit the offer letter first' });
    assert.equal(done.body.request.status, 'rejected');
    assert.equal(done.body.request.remark, 'Please submit the offer letter first');
    assert.equal((await pdfOf(`/api/student/certificates/${id}/pdf`, student2)).status, 409);
    // after a rejection the student can ask again
    assert.equal((await ask(student2, 'noc', 'Internship, with the offer letter')).status, 201);
    assert.equal((await decide(id, { decision: 'maybe' })).status, 409);
  });

  it('issues straight away for a student who asked at the counter, with the extra details a character certificate needs', async () => {
    const r = await json('POST', '/api/admin/certificates', { cookie: admin, body: { studentId: student2Id, certType: 'character', purpose: 'Scholarship application', details: { conduct: 'Excellent' } } });
    assert.equal(r.status, 201);
    assert.equal(r.body.request.status, 'issued');
    assert.equal(r.body.request.details.conduct, 'Excellent');
    assert.equal((await pdfOf(`/api/admin/certificates/${r.body.request.id}/pdf`, admin)).bytes.subarray(0, 5).toString(), '%PDF-');
    assert.equal((await json('POST', '/api/admin/certificates', { cookie: admin, body: { studentId: '11111111-1111-1111-1111-111111111111', certType: 'character', purpose: 'x' } })).status, 404);
    assert.equal((await json('POST', '/api/admin/certificates', { cookie: admin, body: { studentId: student2Id, certType: 'nope', purpose: 'x' } })).status, 400);
  });

  it('numbers every certificate differently', async () => {
    const a = await json('POST', '/api/admin/certificates', { cookie: admin, body: { studentId: studentId, certType: 'noc', purpose: 'Training' } });
    const b = await json('POST', '/api/admin/certificates', { cookie: admin, body: { studentId: studentId, certType: 'noc', purpose: 'Training 2' } });
    assert.notEqual(a.body.request.certificateNo, b.body.request.certificateNo);
  });

  it('is the office only', async () => {
    assert.equal((await json('GET', '/api/admin/certificates', { cookie: student })).status, 403);
    assert.equal((await json('GET', '/api/admin/certificates', { cookie: employee })).status, 403);
    const everyone = await json('GET', '/api/admin/certificates', { cookie: schoolAdmin });
    assert.ok(!everyone.body.requests.some((x) => x.studentCode === 'STU2026001'));
  });
});

describe('Transfer certificates', () => {
  it('are held back while the student owes fees - unless the office decides to issue anyway', async () => {
    await json('POST', `/api/admin/fees/students/${studentId}/items`, { cookie: admin, body: { label: 'Cert test dues', amount: 1234 } });
    const body = { studentId, certType: 'transfer', purpose: 'Moving to another city', details: { leavingDate: '2026-06-30', reason: 'Family relocation', conduct: 'Good' } };
    const held = await json('POST', '/api/admin/certificates', { cookie: admin, body });
    assert.equal(held.status, 409);
    assert.equal(held.body.code, 'HAS_DUES');
    assert.match(held.body.message, /1,234/);
    // the refused attempt leaves nothing behind in the queue
    const waiting = await json('GET', '/api/admin/certificates?status=requested', { cookie: admin });
    assert.ok(!waiting.body.requests.some((x) => x.studentCode === 'STU2026001' && x.certType === 'transfer'));
    const forced = await json('POST', '/api/admin/certificates', { cookie: admin, body: { ...body, force: true } });
    assert.equal(forced.status, 201);
    assert.equal(forced.body.request.details.reason, 'Family relocation');
    const pdf = await pdfOf(`/api/admin/certificates/${forced.body.request.id}/pdf`, admin);
    assert.equal(pdf.bytes.subarray(0, 5).toString(), '%PDF-');
  });

  it('are issued without a fuss for a student with nothing to pay', async () => {
    const r = await json('POST', '/api/admin/certificates', { cookie: admin, body: { studentId: student2Id, certType: 'transfer', purpose: 'Course completed', details: { reason: 'Course completed' } } });
    assert.equal(r.status, 201);
    assert.ok(r.body.request.details.leavingDate);
    assert.equal((await json('POST', '/api/admin/certificates', { cookie: admin, body: { studentId: student2Id, certType: 'transfer', purpose: 'x', details: { leavingDate: '30/06/2026' } } })).status, 400);
  });
});

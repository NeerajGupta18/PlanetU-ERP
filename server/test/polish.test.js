/** UI Phase 5 (testing and polish): the student record at a glance - run with `npm test` (needs `npm run db:setup` first). */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { env } from '../src/config/env.js';
import { createApp } from '../src/app.js';
import { closePool, q, withTx } from '../src/db/pool.js';
import { issueCaptchaToken } from '../src/services/captcha.service.js';

let server; let base;
const get = async (path, cookie) => {
  const r = await fetch(`${base}${path}`, { headers: { cookie } });
  let b = null; try { b = await r.json(); } catch { /* empty */ }
  return { status: r.status, body: b };
};
async function login(tenantCode, role, identifier, password) {
  const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tenantCode, role, identifier, password, captchaToken: issueCaptchaToken() }) });
  assert.equal(r.status, 200);
  return r.headers.getSetCookie().map((c) => c.split(';')[0]).find((c) => c.startsWith(`${env.COOKIE_NAME}=`));
}

let admin; let schoolAdmin; let accountant; let student; let studentId; let schoolStudentId;
before(async () => {
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  admin = await login('demo-college', 'admin', 'ADM001', 'Admin@123');
  schoolAdmin = await login('demo-school', 'admin', 'ADM001', 'Admin@123');
  accountant = await login('demo-college', 'employee', 'EMP008', 'Employee@123');
  student = await login('demo-college', 'student', 'STU2026001', 'Student@123');
  const ids = await withTx({ platform: true }, () => q("select id, code from tenants where code in ('demo-college', 'demo-school')"));
  const t = Object.fromEntries(ids.rows.map((r) => [r.code, r.id]));
  studentId = (await withTx({ tenantId: t['demo-college'] }, () => q("select id from students where student_code = 'STU2026001'"))).rows[0].id;
  schoolStudentId = (await withTx({ tenantId: t['demo-school'] }, () => q('select id from students order by student_code limit 1'))).rows[0].id;
});
after(async () => {
  await new Promise((r) => server.close(r));
  await closePool();
});

describe('student record at a glance', () => {
  it('gives the office attendance, fees and results for one student', async () => {
    const { status, body } = await get(`/api/admin/students/${studentId}/overview`, admin);
    assert.equal(status, 200);
    assert.ok(body.attendance.overall >= 0 && body.attendance.overall <= 100);
    assert.equal(body.attendance.threshold, 75);
    assert.ok(body.attendance.low.every((x) => x.pct < 75));
    for (const k of ['total', 'paid', 'outstanding', 'overdue']) assert.equal(typeof body.fees[k], 'number', k);
    assert.ok(body.fees.overdue <= body.fees.outstanding);
    assert.ok(Array.isArray(body.results.exams));
    assert.ok(body.results.exams.length <= 5);
  });

  it('is open to the principal, whose role covers the student office', async () => {
    const principal = await login('demo-college', 'employee', 'EMP007', 'Employee@123');
    assert.equal((await get(`/api/admin/students/${studentId}/overview`, principal)).status, 200);
  });

  it('matches what the fee ledger says', async () => {
    const o = (await get(`/api/admin/students/${studentId}/overview`, admin)).body.fees;
    const ledger = (await get(`/api/admin/fees/students/${studentId}`, admin)).body.summary;
    assert.equal(o.outstanding, ledger.outstanding);
  });

  it('is not found for another institute\'s student, and closed to staff without the students area and to students', async () => {
    assert.equal((await get(`/api/admin/students/${schoolStudentId}/overview`, admin)).status, 404);
    assert.equal((await get(`/api/admin/students/${studentId}/overview`, schoolAdmin)).status, 404);
    assert.equal((await get(`/api/admin/students/${studentId}/overview`, accountant)).status, 403);
    assert.equal((await get(`/api/admin/students/${studentId}/overview`, student)).status, 403);
  });
});

/** Dashboards (Phase 1) - run with `npm test` (needs `npm run db:setup` first). */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { env } from '../src/config/env.js';
import { createApp } from '../src/app.js';
import { closePool } from '../src/db/pool.js';
import { issueCaptchaToken } from '../src/services/captcha.service.js';

let server; let base;
const get = async (path, cookie) => {
  const r = await fetch(`${base}${path}`, { headers: { cookie } });
  let b = null; try { b = await r.json(); } catch { /* empty */ }
  return { status: r.status, body: b };
};
async function login(tenantCode, role, identifier, password) {
  const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tenantCode, role, identifier, password, captchaToken: issueCaptchaToken() }) });
  assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
  return r.headers.getSetCookie().map((c) => c.split(';')[0]).find((c) => c.startsWith(`${env.COOKIE_NAME}=`));
}

let admin; let student; let otherAdmin;
before(async () => {
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  admin = await login('demo-college', 'admin', 'ADM001', 'Admin@123');
  otherAdmin = await login('demo-school', 'admin', 'ADM001', 'Admin@123');
  student = await login('demo-college', 'student', 'STU2026001', 'Student@123');
});
after(async () => {
  await new Promise((r) => server.close(r));
  await closePool();
});

describe('admin dashboard', () => {
  it('returns today\'s work figures as numbers', async () => {
    const { status, body } = await get('/api/admin/dashboard', admin);
    assert.equal(status, 200);
    const t = body.today;
    for (const k of ['applicationsToReview', 'applicationsToEnrol', 'feesThisMonth', 'feesOutstanding', 'lecturesToday', 'lecturesMarked', 'lecturesNotMarked']) {
      assert.equal(typeof t[k], 'number', k);
      assert.ok(t[k] >= 0, k);
    }
    assert.ok(t.attendancePercent === null || (t.attendancePercent >= 0 && t.attendancePercent <= 100));
    assert.ok(Array.isArray(body.recentApplications));
    assert.ok(body.recentApplications.length <= 5);
    assert.equal(typeof body.stats.totalStudents, 'number');
  });

  it('only counts its own institute (another institute gets its own figures)', async () => {
    const a = (await get('/api/admin/dashboard', admin)).body;
    const b = (await get('/api/admin/dashboard', otherAdmin)).body;
    assert.notEqual(a.institute.name, b.institute.name);
    for (const app of b.recentApplications) assert.ok(!a.recentApplications.some((x) => x.id === app.id));
  });

  it('is closed to students', async () => {
    assert.equal((await get('/api/admin/dashboard', student)).status, 403);
  });
});

describe('student dashboard', () => {
  it('includes the fee balance and the latest result card data', async () => {
    const { status, body } = await get('/api/student/dashboard', student);
    assert.equal(status, 200);
    assert.equal(typeof body.fees.outstanding, 'number');
    assert.ok(body.fees.outstanding >= 0);
    if (body.fees.outstanding > 0) assert.ok(body.fees.next.label);
    assert.ok(body.latestResult === null || typeof body.latestResult.name === 'string');
    assert.ok(Array.isArray(body.attendance));
  });
});

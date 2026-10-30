/** The platform owner's dashboard (Day 12E): counts only, reconciled, and a flag with a reason for each institute. */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { env } from '../src/config/env.js';
import { createApp } from '../src/app.js';
import { closePool } from '../src/db/pool.js';
import { issueCaptchaToken } from '../src/services/captcha.service.js';
import { checkDue, healthOf } from '../src/services/platformDashboard.service.js';

let server; let base; let sa; let admin; let d; let o;
const get = async (path, cookie) => {
  const r = await fetch(`${base}${path}`, { headers: cookie ? { cookie } : {} });
  let b = null; try { b = await r.json(); } catch { /* empty */ }
  return { status: r.status, body: b };
};
async function login(tenantCode, role, identifier, password) {
  const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tenantCode, role, identifier, password, captchaToken: issueCaptchaToken() }) });
  assert.equal(r.status, 200);
  return r.headers.getSetCookie().map((c) => c.split(';')[0]).find((c) => c.startsWith(`${env.COOKIE_NAME}=`));
}
before(async () => {
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  sa = await login('', 'super_admin', 'SA001', 'SuperAdmin@123');
  admin = await login('demo-college', 'admin', 'ADM001', 'Admin@123');
  const r = await get('/api/super-admin/dashboard/overview?fresh=1', sa);
  assert.equal(r.status, 200);
  d = r.body; o = d.overview;
});
after(async () => {
  await new Promise((r) => server.close(r));
  await closePool();
});

describe('Platform figures reconcile', () => {
  it('institutes, students and employees equal the Institutes page', async () => {
    const list = (await get('/api/super-admin/tenants', sa)).body.tenants;
    assert.equal(o.totals.institutes, list.length);
    assert.equal(o.totals.students, list.reduce((a, t) => a + t.students, 0));
    assert.equal(o.totals.employees, list.reduce((a, t) => a + t.employees, 0));
    for (const t of list) {
      const row = o.institutes.find((i) => i.id === t.id);
      assert.equal(row.students, t.students);
      assert.deepEqual(row.setup?.done, t.setup?.done);
    }
    assert.equal(o.totals.byType.reduce((a, x) => a + x.count, 0), list.length);
  });
  it('demo requests equal the Demo requests page', async () => {
    const r = (await get('/api/super-admin/demo-requests', sa)).body;
    assert.equal(o.demoRequests.new, r.newCount);
    assert.equal(o.demoRequests.new + o.demoRequests.contacted + o.demoRequests.closed, r.requests.length);
  });
  it('new institutes over 12 months never count more than exist', () => {
    assert.equal(o.newByMonth.length, 12);
    assert.ok(o.newByMonth.reduce((a, m) => a + m.count, 0) <= o.totals.institutes);
  });
  it('carries counts only: no student or employee record reaches the platform page', () => {
    const text = JSON.stringify(o);
    for (const needle of ['Aarav', 'Sharma', 'guardian', 'student.horizon.example']) assert.equal(text.includes(needle), false, needle);
  });
});

describe('Client health', () => {
  const base2 = { status: 'active', overdue: 0, quietDays: 1, setup: { done: 7, total: 7 }, age: 40, check: null, tokenShare: 0 };
  it('every institute has a flag and a reason', () => {
    for (const i of o.institutes) { assert.ok(['red', 'amber', 'green'].includes(i.flag)); assert.ok(i.reason.length > 3); }
    const order = o.institutes.map((i) => ({ red: 0, amber: 1, green: 2 }[i.flag]));
    assert.deepEqual(order, [...order].sort((a, b) => a - b), 'most urgent first');
  });
  it('green when active and nothing is waiting', () => assert.equal(healthOf(base2).flag, 'green'));
  it('a new institute nobody has opened is not called active', () => {
    const h = healthOf({ ...base2, quietDays: null, age: 2 });
    assert.equal(h.flag, 'green');
    assert.match(h.reason, /nobody has signed in yet/);
  });
  it('red when suspended, overdue or silent for two weeks, and it says why', () => {
    assert.match(healthOf({ ...base2, status: 'suspended' }).reason, /Suspended/);
    assert.equal(healthOf({ ...base2, overdue: 500 }).flag, 'red');
    assert.match(healthOf({ ...base2, quietDays: 20 }).reason, /No activity for 20 days/);
    assert.equal(healthOf({ ...base2, quietDays: null, age: 30 }).flag, 'red');
  });
  it('amber when quiet for a week, stuck on setup, at a check-in or near the cap', () => {
    assert.equal(healthOf({ ...base2, quietDays: 8 }).flag, 'amber');
    assert.match(healthOf({ ...base2, setup: { done: 2, total: 7 } }).reason, /stuck at 2 of 7/);
    assert.match(healthOf({ ...base2, check: 30 }).reason, /30-day check/);
    assert.equal(healthOf({ ...base2, tokenShare: 0.9 }).flag, 'amber');
    assert.equal(healthOf({ ...base2, setup: { done: 2, total: 7 }, age: 3 }).flag, 'green', 'a new institute is not stuck yet');
  });
  it('check-ins fall due at 30, 60 and 90 days for one week', () => {
    assert.equal(checkDue(29), null); assert.equal(checkDue(30), 30); assert.equal(checkDue(36), 30); assert.equal(checkDue(37), null);
    assert.equal(checkDue(60), 60); assert.equal(checkDue(90), 90);
  });
});

describe('Who sees it', () => {
  it('only the platform owner', async () => {
    assert.equal((await get('/api/super-admin/dashboard/overview', admin)).status, 403);
    assert.equal((await get('/api/super-admin/dashboard/overview')).status, 401);
  });
});

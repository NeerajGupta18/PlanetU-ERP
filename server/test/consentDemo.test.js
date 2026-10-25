/** Day 6A: parent consent at first sign-in, and "Book a demo" requests from the public page. Needs `npm run db:setup` first. */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { env } from '../src/config/env.js';
import { createApp } from '../src/app.js';
import { closePool, q, withTx } from '../src/db/pool.js';
import { issueCaptchaToken } from '../src/services/captcha.service.js';

let server; let base; let tenantId; let parent; let admin; let student; let sa; let parentId;
const TAG = 'DemoReqTest';

const json = async (method, path, { cookie, body, headers = {} } = {}) => {
  const r = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', ...headers, ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let b = null; try { b = await r.json(); } catch { /* empty */ }
  return { status: r.status, body: b };
};
async function login(tenantCode, role, identifier, password) {
  const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tenantCode, role, identifier, password, captchaToken: issueCaptchaToken() }) });
  assert.equal(r.status, 200);
  return { cookie: r.headers.getSetCookie().map((c) => c.split(';')[0]).find((c) => c.startsWith(`${env.COOKIE_NAME}=`)), body: await r.json() };
}
const clearConsent = () => withTx({ tenantId }, () => q('delete from user_consents where user_id = $1', [parentId]));
const clearDemo = () => withTx({ platform: true }, () => q('delete from demo_requests where name like $1', [`${TAG}%`]));
const goodDemo = (over = {}) => ({
  name: `${TAG} Asha Rao`, institute: 'Sunrise College', instituteType: 'college', phone: '+91 98765 43210', email: 'asha@sunrise.edu', city: 'Pune', students: '1200', ...over,
});

before(async () => {
  process.env.DEMO_REQUEST_LIMIT = '1000';
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  tenantId = (await withTx({ platform: true }, () => q("select id from tenants where code = 'demo-college'"))).rows[0].id;
  parentId = (await withTx({ tenantId }, () => q("select id from users where role = 'parent' and login_id = 'PAR001'"))).rows[0].id;
  await clearConsent();
  await clearDemo();
  admin = (await login('demo-college', 'admin', 'ADM001', 'Admin@123')).cookie;
  student = (await login('demo-college', 'student', 'STU2026001', 'Student@123')).cookie;
  sa = (await login('', 'super_admin', 'SA001', 'SuperAdmin@123')).cookie;
});
after(async () => {
  await clearConsent();
  await clearDemo();
  delete process.env.DEMO_REQUEST_LIMIT;
  await new Promise((r) => server.close(r));
  await closePool();
});

describe('Parent consent at first sign-in', () => {
  it('a parent who has not agreed is told so at sign-in; staff and students never are', async () => {
    const p = await login('demo-college', 'parent', 'PAR001', 'Parent@123');
    parent = p.cookie;
    assert.equal(p.body.consentNeeded, true);
    assert.equal((await json('GET', '/api/auth/me', { cookie: admin })).body.consentNeeded, false);
    assert.equal((await json('GET', '/api/auth/me', { cookie: student })).body.consentNeeded, false);
  });

  it('shows each purpose with what it covers, none answered yet', async () => {
    const r = await json('GET', '/api/me/consent', { cookie: parent });
    assert.equal(r.status, 200);
    assert.equal(r.body.needed, true);
    assert.deepEqual(r.body.purposes.map((p) => [p.key, p.required, p.granted]), [['records', true, null], ['messages', false, null]]);
    assert.ok(r.body.purposes.every((p) => p.label && p.detail));
  });

  it('refuses without the required purpose, and says what to tick', async () => {
    const r = await json('POST', '/api/me/consent', { cookie: parent, body: { answers: { records: false, messages: true } } });
    assert.equal(r.status, 400);
    assert.match(r.body.message, /Tick "Keep my child's study records"/);
    assert.equal((await withTx({ tenantId }, () => q('select count(*)::int as n from user_consents where user_id = $1', [parentId]))).rows[0].n, 0);
  });

  it('records each purpose with its answer, time and wording version, and the screen is no longer needed', async () => {
    const r = await json('POST', '/api/me/consent', { cookie: parent, body: { answers: { records: true, messages: false } }, headers: { 'user-agent': 'ConsentTest/1.0' } });
    assert.equal(r.status, 201);
    assert.equal(r.body.needed, false);
    const { rows } = await withTx({ tenantId }, () => q('select purpose, granted, version, user_agent, recorded_at from user_consents where user_id = $1 order by purpose', [parentId]));
    assert.deepEqual(rows.map((x) => [x.purpose, x.granted, x.version]), [['messages', false, 'v1'], ['records', true, 'v1']]);
    assert.ok(rows.every((x) => x.recorded_at instanceof Date && x.user_agent === 'ConsentTest/1.0'));
    assert.equal((await json('GET', '/api/auth/me', { cookie: parent })).body.consentNeeded, false);
    const audit = await withTx({ tenantId }, () => q("select meta from audit_log where action = 'consent.recorded' and actor_id = $1 order by at desc limit 1", [parentId]));
    assert.deepEqual(audit.rows[0].meta, { version: 'v1', records: true, messages: false });
  });

  it('the office sees when each parent agreed', async () => {
    const sid = (await withTx({ tenantId }, () => q("select student_id from parent_links where user_id = $1 limit 1", [parentId]))).rows[0].student_id;
    const r = await json('GET', `/api/admin/students/${sid}/parents`, { cookie: admin });
    assert.equal(r.status, 200);
    assert.ok(r.body.parents.find((p) => p.userId === parentId).consentAt);
  });

  it('consent rows stay inside their institute', async () => {
    const other = (await withTx({ platform: true }, () => q("select id from tenants where code = 'demo-school'"))).rows[0].id;
    const seen = await withTx({ tenantId: other }, () => q('select count(*)::int as n from user_consents where user_id = $1', [parentId]));
    assert.equal(seen.rows[0].n, 0);
  });
});

describe('Book a demo (public landing page)', () => {
  it('saves a complete request without signing in', async () => {
    const r = await json('POST', '/api/site/demo-requests', { body: goodDemo() });
    assert.equal(r.status, 201);
    const { rows } = await withTx({ platform: true }, () => q('select institute, institute_type, status from demo_requests where name like $1', [`${TAG}%`]));
    assert.deepEqual(rows, [{ institute: 'Sunrise College', institute_type: 'college', status: 'new' }]);
  });

  it('explains how to fix each bad field', async () => {
    const bad = async (over) => (await json('POST', '/api/site/demo-requests', { body: goodDemo(over) }));
    let r = await bad({ name: '' }); assert.equal(r.status, 400); assert.match(r.body.message, /Enter your name/);
    r = await bad({ email: 'nope' }); assert.equal(r.status, 400); assert.match(r.body.message, /email address like/);
    r = await bad({ phone: 'call me' }); assert.equal(r.status, 400); assert.match(r.body.message, /phone number/);
    r = await bad({ instituteType: 'mall' }); assert.equal(r.status, 400); assert.match(r.body.message, /kind of institute/);
  });

  it('quietly ignores bots that fill the hidden field', async () => {
    const r = await json('POST', '/api/site/demo-requests', { body: goodDemo({ name: `${TAG} Bot`, website: 'http://spam' }) });
    assert.equal(r.status, 201);
    assert.equal((await withTx({ platform: true }, () => q('select count(*)::int as n from demo_requests where name = $1', [`${TAG} Bot`]))).rows[0].n, 0);
  });

  it('only the vendor can list and update them; an institute cannot see them', async () => {
    assert.equal((await json('GET', '/api/super-admin/demo-requests', { cookie: admin })).status, 403);
    const r = await json('GET', '/api/super-admin/demo-requests', { cookie: sa });
    assert.equal(r.status, 200);
    const mine = r.body.requests.find((x) => x.name.startsWith(TAG));
    assert.ok(mine && r.body.newCount >= 1);
    const u = await json('PUT', `/api/super-admin/demo-requests/${mine.id}`, { cookie: sa, body: { status: 'contacted' } });
    assert.deepEqual(u.body, { id: mine.id, status: 'contacted' });
    assert.equal((await json('PUT', `/api/super-admin/demo-requests/${mine.id}`, { cookie: sa, body: { status: 'won' } })).status, 400);
    const seen = await withTx({ tenantId }, () => q('select count(*)::int as n from demo_requests'));
    assert.equal(seen.rows[0].n, 0, 'row level security hides them from institutes');
  });
});

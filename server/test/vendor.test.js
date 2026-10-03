/** Creating the platform-owner account on a real deployment - run with `npm test` (needs `npm run db:setup` first). */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { env } from '../src/config/env.js';
import { createApp } from '../src/app.js';
import { closePool, q, withTx } from '../src/db/pool.js';
import { bootstrapVendorFromEnv, createVendor, passwordProblem } from '../src/db/vendor.js';
import { issueCaptchaToken } from '../src/services/captcha.service.js';

let server; let base;
const LOGIN = 'boot-owner-test';
const STRONG = 'Correct-Horse-Battery-9';
const login = (password, identifier = LOGIN) => fetch(`${base}/api/auth/login`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ role: 'super_admin', identifier, password, captchaToken: issueCaptchaToken() }),
});

before(async () => { server = createApp().listen(0); base = `http://127.0.0.1:${server.address().port}`; });
after(async () => {
  try { await withTx({ platform: true }, () => q("delete from users where role = 'super_admin' and lower(login_id) = $1", [LOGIN])); } finally {
    await new Promise((r) => server.close(r)); await closePool();
  }
});

describe('Vendor account bootstrap', () => {
  it('refuses weak and published passwords', () => {
    for (const bad of ['short1A', 'alllowercase1234', 'ALLUPPERCASE1234', 'NoDigitsHereAtAll', 'SuperAdmin@123', 'Admin@123', `xx${LOGIN}Aa1xx`]) {
      assert.ok(passwordProblem(bad, LOGIN), `should refuse ${bad}`);
    }
    assert.equal(passwordProblem(STRONG, LOGIN), null);
    assert.ok(passwordProblem('x'.repeat(200) + 'Aa1'));
  });

  it('refuses a bad login, the demo login SA001, and a bad email', async () => {
    await assert.rejects(createVendor({ login: 'a', email: 'a@b.co', password: STRONG }), /Login must be/);
    await assert.rejects(createVendor({ login: 'SA001', email: 'a@b.co', password: STRONG }), /demo account name/);
    await assert.rejects(createVendor({ login: 'sa001', email: 'a@b.co', password: STRONG }), /demo account name/);
    await assert.rejects(createVendor({ login: LOGIN, email: 'not-an-email', password: STRONG }), /valid email/);
    await assert.rejects(createVendor({ login: LOGIN, email: 'a@b.co', password: 'weak' }), /Password too weak/);
  });

  it('creates an account that can sign in, stores only a hash, and the published password does not work for it', async () => {
    const r = await createVendor({ login: LOGIN, name: 'Boot Owner', email: 'owner@bootstrap.example', password: STRONG });
    assert.deepEqual(r, { created: true, login: LOGIN });
    const ok = await login(STRONG);
    assert.equal(ok.status, 200, JSON.stringify(await ok.clone().json()));
    assert.equal((await ok.json()).user.role, 'super_admin');
    assert.equal((await login('SuperAdmin@123')).status, 401);
    const { rows: [row] } = await withTx({ platform: true }, () => q("select password_hash from users where role = 'super_admin' and lower(login_id) = $1", [LOGIN]));
    assert.match(row.password_hash, /^\$2[aby]\$12\$/, 'bcrypt, cost 12');
    assert.ok(!row.password_hash.includes(STRONG));
  });

  it('will not overwrite an existing account unless asked to reset it', async () => {
    await assert.rejects(createVendor({ login: LOGIN.toUpperCase(), email: 'x@y.co', password: 'Another-Strong-Pass-1' }), /already exists/);
    assert.equal((await login(STRONG)).status, 200, 'the old password still works');
    const r = await createVendor({ login: LOGIN, email: 'owner@bootstrap.example', password: 'Another-Strong-Pass-1', reset: true });
    assert.equal(r.created, false);
    assert.equal((await login(STRONG)).status, 401);
    assert.equal((await login('Another-Strong-Pass-1')).status, 200);
  });

  it('the mail poll interval is clamped to a sensible range', () => {
    assert.ok(env.MAIL_POLL_SECONDS >= 5 && env.MAIL_POLL_SECONDS <= 3600);
  });
});

describe('Owner account created from the host\'s settings (hosts with no shell)', () => {
  const B = 'boot-env-test';
  const src = (o = {}) => ({ VENDOR_LOGIN: B, VENDOR_EMAIL: 'env@bootstrap.example', VENDOR_PASSWORD: 'Quiet-River-Stone-5521', ...o });
  const logs = []; const log = (m) => logs.push(m);
  const exists = async () => (await withTx({ platform: true }, () => q("select count(*)::int as n from users where role = 'super_admin' and lower(login_id) = $1", [B]))).rows[0].n;
  after(() => withTx({ platform: true }, () => q("delete from users where role = 'super_admin' and lower(login_id) = $1", [B])));

  it('does nothing when no settings are given, and says so when they are incomplete', async () => {
    assert.deepEqual(await bootstrapVendorFromEnv({ log, source: {} }), { action: 'none' });
    assert.equal((await bootstrapVendorFromEnv({ log, source: { VENDOR_LOGIN: B } })).action, 'incomplete');
    assert.equal(await exists(), 0);
  });

  it('refuses a weak password or the demo login, and creates nothing', async () => {
    const weak = await bootstrapVendorFromEnv({ log, source: src({ VENDOR_PASSWORD: 'password123' }) });
    assert.equal(weak.action, 'refused'); assert.match(weak.reason, /too weak/);
    // The demo login can never be created or have its password changed through these settings
    assert.equal((await bootstrapVendorFromEnv({ log, source: src({ VENDOR_LOGIN: 'SA001', VENDOR_RESET: 'true' }) })).action, 'refused');
    assert.equal((await login('SuperAdmin@123', 'SA001')).status, 200, 'the demo account was not touched');
    assert.equal(await exists(), 0);
  });

  it('creates the account once; the password can then sign in', async () => {
    assert.equal((await bootstrapVendorFromEnv({ log, source: src() })).action, 'created');
    assert.equal(await exists(), 1);
    const r = await login('Quiet-River-Stone-5521', B);
    assert.equal(r.status, 200);
  });

  it('on later starts it leaves the account alone, even if the setting changed', async () => {
    const r = await bootstrapVendorFromEnv({ log, source: src({ VENDOR_PASSWORD: 'Different-Strong-Pass-77' }) });
    assert.equal(r.action, 'exists');
    assert.equal((await login('Quiet-River-Stone-5521', B)).status, 200, 'the original password still works');
    assert.equal((await login('Different-Strong-Pass-77', B)).status, 401);
  });

  it('stays silent once the account exists, even after VENDOR_PASSWORD has been removed from the settings', async () => {
    const before = logs.length;
    const r = await bootstrapVendorFromEnv({ log, source: { VENDOR_LOGIN: B, VENDOR_EMAIL: 'env@bootstrap.example' } });
    assert.equal(r.action, 'exists');
    assert.equal(logs.length, before, 'no warning is printed on every start');
  });

  it('changes the password only when VENDOR_RESET=true is set deliberately', async () => {
    const r = await bootstrapVendorFromEnv({ log, source: src({ VENDOR_PASSWORD: 'Different-Strong-Pass-77', VENDOR_RESET: 'true' }) });
    assert.equal(r.action, 'reset');
    assert.equal((await login('Different-Strong-Pass-77', B)).status, 200);
    assert.equal((await login('Quiet-River-Stone-5521', B)).status, 401);
  });

  it('never prints the password in the log', () => {
    assert.ok(!logs.join('\n').includes('Quiet-River-Stone-5521') && !logs.join('\n').includes('Different-Strong-Pass-77'));
  });
});

describe('Network diagnostics (vendor only)', () => {
  const D = 'diag-owner-test';
  before(async () => { await createVendor({ login: D, email: 'd@x.example', password: 'Granite-Pillar-Window-3380', reset: true }); });
  after(() => withTx({ platform: true }, () => q("delete from users where role = 'super_admin' and lower(login_id) = $1", [D])));
  const cookieOf = async () => { const r = await login('Granite-Pillar-Window-3380', D); return r.headers.getSetCookie().map((c) => c.split(';')[0]).find((c) => c.startsWith(`${env.COOKIE_NAME}=`)); };

  it('shows the vendor which address the app believes they are connecting from', async () => {
    const cookie = await cookieOf();
    const r = await fetch(`${base}/api/super-admin/diagnostics/network`, { headers: { cookie, 'x-forwarded-for': '203.0.113.7' } });
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.equal(j.ip, '203.0.113.7', 'with one trusted proxy hop the forwarded address is used');
    assert.equal(j.trustProxyHops, env.TRUST_PROXY_HOPS);
  });

  it('a forged address cannot be injected by the visitor beyond the trusted hops', async () => {
    const cookie = await cookieOf();
    const j = await (await fetch(`${base}/api/super-admin/diagnostics/network`, { headers: { cookie, 'x-forwarded-for': '198.51.100.9, 203.0.113.7' } })).json();
    assert.equal(j.ip, '203.0.113.7', 'only the right-most (proxy-added) entry is trusted');
  });

  it('is closed to everyone else', async () => {
    assert.equal((await fetch(`${base}/api/super-admin/diagnostics/network`)).status, 401);
    const admin = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tenantCode: 'demo-college', role: 'admin', identifier: 'ADM001', password: 'Admin@123', captchaToken: issueCaptchaToken() }) });
    const c = admin.headers.getSetCookie().map((x) => x.split(';')[0]).find((x) => x.startsWith(`${env.COOKIE_NAME}=`));
    assert.equal((await fetch(`${base}/api/super-admin/diagnostics/network`, { headers: { cookie: c } })).status, 403);
  });
});


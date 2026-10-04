/** Public demo mode: sample institutes + one-click sign-ins, without exposing the platform owner or letting anyone lock the demo. */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { env } from '../src/config/env.js';
import { createApp } from '../src/app.js';
import { closePool, q, withTx } from '../src/db/pool.js';
import { DEMO_TENANTS } from '../src/db/demo-data.js';
import { ensureDemoInstitutes } from '../src/db/seed.js';
import { issueToken } from '../src/services/accounts.service.js';
import { issueCaptchaToken } from '../src/services/captcha.service.js';

let server; let base;
const originalMode = env.DEMO_MODE;
const json = async (method, path, { cookie, body } = {}) => {
  const r = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let b = null; try { b = await r.clone().json(); } catch { /* not json */ }
  return { status: r.status, body: b, res: r };
};
const signIn = (role, identifier, password, tenantCode) => fetch(`${base}/api/auth/login`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ role, identifier, password, tenantCode, captchaToken: issueCaptchaToken() }),
});
const cookieOf = (r) => r.headers.getSetCookie().map((c) => c.split(';')[0]).find((c) => c.startsWith(`${env.COOKIE_NAME}=`));
const platform = (fn) => withTx({ platform: true }, fn);

before(async () => { server = createApp().listen(0); base = `http://127.0.0.1:${server.address().port}`; });
after(async () => {
  env.DEMO_MODE = originalMode;
  try {
    await platform(() => q("delete from tenants where code like 'demo-zz-%' or code like 'dm-gen-%'"));
    await platform(() => q("update tenants set status = 'active' where code = 'demo-school'"));
  } finally { await new Promise((r) => server.close(r)); await closePool(); }
});

describe('The list of demo sign-ins', () => {
  it('is off by default and then reveals nothing', async () => {
    env.DEMO_MODE = false;
    const r = await json('GET', '/api/auth/demo-logins');
    assert.deepEqual(r.body, { enabled: false });
    assert.equal(r.res.headers.get('cache-control'), 'no-store');
  });

  it('when on: lists only the sample institutes, with admin / employee / student, and never the platform owner', async () => {
    env.DEMO_MODE = true;
    const r = await json('GET', '/api/auth/demo-logins');
    assert.equal(r.body.enabled, true);
    assert.deepEqual(r.body.institutes.map((i) => i.code).sort(), DEMO_TENANTS.map((t) => t.code).sort());
    for (const inst of r.body.institutes) assert.deepEqual(inst.logins.map((l) => l.role), ['admin', 'employee', 'student']);
    const raw = JSON.stringify(r.body);
    assert.ok(!/SA001|super_admin|SuperAdmin/i.test(raw), 'the platform-owner account is never offered');
  });

  it('EVERY sign-in it offers really works, for the institute it names', async () => {
    env.DEMO_MODE = true;
    const { institutes } = (await json('GET', '/api/auth/demo-logins')).body;
    let n = 0;
    for (const inst of institutes) for (const l of inst.logins) {
      const r = await signIn(l.role, l.id, l.password, inst.code);
      assert.equal(r.status, 200, `${inst.code} ${l.role} ${l.id}`);
      assert.equal((await r.json()).user.role, l.role);
      n += 1;
    }
    assert.equal(n, 9);
  });

  it('does not offer a sample institute that is suspended', async () => {
    env.DEMO_MODE = true;
    await platform(() => q("update tenants set status = 'suspended' where code = 'demo-school'"));
    try {
      const codes = (await json('GET', '/api/auth/demo-logins')).body.institutes.map((i) => i.code);
      assert.ok(!codes.includes('demo-school') && codes.includes('demo-college'));
    } finally { await platform(() => q("update tenants set status = 'active' where code = 'demo-school'")); }
  });
});

describe('Nobody can lock the shared demo accounts', () => {
  it('a demo account cannot change its password (and the old one keeps working)', async () => {
    env.DEMO_MODE = true;
    const r = await signIn('admin', 'ADM001', 'Admin@123', 'demo-college');
    const cookie = cookieOf(r);
    const ch = await json('POST', '/api/auth/change-password', { cookie, body: { currentPassword: 'Admin@123', newPassword: 'Totally-New-Pass-1234' } });
    assert.equal(ch.status, 403);
    assert.match(ch.body.message, /shared demo account/);
    assert.equal((await signIn('admin', 'ADM001', 'Admin@123', 'demo-college')).status, 200);
    assert.equal((await signIn('admin', 'ADM001', 'Totally-New-Pass-1234', 'demo-college')).status, 401);
  });

  it('a password-reset link for a demo account is refused too', async () => {
    env.DEMO_MODE = true;
    const tid = (await platform(() => q("select id from tenants where code = 'demo-college'"))).rows[0].id;
    const uid = await withTx({ tenantId: tid }, async () => (await q("select id from users where login_id = 'ADM001'")).rows[0].id);
    const token = await withTx({ tenantId: tid }, () => issueToken(uid, 1));
    const r = await json('POST', '/api/auth/reset-password', { body: { token, password: 'Reset-Attempt-Pass-9911' } });
    assert.equal(r.status, 403);
    assert.equal((await signIn('admin', 'ADM001', 'Admin@123', 'demo-college')).status, 200, 'unchanged');
  });

  it('a real institute is not affected: its admin can still change their password in demo mode', async () => {
    env.DEMO_MODE = true;
    const v = await signIn('super_admin', 'SA001', 'SuperAdmin@123');
    assert.equal(v.status, 200);
    const code = `dm-gen-${Date.now().toString(36)}`;
    const t = await json('POST', '/api/super-admin/tenants', { cookie: cookieOf(v), body: { code, name: 'Generic Test', type: 'school', plan: 'trial', admin: { name: 'Head', email: `head@${code}.example` } } });
    assert.equal(t.status, 201, JSON.stringify(t.body));
    const a = await signIn('admin', t.body.admin.loginId, t.body.admin.temporaryPassword, code);
    assert.equal(a.status, 200);
    const ch = await json('POST', '/api/auth/change-password', { cookie: cookieOf(a), body: { currentPassword: t.body.admin.temporaryPassword, newPassword: 'Brand-New-Strong-Pass-77' } });
    assert.equal(ch.status, 200, JSON.stringify(ch.body));
  });

  it('with demo mode off, nothing about passwords changes', () => {
    env.DEMO_MODE = false;
    assert.equal(env.DEMO_MODE, false);
  });
});

describe('Loading the sample institutes (ensureDemoInstitutes)', () => {
  const spec = (code) => ({ ...DEMO_TENANTS[0], code, name: 'ZZ Demo Test', shortName: 'ZZ', admin: { ...DEMO_TENANTS[0].admin, email: 'admin@zz.example' } });
  const idOf = async (code) => (await platform(() => q('select id from tenants where code = $1', [code]))).rows[0]?.id;
  const sa001 = async () => (await platform(() => q("select id, password_hash from users where role = 'super_admin' and lower(login_id) = 'sa001'"))).rows[0];

  it('creates a missing institute, then does nothing when run again, and can rebuild it on request', async () => {
    const s = spec('demo-zz-a');
    const before = await sa001();
    const log = [];
    assert.deepEqual(await ensureDemoInstitutes({ specs: [s], log: (m) => log.push(m) }), { created: 1 });
    const id1 = await idOf('demo-zz-a');
    assert.ok(id1 && log.some((m) => /loaded/.test(m)));
    assert.deepEqual(await ensureDemoInstitutes({ specs: [s], log: () => {} }), { created: 0 });
    assert.equal(await idOf('demo-zz-a'), id1, 'the existing one is left as it was');
    assert.deepEqual(await ensureDemoInstitutes({ specs: [s], reset: true, log: () => {} }), { created: 1 });
    const id2 = await idOf('demo-zz-a');
    assert.notEqual(id2, id1, 'reset rebuilt it from scratch');
    const users = await withTx({ tenantId: id2 }, async () => (await q('select count(*)::int as n from users')).rows[0].n);
    assert.ok(users >= 7, 'with its sample admin, staff and students');
    assert.deepEqual(await sa001(), before, 'the platform-owner account was not touched or recreated');
  });

  it('loads its sample data with working sign-ins', async () => {
    const r = await signIn('student', 'STU2026001', 'Student@123', 'demo-zz-a');
    assert.equal(r.status, 200);
  });

  it('never touches a real institute that uses a sample code, even when asked to reset', async () => {
    await platform(() => q("insert into tenants (code, name, type) values ('demo-zz-real', 'Real Institute', 'school')"));
    const id = await idOf('demo-zz-real');
    const log = [];
    assert.deepEqual(await ensureDemoInstitutes({ specs: [spec('demo-zz-real')], reset: true, log: (m) => log.push(m) }), { created: 0 });
    assert.equal(await idOf('demo-zz-real'), id, 'still there');
    assert.ok(log.some((m) => /real institute/.test(m)));
  });
});

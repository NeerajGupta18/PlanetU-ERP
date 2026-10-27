/** Fingerprint sign-in on the Android app: trusted-device tokens - run with `npm test`. */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { env } from '../src/config/env.js';
import { createApp } from '../src/app.js';
import { closePool, q, withTx } from '../src/db/pool.js';
import { issueCaptchaToken } from '../src/services/captcha.service.js';

let server; let base;
const tenants = {};
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

const call = async (method, path, body, cookie) => {
  const r = await fetch(`${base}${path}`, {
    method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined,
  });
  let b = null; try { b = await r.json(); } catch { /* empty */ }
  return { status: r.status, body: b, cookie: r.headers.getSetCookie().map((c) => c.split(';')[0]).find((c) => c.startsWith(`${env.COOKIE_NAME}=`)) };
};
const login = (tenantCode, role, identifier, password) => call('POST', '/api/auth/login', { tenantCode, role, identifier, password, captchaToken: issueCaptchaToken() });
const deviceLogin = (tenantCode, token) => call('POST', '/api/auth/device-login', { tenantCode, token });
const asTenant = (code, sql, params) => withTx({ tenantId: tenants[code] }, () => q(sql, params));

const STUDENT = ['demo-college', 'student', 'STU2026002', 'Student@123'];
const ADMIN = ['demo-college', 'admin', 'ADM001', 'Admin@123'];

/** Signs in with the password and turns on fingerprint: returns the phone's token and the session cookie. */
async function trust(who = STUDENT, label = 'Test phone') {
  const s = await login(...who);
  assert.equal(s.status, 200, JSON.stringify(s.body));
  const d = await call('POST', '/api/auth/devices', { label }, s.cookie);
  assert.equal(d.status, 201, JSON.stringify(d.body));
  return { token: d.body.token, id: d.body.id, cookie: s.cookie };
}

async function heal() {
  const hash = bcrypt.hashSync('Student@123', 4);
  await asTenant('demo-college', "update users set password_hash = $1, must_change_password = false, status = 'active' where login_id = $2", [hash, STUDENT[2]]);
  for (const id of Object.values(tenants)) await withTx({ tenantId: id }, () => q("delete from trusted_devices where label like 'Test%'"));
}

before(async () => {
  process.env.DEVICE_LOGIN_LIMIT = '1000';
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  for (const r of (await withTx({ platform: true }, () => q("select id, code from tenants where code like 'demo-%'"))).rows) tenants[r.code] = r.id;
  await heal();
});
after(async () => {
  await heal();
  await new Promise((r) => server.close(r));
  await closePool();
});

describe('Trusted devices (fingerprint sign-in)', () => {
  it('issues a token after a password sign-in, and stores only its hash', async () => {
    const { token, id } = await trust();
    assert.match(token, /^pud_[A-Za-z0-9_-]{43}$/);
    const { rows: [row] } = await asTenant('demo-college', 'select * from trusted_devices where id = $1', [id]);
    assert.equal(row.token_hash, sha(token));
    assert.ok(!Object.values(row).some((v) => String(v).includes(token)), 'the raw token is not kept anywhere');
    const days = (new Date(row.expires_at) - new Date(row.created_at)) / 86400000;
    assert.ok(days > 29.9 && days < 30.1, `expires after 30 days (got ${days})`);
    const { rows: audits } = await asTenant('demo-college', "select 1 from audit_log where action = 'auth.device_trusted' and entity_id = $1", [id]);
    assert.equal(audits.length, 1);
  });

  it('signs in with a valid token, as the same person, and writes it to the audit log', async () => {
    const { token, id } = await trust();
    const r = await deviceLogin('demo-college', token);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.user.loginId, STUDENT[2]);
    assert.equal(r.body.tenant.code, 'demo-college');
    const me = await call('GET', '/api/auth/me', null, r.cookie);
    assert.equal(me.status, 200);
    assert.equal(me.body.user.loginId, STUDENT[2]);
    const { rows: [row] } = await asTenant('demo-college', 'select last_used_at from trusted_devices where id = $1', [id]);
    assert.ok(row.last_used_at);
    const { rows: audits } = await asTenant('demo-college', "select 1 from audit_log where action = 'auth.device_login' and entity_id = $1", [id]);
    assert.equal(audits.length, 1);
  });

  it('a fingerprint session cannot issue another token (30 days cannot stretch itself)', async () => {
    const { token } = await trust();
    const r = await deviceLogin('demo-college', token);
    const again = await call('POST', '/api/auth/devices', { label: 'Test again' }, r.cookie);
    assert.equal(again.status, 403);
  });

  it('refuses an expired token and asks for the password', async () => {
    const { token, id } = await trust();
    await asTenant('demo-college', "update trusted_devices set expires_at = now() - interval '1 minute' where id = $1", [id]);
    const r = await deviceLogin('demo-college', token);
    assert.equal(r.status, 401);
    assert.equal(r.body.code, 'DEVICE_EXPIRED');
    assert.equal(r.cookie, undefined);
    const { rows: audits } = await asTenant('demo-college', "select meta from audit_log where action = 'auth.device_login_failed' and entity_id = $1", [id]);
    assert.equal(audits[0].meta.reason, 'expired');
  });

  it('refuses a revoked token: forget this device, the user removing it, and an admin removing it', async () => {
    const a = await trust(STUDENT, 'Test forget');
    assert.equal((await call('POST', '/api/auth/devices/forget', { tenantCode: 'demo-college', token: a.token })).status, 200);
    assert.equal((await deviceLogin('demo-college', a.token)).body.code, 'DEVICE_INVALID');

    const b = await trust(STUDENT, 'Test mine');
    const mine = await call('GET', '/api/auth/devices', null, b.cookie);
    assert.ok(mine.body.devices.some((d) => d.id === b.id && d.label === 'Test mine'));
    assert.ok(!mine.body.devices.some((d) => d.id === a.id), 'a forgotten phone is no longer listed');
    assert.equal((await call('DELETE', `/api/auth/devices/${b.id}`, null, b.cookie)).status, 200);
    assert.equal((await deviceLogin('demo-college', b.token)).status, 401);

    const c = await trust(STUDENT, 'Test admin');
    const admin = await login(...ADMIN);
    const all = await call('GET', '/api/auth/devices/all', null, admin.cookie);
    assert.ok(all.body.devices.some((d) => d.id === c.id && d.loginId === STUDENT[2]));
    assert.equal((await call('GET', '/api/auth/devices/all', null, c.cookie)).status, 403, 'only the admin sees every phone');
    assert.equal((await call('DELETE', `/api/auth/devices/all/${c.id}`, null, admin.cookie)).status, 200);
    assert.equal((await deviceLogin('demo-college', c.token)).status, 401);
    const { rows: [row] } = await asTenant('demo-college', 'select revoked_reason from trusted_devices where id = $1', [c.id]);
    assert.equal(row.revoked_reason, 'removed_by_admin');
  });

  it('a person cannot remove someone else\'s phone', async () => {
    const adminPhone = await trust(ADMIN, 'Test admin phone');
    const student = await login(...STUDENT);
    assert.equal((await call('DELETE', `/api/auth/devices/${adminPhone.id}`, null, student.cookie)).status, 404);
    assert.equal((await deviceLogin('demo-college', adminPhone.token)).status, 200);
  });

  it('refuses another institute\'s token, even with a valid token', async () => {
    const { token } = await trust();
    const r = await deviceLogin('demo-school', token);
    assert.equal(r.status, 401);
    assert.equal(r.body.code, 'DEVICE_INVALID');
    assert.equal(r.cookie, undefined);
    // and the other institute cannot even see the row
    const { rows } = await asTenant('demo-school', 'select 1 from trusted_devices where token_hash = $1', [sha(token)]);
    assert.equal(rows.length, 0);
  });

  it('refuses unknown and malformed tokens', async () => {
    assert.equal((await deviceLogin('demo-college', `pud_${'A'.repeat(43)}`)).status, 401);
    assert.equal((await deviceLogin('demo-college', 'not-a-token')).status, 401);
    assert.equal((await deviceLogin('no-such-institute', `pud_${'A'.repeat(43)}`)).status, 401);
  });

  it('a password change ends fingerprint sign-in on every phone', async () => {
    const a = await trust(STUDENT, 'Test pw 1');
    const b = await trust(STUDENT, 'Test pw 2');
    const ch = await call('POST', '/api/auth/change-password', { currentPassword: 'Student@123', newPassword: 'Changed@12345' }, b.cookie);
    assert.equal(ch.status, 200, JSON.stringify(ch.body));
    assert.equal((await deviceLogin('demo-college', a.token)).status, 401);
    assert.equal((await deviceLogin('demo-college', b.token)).status, 401);
    await heal();
  });

  it('a switched-off account cannot sign in with its token', async () => {
    const { token, id } = await trust(STUDENT, 'Test off');
    await asTenant('demo-college', "update users set status = 'disabled' where login_id = $1", [STUDENT[2]]);
    assert.equal((await deviceLogin('demo-college', token)).status, 401);
    const { rows: [row] } = await asTenant('demo-college', 'select revoked_reason from trusted_devices where id = $1', [id]);
    assert.equal(row.revoked_reason, 'deactivated');
    await heal();
    assert.equal((await deviceLogin('demo-college', token)).status, 401, 'switching the account back on does not bring the token back');
  });

  it('keeps at most five phones per account', async () => {
    const first = await trust(STUDENT, 'Test cap 0');
    for (let i = 1; i <= 5; i += 1) await trust(STUDENT, `Test cap ${i}`);
    assert.equal((await deviceLogin('demo-college', first.token)).status, 401);
  });

  it('the vendor\'s owner account cannot turn on fingerprint', async () => {
    const s = await call('POST', '/api/auth/login', { role: 'super_admin', identifier: 'SA001', password: 'SuperAdmin@123', captchaToken: issueCaptchaToken() });
    assert.equal((await call('POST', '/api/auth/devices', { label: 'Test owner' }, s.cookie)).status, 400);
  });

  it('rate-limits fingerprint sign-in', async () => {
    const { token } = await trust(STUDENT, 'Test rate');
    process.env.DEVICE_LOGIN_LIMIT = '3';
    const codes = [];
    for (let i = 0; i < 4; i += 1) codes.push((await deviceLogin('demo-college', `pud_${'B'.repeat(43)}`)).status);
    assert.ok(codes.includes(429), `got ${codes}`);
    const blocked = await deviceLogin('demo-college', token);
    assert.equal(blocked.status, 429, 'even a valid token waits once the limit is hit');
    assert.equal(blocked.body.code, 'RATE_LIMITED');
    process.env.DEVICE_LOGIN_LIMIT = '1000';
  });
});

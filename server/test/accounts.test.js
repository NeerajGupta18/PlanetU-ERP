/** Password recovery, forced password change, notifications and applicant recovery - run with `npm test`. */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import bcrypt from 'bcryptjs';
import { SMTPServer } from 'smtp-server';
import { env } from '../src/config/env.js';
import { createApp } from '../src/app.js';
import { closePool, q, withTx } from '../src/db/pool.js';
import { processQueue } from '../src/services/notifications.service.js';
import { issueCaptchaToken } from '../src/services/captcha.service.js';

let server; let base; let smtp; let smtpPort;
const inbox = [];
const tenants = {};
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(100, 66)]);

const post = async (path, body, cookie) => {
  const r = await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
  let b = null; try { b = await r.json(); } catch { /* empty */ }
  return { status: r.status, body: b, cookie: r.headers.getSetCookie().map((c) => c.split(';')[0]).find((c) => c.startsWith(`${env.COOKIE_NAME}=`)) };
};
const get = async (path, cookie) => { const r = await fetch(`${base}${path}`, { headers: cookie ? { cookie } : {} }); let b = null; try { b = await r.json(); } catch { /* */ } return { status: r.status, body: b }; };
const login = (tenantCode, role, identifier, password) => post('/api/auth/login', { tenantCode, role, identifier, password, captchaToken: issueCaptchaToken() });
const forgot = (tenantCode, email) => post('/api/auth/forgot-password', { tenantCode, email, captchaToken: issueCaptchaToken() });
const mails = (code, to) => withTx({ tenantId: tenants[code] }, async () => (await q(
  'select template, subject, text_body, html_body, status, attempts from notifications where lower(to_email) = lower($1) order by created_at', [to])).rows);
const tokenIn = (text) => text.match(/token=([A-Za-z0-9_-]+)/)?.[1];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const STUDENT_EMAIL = 'aarav.sharma@student.horizon.example';

// The tests below change demo accounts' passwords/emails. Put them back regardless of how a previous run ended.
async function healDemoAccounts() {
  const hash = bcrypt.hashSync('Student@123', 4);
  await withTx({ tenantId: tenants['demo-college'] }, () => q(
    "update users set password_hash = $1, must_change_password = false, password_changed_at = now() where role = 'student'", [hash]));
  await withTx({ tenantId: tenants['demo-school'] }, () => q(
    "update users set password_hash = $1, email = 'ananya.k@student.greenfield.example', must_change_password = false, password_changed_at = now() where login_id = 'GPS2026001'", [hash]));
  await withTx({ platform: true }, () => q("update password_resets set used_at = now() where used_at is null"));
}

before(async () => {
  smtp = new SMTPServer({
    authOptional: true, disabledCommands: ['STARTTLS'],
    onData(stream, session, cb) {
      let raw = ''; stream.on('data', (c) => { raw += c; });
      stream.on('end', () => { inbox.push({ raw, to: session.envelope.rcptTo.map((r) => r.address) }); cb(); });
    },
  });
  await new Promise((r) => smtp.listen(0, '127.0.0.1', r));
  smtpPort = smtp.server.address().port;
  process.env.MAIL_TRANSPORT = 'smtp';
  process.env.SMTP_URL = `smtp://127.0.0.1:${smtpPort}`;
  process.env.PUBLIC_CREATE_LIMIT = '1000';
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  for (const r of (await withTx({ platform: true }, () => q("select id, code from tenants where code like 'demo-%'"))).rows) tenants[r.code] = r.id;
  await healDemoAccounts();
  await processQueue(); // start from an empty outbox
  inbox.length = 0;
});
after(async () => {
  await healDemoAccounts();
  await withTx({ platform: true }, () => q("delete from tenants where code like 'test-acc-%'"));
  await new Promise((r) => server.close(r));
  await new Promise((r) => smtp.close(r));
  await closePool();
});

describe('Mail delivery', () => {
  it('delivers queued mail over real SMTP, from the institute, exactly once even with two workers', async () => {
    await forgot('demo-college', STUDENT_EMAIL);
    const [a, b] = await Promise.all([processQueue(), processQueue()]);
    assert.equal(a.sent + b.sent, 1);
    assert.equal(inbox.length, 1);
    assert.deepEqual(inbox[0].to, [STUDENT_EMAIL]);
    assert.match(inbox[0].raw, /From: "?Horizon College of Technology"? <no-reply@planetu\.example>/);
    assert.match(inbox[0].raw, /Subject: Reset your password/);
    assert.equal((await mails('demo-college', STUDENT_EMAIL)).at(-1).status, 'sent');
  });

  it('retries a failed send with growing delays, then gives up', async () => {
    const good = process.env.SMTP_URL;
    process.env.SMTP_URL = 'smtp://127.0.0.1:1'; // nothing listens here
    await forgot('demo-college', 'simran.gill@student.horizon.example');
    await processQueue();
    let m = (await mails('demo-college', 'simran.gill@student.horizon.example')).at(-1);
    assert.equal(m.status, 'queued'); assert.equal(m.attempts, 1);
    await processQueue(); // not due yet -> not retried
    assert.equal((await mails('demo-college', 'simran.gill@student.horizon.example')).at(-1).attempts, 1);
    await withTx({ tenantId: tenants['demo-college'] }, () => q("update notifications set attempts = 4, next_attempt_at = now() where to_email = 'simran.gill@student.horizon.example'"));
    await processQueue();
    m = (await mails('demo-college', 'simran.gill@student.horizon.example')).at(-1);
    assert.equal(m.status, 'failed');
    process.env.SMTP_URL = good;
  });

  it('escapes hostile text in the HTML body', async () => {
    const { templates } = await import('../src/mail/templates.js');
    const t = templates.applicationReceived({ institute: 'X', name: '<script>alert(1)</script>', applicationNo: 'A', statusUrl: 'https://x/"onmouseover="y' });
    assert.ok(!t.html.includes('<script>'));
    assert.ok(t.html.includes('&lt;script&gt;'));
    assert.ok(!t.html.includes('"onmouseover="y'));
  });
});

describe('Forgot / reset password', () => {
  it('needs the captcha, and answers identically whether or not the account exists', async () => {
    assert.equal((await post('/api/auth/forgot-password', { tenantCode: 'demo-college', email: STUDENT_EMAIL, captchaToken: 'x' })).status, 400);
    const known = await forgot('demo-college', STUDENT_EMAIL);
    const unknown = await forgot('demo-college', 'nobody@nowhere.example');
    const noTenant = await forgot('no-such-college', STUDENT_EMAIL);
    assert.equal(known.status, 200);
    assert.deepEqual(unknown.body, known.body);
    assert.deepEqual(noTenant.body, known.body);
    assert.equal((await mails('demo-college', 'nobody@nowhere.example')).length, 0);
  });

  it('a reset link works once: weak passwords refused, sessions ended, old password dead', async () => {
    const before = await login('demo-college', 'student', 'STU2026002', 'Student@123');
    assert.equal(before.status, 200);
    await forgot('demo-college', 'simran.gill@student.horizon.example');
    const link = (await mails('demo-college', 'simran.gill@student.horizon.example')).filter((m) => m.template === 'passwordReset').at(-1);
    const token = tokenIn(link.text_body);
    assert.ok(token);
    assert.match(link.text_body, /reset-password\?token=.+&institute=demo-college/);

    assert.equal((await post('/api/auth/reset-password', { token, password: 'short' })).status, 400);
    assert.equal((await post('/api/auth/reset-password', { token, password: 'onlyletters' })).status, 400);
    assert.equal((await post('/api/auth/reset-password', { token, password: 'STU2026002' })).status, 400); // equals login ID
    await sleep(20);
    const ok = await post('/api/auth/reset-password', { token, password: 'Fresh@Pass99' });
    assert.equal(ok.status, 200);

    assert.equal((await post('/api/auth/reset-password', { token, password: 'Another@Pass1' })).status, 400); // single use
    assert.equal((await get('/api/student/dashboard', before.cookie)).status, 401);               // old session ended
    assert.equal((await login('demo-college', 'student', 'STU2026002', 'Student@123')).status, 401);
    assert.equal((await login('demo-college', 'student', 'STU2026002', 'Fresh@Pass99')).status, 200);
    // put the demo password back for other tests
    await forgot('demo-college', 'simran.gill@student.horizon.example');
    const t2 = tokenIn((await mails('demo-college', 'simran.gill@student.horizon.example')).filter((m) => m.template === 'passwordReset').at(-1).text_body);
    await post('/api/auth/reset-password', { token: t2, password: 'Student@123' });
  });

  it('expired and made-up tokens are refused; a new request cancels the previous link', async () => {
    assert.equal((await post('/api/auth/reset-password', { token: 'x'.repeat(43), password: 'Fresh@Pass99' })).status, 400);
    await forgot('demo-college', STUDENT_EMAIL);
    const t1 = tokenIn((await mails('demo-college', STUDENT_EMAIL)).filter((m) => m.template === 'passwordReset').at(-1).text_body);
    await forgot('demo-college', STUDENT_EMAIL);
    const t2 = tokenIn((await mails('demo-college', STUDENT_EMAIL)).filter((m) => m.template === 'passwordReset').at(-1).text_body);
    assert.notEqual(t1, t2);
    assert.equal((await post('/api/auth/reset-password', { token: t1, password: 'Fresh@Pass99' })).status, 400);
    await withTx({ platform: true }, () => q("update password_resets set expires_at = now() - interval '1 minute'"));
    assert.equal((await post('/api/auth/reset-password', { token: t2, password: 'Fresh@Pass99' })).status, 400);
  });

  it('a link from one institute cannot reset a same-email user in another', async () => {
    // the same email address exists at two institutes; the token is bound to one user row
    await withTx({ tenantId: tenants['demo-school'] }, () => q("update users set email = $1 where login_id = 'GPS2026001'", [STUDENT_EMAIL]));
    try {
      await forgot('demo-college', STUDENT_EMAIL);
      const token = tokenIn((await mails('demo-college', STUDENT_EMAIL)).filter((m) => m.template === 'passwordReset').at(-1).text_body);
      await post('/api/auth/reset-password', { token, password: 'College@Only1' });
      assert.equal((await login('demo-school', 'student', 'GPS2026001', 'Student@123')).status, 200); // school user untouched
      assert.equal((await login('demo-college', 'student', 'STU2026001', 'College@Only1')).status, 200);
    } finally {
      await withTx({ tenantId: tenants['demo-school'] }, () => q("update users set email = 'ananya.k@student.greenfield.example' where login_id = 'GPS2026001'"));
      await forgot('demo-college', STUDENT_EMAIL);
      const t = tokenIn((await mails('demo-college', STUDENT_EMAIL)).filter((m) => m.template === 'passwordReset').at(-1).text_body);
      await post('/api/auth/reset-password', { token: t, password: 'Student@123' });
    }
  });
});

describe('Change password (signed in)', () => {
  it('checks the current password and the policy; ends other sessions but keeps this one', async () => {
    const a = await login('demo-college', 'student', 'STU2026003', 'Student@123');
    const other = await login('demo-college', 'student', 'STU2026003', 'Student@123');
    assert.equal((await post('/api/auth/change-password', { currentPassword: 'wrong', newPassword: 'Newer@Pass77' }, a.cookie)).status, 400);
    assert.equal((await post('/api/auth/change-password', { currentPassword: 'Student@123', newPassword: 'weak' }, a.cookie)).status, 400);
    assert.equal((await post('/api/auth/change-password', { currentPassword: 'Student@123', newPassword: 'Student@123' }, a.cookie)).status, 400);
    assert.equal((await post('/api/auth/change-password', { currentPassword: 'Student@123', newPassword: 'Newer@Pass77' })).status, 401); // must be signed in
    await sleep(20);
    const ok = await post('/api/auth/change-password', { currentPassword: 'Student@123', newPassword: 'Newer@Pass77' }, a.cookie);
    assert.equal(ok.status, 200);
    assert.equal((await get('/api/student/dashboard', ok.cookie)).status, 200);   // this session continues
    assert.equal((await get('/api/student/dashboard', a.cookie)).status, 401);    // the pre-change token is dead
    assert.equal((await get('/api/student/dashboard', other.cookie)).status, 401); // and so is every other device
    assert.ok((await mails('demo-college', 'karan.mehta@student.horizon.example')).some((m) => m.template === 'passwordChanged'));
    // restore
    await post('/api/auth/change-password', { currentPassword: 'Newer@Pass77', newPassword: 'Student@123' }, ok.cookie);
  });
});

describe('Setup links and temporary passwords', () => {
  const code = `test-acc-${Date.now().toString(36)}`;
  let sa; let tenantId; let temp;

  it('a new institute admin gets a setup email and can set a password without ever knowing the temporary one', async () => {
    sa = (await login('', 'super_admin', 'SA001', 'SuperAdmin@123')).cookie;
    const r = await post('/api/super-admin/tenants', { code, name: 'Acc Test College', type: 'college', admin: { name: 'New Admin', email: `admin@${code}.example` } }, sa);
    assert.equal(r.status, 201);
    tenantId = r.body.tenant.id; temp = r.body.admin.temporaryPassword;
    tenants[code] = tenantId;
    const setup = (await mails(code, `admin@${code}.example`)).find((m) => m.template === 'accountSetup');
    assert.ok(setup, 'setup email queued');
    assert.match(setup.text_body, /Institute code: test-acc-/);
    assert.match(setup.text_body, /Your login ID: ADM001/);
    const token = tokenIn(setup.text_body);
    assert.equal((await post('/api/auth/reset-password', { token, password: 'MyOwn@Pass42' })).status, 200);
    const l = await login(code, 'admin', 'ADM001', 'MyOwn@Pass42');
    assert.equal(l.status, 200);
    assert.equal(l.body.user.mustChangePassword, false);
    assert.equal((await get('/api/admin/dashboard', l.cookie)).status, 200);
    assert.equal((await login(code, 'admin', 'ADM001', temp)).status, 401); // temporary password replaced
  });

  it('a vendor password reset forces a change again; /me and sign-out still work meanwhile', async () => {
    const r = await post(`/api/super-admin/tenants/${tenantId}/reset-admin-password`, {}, sa);
    assert.equal(r.status, 200);
    const l = await login(code, 'admin', 'ADM001', r.body.admin.temporaryPassword);
    assert.equal(l.body.user.mustChangePassword, true);
    const blocked = await get('/api/admin/dashboard', l.cookie);
    assert.equal(blocked.status, 403);
    assert.equal(blocked.body.code, 'PASSWORD_CHANGE_REQUIRED');
    assert.equal((await get('/api/files/00000000-0000-0000-0000-000000000000', l.cookie)).status, 403);
    const me = await get('/api/auth/me', l.cookie);
    assert.equal(me.status, 200);
    assert.equal(me.body.user.mustChangePassword, true);
  });
});

describe('Notifications isolation and applicant emails', () => {
  it('each institute sees only its own outbox; no context sees nothing', async () => {
    await forgot('demo-school', 'ananya.k@student.greenfield.example');
    await withTx({}, async () => assert.equal((await q('select count(*)::int as n from notifications')).rows[0].n, 0));
    await withTx({ tenantId: tenants['demo-school'] }, async () => {
      const { rows } = await q('select distinct to_email from notifications');
      assert.ok(rows.every((r) => r.to_email.endsWith('greenfield.example') || r.to_email.includes('@')));
      assert.equal((await q("select count(*)::int as n from notifications where to_email like '%horizon.example'")).rows[0].n, 0);
    });
    await withTx({ platform: true }, async () => assert.equal((await q('select count(*)::int as n from notifications where tenant_id is not null')).rows[0].n, 0));
  });

  it('applicants get mail at each step and can recover a lost access code', async () => {
    const info = (await get('/api/public/demo-college/admissions/info')).body;
    const email = `mailflow${Date.now()}@example.com`;
    const created = (await post('/api/public/demo-college/admissions/applications', {
      captchaToken: issueCaptchaToken(), courseId: info.courses[0].id, name: '<b>Mail Flow</b>', email, dob: '2006-01-02',
    })).body;
    const upload = (type, cookieless = true) => {
      const f = new FormData(); f.set('docType', type); f.set('file', new Blob([PDF]), `${type}.pdf`);
      return fetch(`${base}/api/public/demo-college/admissions/applications/${created.id}/documents`, { method: 'POST', headers: { 'x-access-code': created.accessCode }, body: f });
    };
    for (const t of ['photo', 'id_proof', 'marksheet']) assert.equal((await upload(t)).status, 201);
    const sub = await fetch(`${base}/api/public/demo-college/admissions/applications/${created.id}/submit`, { method: 'POST', headers: { 'x-access-code': created.accessCode } });
    assert.equal(sub.status, 200);
    const got = await mails('demo-college', email);
    const received = got.find((m) => m.template === 'applicationReceived');
    assert.ok(received);
    assert.ok(received.text_body.includes(created.applicationNo));
    assert.ok(!received.html_body.includes('<b>Mail Flow</b>')); // the applicant's name is escaped
    assert.ok(!received.text_body.includes(created.accessCode)); // the secret is never re-sent by the normal flow

    // lost code: generic answer, new code emailed, old one dead
    const rec = (e) => post('/api/public/demo-college/admissions/applications/recover', { email: e, captchaToken: issueCaptchaToken() });
    const known = await rec(email); const unknown = await rec('never.applied@example.com');
    assert.equal(known.status, 200);
    assert.deepEqual(known.body, unknown.body);
    assert.equal((await mails('demo-college', 'never.applied@example.com')).length, 0);
    assert.equal((await post('/api/public/demo-college/admissions/applications/recover', { email })).status, 400); // captcha
    const recovered = (await mails('demo-college', email)).find((m) => m.template === 'accessCodeRecovered');
    const newCode = recovered.text_body.match(/access code (\S+)/)[1];
    assert.notEqual(newCode, created.accessCode);
    const status = (code) => fetch(`${base}/api/public/demo-college/admissions/applications/${created.id}`, { headers: { 'x-access-code': code } });
    assert.equal((await status(created.accessCode)).status, 404);
    assert.equal((await status(newCode)).status, 200);
    // another institute learns nothing about this applicant
    assert.equal((await post('/api/public/demo-school/admissions/applications/recover', { email, captchaToken: issueCaptchaToken() })).status, 200);
    assert.equal((await mails('demo-school', email)).length, 0);
  });
});

/** The sign-in check each page load makes: quiet with no session, the same answer as /me with one - run with `npm test`. */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createApp } from '../src/app.js';
import { closePool } from '../src/db/pool.js';
import { env } from '../src/config/env.js';
import { issueCaptchaToken } from '../src/services/captcha.service.js';

let server; let base;
before(() => { server = createApp().listen(0); base = `http://127.0.0.1:${server.address().port}`; });
after(async () => { await new Promise((r) => server.close(r)); await closePool(); });

describe('GET /api/auth/session', () => {
  it('answers 200 with no user when there is no session cookie', async () => {
    const r = await fetch(`${base}/api/auth/session`);
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { user: null });
  });
  it('answers 401 for a bad cookie, and gives away nothing', async () => {
    const r = await fetch(`${base}/api/auth/session`, { headers: { cookie: `${env.COOKIE_NAME}=not-a-real-token` } });
    assert.equal(r.status, 401);
    assert.equal((await r.json()).user, undefined);
  });
  it('gives a signed-in person the same answer as /me', async () => {
    const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tenantCode: 'demo-college', role: 'student', identifier: 'STU2026001', password: 'Student@123', captchaToken: issueCaptchaToken() }) });
    assert.equal(login.status, 200);
    const cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).find((c) => c.startsWith(`${env.COOKIE_NAME}=`));
    const session = await (await fetch(`${base}/api/auth/session`, { headers: { cookie } })).json();
    const me = await (await fetch(`${base}/api/auth/me`, { headers: { cookie } })).json();
    assert.equal(session.user.loginId, 'STU2026001');
    assert.deepEqual(session, me);
  });
  it('still keeps /me behind a session', async () => {
    assert.equal((await fetch(`${base}/api/auth/me`)).status, 401);
  });
});

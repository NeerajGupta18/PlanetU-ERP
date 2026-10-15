/** The Android app download: the check, the cache and the redirect - run with `npm test`. */
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { createApp } from '../src/app.js';
import { closePool } from '../src/db/pool.js';
import { apkAvailable, resetApkCache } from '../src/services/appDownload.service.js';

let server; let base;
const realFetch = globalThis.fetch;
before(() => { server = createApp().listen(0); base = `http://127.0.0.1:${server.address().port}`; });
after(async () => { globalThis.fetch = realFetch; await new Promise((r) => server.close(r)); await closePool(); });
beforeEach(() => { resetApkCache(); globalThis.fetch = realFetch; });

// Only calls to GitHub are faked; calls to this test server pass through
const fakeGithub = (status) => { globalThis.fetch = (url, opts) => (String(url).startsWith(base) ? realFetch(url, opts) : Promise.resolve({ ok: status < 400, status })); };

describe('Android app download', () => {
  it('says the app is available when the file exists', async () => {
    assert.equal(await apkAvailable(async () => ({ ok: true })), true);
  });
  it('says it is not available when the file is missing or GitHub cannot be reached', async () => {
    assert.equal(await apkAvailable(async () => ({ ok: false })), false);
    resetApkCache();
    assert.equal(await apkAvailable(async () => { throw new Error('offline'); }), false);
  });
  it('remembers the answer instead of asking GitHub on every visit', async () => {
    let calls = 0;
    const f = async () => { calls += 1; return { ok: true }; };
    await apkAvailable(f); await apkAvailable(f); await apkAvailable(f);
    assert.equal(calls, 1);
  });
  it('lets the login page ask without signing in', async () => {
    fakeGithub(200);
    const r = await fetch(`${base}/api/app/info`);
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { android: true });
  });
  it('sends the phone to the newest APK, or says 404 when there is none yet', async () => {
    fakeGithub(200);
    const ok = await fetch(`${base}/get-app/android`, { redirect: 'manual' });
    assert.equal(ok.status, 302);
    assert.match(ok.headers.get('location'), /planetu-erp\.apk$/);
    resetApkCache();
    fakeGithub(404);
    const none = await fetch(`${base}/get-app/android`, { redirect: 'manual' });
    assert.equal(none.status, 404);
  });
});

/** File upload/download tests - run with `npm test -w server` (needs `npm run db:setup` first). */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { env } from '../src/config/env.js';
import { createApp } from '../src/app.js';
import { closePool, q, withTx } from '../src/db/pool.js';
import { issueCaptchaToken } from '../src/services/captcha.service.js';

let server; let base;
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(200, 65)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(50)]);

async function login(tenantCode, role, identifier, password) {
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tenantCode, role, identifier, password, captchaToken: issueCaptchaToken() }),
  });
  assert.equal(res.status, 200);
  return res.headers.getSetCookie().map((c) => c.split(';')[0]).find((c) => c.startsWith(`${env.COOKIE_NAME}=`));
}
const upload = (cookie, bytes, name = 'doc.pdf', purpose = 'admission') => {
  const form = new FormData();
  form.set('purpose', purpose);
  form.set('file', new Blob([bytes], { type: 'application/pdf' }), name);
  return fetch(`${base}/api/files`, { method: 'POST', headers: cookie ? { cookie } : {}, body: form });
};
const get = (cookie, id, qs = '') => fetch(`${base}/api/files/${id}${qs}`, { headers: cookie ? { cookie } : {} });

let collegeAdmin; let schoolAdmin; let collegeStudent; let schoolStudent;
before(async () => {
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  collegeAdmin = await login('demo-college', 'admin', 'ADM001', 'Admin@123');
  schoolAdmin = await login('demo-school', 'admin', 'ADM001', 'Admin@123');
  collegeStudent = await login('demo-college', 'student', 'STU2026001', 'Student@123');
  schoolStudent = await login('demo-school', 'student', 'GPS2026001', 'Student@123');
});
after(async () => {
  await new Promise((r) => server.close(r));
  await closePool();
});

describe('Uploads', () => {
  it('rejects anonymous uploads before reading the body', async () => {
    assert.equal((await upload(null, PDF)).status, 401);
  });

  it('accepts a real PDF and PNG, and reports the sniffed type', async () => {
    const a = await (await upload(collegeStudent, PDF)).json();
    assert.equal(a.file.mime, 'application/pdf');
    const b = await upload(collegeStudent, PNG, 'photo.png', 'profile');
    assert.equal(b.status, 201);
    assert.equal((await b.json()).file.mime, 'image/png');
  });

  it('rejects a disguised file: an executable named .pdf is not a PDF', async () => {
    const r = await upload(collegeStudent, Buffer.from('MZ\x90\x00 fake exe pretending'), 'invoice.pdf');
    assert.equal(r.status, 415);
  });

  it('rejects files over 5 MB and unknown purposes', async () => {
    const big = Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(5 * 1024 * 1024 + 10)]);
    assert.equal((await upload(collegeStudent, big)).status, 413);
    assert.equal((await upload(collegeStudent, PDF, 'a.pdf', 'hack')).status, 400);
  });

  it('never uses the user-supplied name on disk (path traversal is inert)', async () => {
    const r = await upload(collegeStudent, PDF, '../../../etc/passwd.pdf');
    assert.equal(r.status, 201);
    const { file } = await r.json();
    const key = (await withTx({ tenantId: await tenantId('demo-college') }, () => q('select storage_key, original_name from files where id = $1', [file.id]))).rows[0];
    assert.match(key.storage_key, /^[0-9a-f-]{36}\/[0-9a-f-]{36}$/);
    if (env.STORAGE_DRIVER === 'db') {
      const stored = await withTx({ tenantId: await tenantId('demo-college') }, () => q('select length(data) as n from file_blobs where storage_key = $1', [key.storage_key]));
      assert.equal(stored.rowCount, 1, 'the bytes are in the database under the generated key');
    } else {
      assert.ok(fs.existsSync(path.join(env.UPLOAD_DIR, key.storage_key)));
    }
    assert.ok(!key.original_name.includes('/'));
  });
});

async function tenantId(code) {
  return (await withTx({ platform: true }, () => q('select id from tenants where code = $1', [code]))).rows[0].id;
}

describe('Download authorisation', () => {
  let fileId;
  before(async () => { fileId = (await (await upload(collegeStudent, PDF, 'mine.pdf')).json()).file.id; });

  it('the uploader can read it, with safe headers', async () => {
    const r = await get(collegeStudent, fileId);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.match(r.headers.get('content-security-policy'), /default-src 'none'/);
    assert.match(r.headers.get('content-security-policy'), /frame-ancestors 'self'/, 'only our own pages may embed a file');
    assert.deepEqual(Buffer.from(await r.arrayBuffer()), PDF);
  });

  it('is shown inline by default and only saved to disk when a download is asked for', async () => {
    const view = await get(collegeStudent, fileId);
    assert.match(view.headers.get('content-disposition'), /^inline;/, 'viewing must not trigger a download');
    const save = await fetch(`${base}/api/files/${fileId}?download=1`, { headers: { cookie: collegeStudent } });
    assert.match(save.headers.get('content-disposition'), /^attachment;/);
  });

  it('a PDF is not sandboxed (Chrome would refuse to display it), but an image still is', async () => {
    const pdf = await get(collegeStudent, fileId);
    assert.doesNotMatch(pdf.headers.get('content-security-policy'), /sandbox/, 'a sandboxed PDF cannot be viewed on screen');
    assert.equal(pdf.headers.get('content-type'), 'application/pdf');
    const imgId = (await (await upload(collegeStudent, PNG, 'photo.png')).json()).file.id;
    const img = await get(collegeStudent, imgId);
    assert.match(img.headers.get('content-security-policy'), /sandbox/);
    assert.equal(img.headers.get('content-type'), 'image/png');
    assert.equal(img.headers.get('x-content-type-options'), 'nosniff');
  });

  it('an admin of the same institute can read it', async () => {
    assert.equal((await get(collegeAdmin, fileId)).status, 200);
  });

  it('another student of the same institute cannot', async () => {
    const other = await login('demo-college', 'student', 'STU2026002', 'Student@123');
    assert.equal((await get(other, fileId)).status, 404);
  });

  it('another institute - even its admin - cannot', async () => {
    assert.equal((await get(schoolAdmin, fileId)).status, 404);
    assert.equal((await get(schoolStudent, fileId)).status, 404);
    assert.equal((await fetch(`${base}/api/files/${fileId}`, { method: 'DELETE', headers: { cookie: schoolAdmin } })).status, 404);
  });

  it('anonymous and malformed ids are refused cleanly', async () => {
    assert.equal((await get(null, fileId)).status, 401);
    assert.equal((await get(collegeAdmin, 'nope')).status, 404);
  });

  it('deleting removes the record and the bytes; only the owner/admin may', async () => {
    const other = await login('demo-college', 'student', 'STU2026002', 'Student@123');
    assert.equal((await fetch(`${base}/api/files/${fileId}`, { method: 'DELETE', headers: { cookie: other } })).status, 404);
    const key = (await withTx({ tenantId: await tenantId('demo-college') }, () => q('select storage_key from files where id = $1', [fileId]))).rows[0].storage_key;
    assert.equal((await fetch(`${base}/api/files/${fileId}`, { method: 'DELETE', headers: { cookie: collegeStudent } })).status, 200);
    assert.ok(!fs.existsSync(path.join(env.UPLOAD_DIR, key)));
    assert.equal((await get(collegeStudent, fileId)).status, 404);
  });
});

describe('Files table isolation (database)', () => {
  it('no tenant context sees any files; a tenant sees none of another tenant\'s files', async () => {
    assert.equal((await withTx({}, () => q('select count(*)::int as n from files'))).rows[0].n, 0);
    const collegeFileIds = (await withTx({ tenantId: await tenantId('demo-college') }, () => q('select id from files'))).rows.map((r) => r.id);
    await withTx({ tenantId: await tenantId('demo-school') }, async () => {
      const schoolIds = (await q('select id from files')).rows.map((r) => r.id);
      assert.ok(schoolIds.every((id) => !collegeFileIds.includes(id)));
    });
  });
});

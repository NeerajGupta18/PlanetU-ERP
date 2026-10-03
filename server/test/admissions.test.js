/** Admissions tests - run with `npm test` (needs `npm run db:setup` first). */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { env } from '../src/config/env.js';
import { createApp } from '../src/app.js';
import { closePool, q, withTx } from '../src/db/pool.js';
import { issueCaptchaToken } from '../src/services/captcha.service.js';

let server; let base;
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(100, 66)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40)]);
const CODE = `test-adm-${Date.now().toString(36)}`;
let tenantId; let courseId; let sa; let admin;

const json = async (method, path, { cookie, body, headers = {} } = {}) => {
  const r = await fetch(`${base}${path}`, {
    method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let b = null; try { b = await r.json(); } catch { /* empty */ }
  return { status: r.status, body: b, headers: r.headers };
};
async function login(tenantCode, role, identifier, password) {
  const r = await json('POST', '/api/auth/login', { body: { tenantCode, role, identifier, password, captchaToken: issueCaptchaToken() } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.headers.getSetCookie().map((c) => c.split(';')[0]).find((c) => c.startsWith(`${env.COOKIE_NAME}=`));
}
const apply = (code, over = {}) => json('POST', `/api/public/${code}/admissions/applications`, { body: {
  captchaToken: issueCaptchaToken(), courseId, name: 'Riya Applicant', email: `riya${Math.random().toString(36).slice(2, 8)}@example.com`,
  phone: '9000000000', dob: '2006-04-12', gender: 'Female', address: 'Pune', guardian: { name: 'Parent', relation: 'Father', phone: '9000000001' },
  previousEducation: { institution: 'ABC School', qualification: 'HSC', year: '2024', percentage: '88' }, ...over } });
const put = (code, id, access, docType, bytes = PDF) => {
  const f = new FormData(); f.set('docType', docType); f.set('file', new Blob([bytes]), `${docType}.pdf`);
  return fetch(`${base}/api/public/${code}/admissions/applications/${id}/documents`, { method: 'POST', headers: { 'x-access-code': access }, body: f });
};
const st = (code, id, access) => json('GET', `/api/public/${code}/admissions/applications/${id}`, { headers: { 'x-access-code': access } });
const submit = (code, id, access) => json('POST', `/api/public/${code}/admissions/applications/${id}/submit`, { headers: { 'x-access-code': access } });
async function fullApplication(code = CODE, over = {}) {
  const c = (await apply(code, over)).body;
  await put(code, c.id, c.accessCode, 'photo', PNG); await put(code, c.id, c.accessCode, 'id_proof'); await put(code, c.id, c.accessCode, 'marksheet');
  const s = await submit(code, c.id, c.accessCode);
  assert.equal(s.status, 200, JSON.stringify(s.body));
  return c;
}

before(async () => {
  process.env.PUBLIC_CREATE_LIMIT = '1000';
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  sa = await login('', 'super_admin', 'SA001', 'SuperAdmin@123');
  const t = await json('POST', '/api/super-admin/tenants', { cookie: sa, body: { code: CODE, name: 'Admissions Test College', type: 'college', admin: { name: 'Adm', email: `a@${CODE}.example` } } });
  assert.equal(t.status, 201);
  tenantId = t.body.tenant.id;
  await withTx({ tenantId }, async () => { courseId = (await q("insert into courses (code, name, full_name, years) values ('BSC', 'B.Sc', 'Bachelor of Science', 3) returning id")).rows[0].id; });
  const first = await login(CODE, 'admin', 'ADM001', t.body.admin.temporaryPassword);
  const ch = await fetch(`${base}/api/auth/change-password`, {
    method: 'POST', headers: { 'content-type': 'application/json', cookie: first },
    body: JSON.stringify({ currentPassword: t.body.admin.temporaryPassword, newPassword: 'Changed@12345' }),
  });
  assert.equal(ch.status, 200);
  admin = ch.headers.getSetCookie().map((c) => c.split(';')[0]).find((c) => c.startsWith(`${env.COOKIE_NAME}=`));
});
after(async () => {
  await withTx({ platform: true }, () => q("delete from tenants where code like 'test-adm-%'"));
  await new Promise((r) => server.close(r));
  await closePool();
});

describe('Public application', () => {
  it('shows the course list and required documents for an institute that offers admissions', async () => {
    const r = await json('GET', `/api/public/${CODE}/admissions/info`);
    assert.equal(r.status, 200);
    assert.equal(r.body.courses[0].name, 'B.Sc');
    assert.deepEqual(r.body.requiredDocuments, ['photo', 'id_proof', 'marksheet']);
    assert.equal(r.body.institute.name, 'Admissions Test College');
  });

  it('404s for an unknown institute or one without the module', async () => {
    assert.equal((await json('GET', '/api/public/nope-nope/admissions/info')).status, 404);
    await json('PUT', `/api/super-admin/tenants/${tenantId}`, { cookie: sa, body: { modules: ['institute', 'departments', 'employees'] } });
    assert.equal((await json('GET', `/api/public/${CODE}/admissions/info`)).status, 404);
    await json('PUT', `/api/super-admin/tenants/${tenantId}`, { cookie: sa, body: { modules: ['institute', 'departments', 'employees', 'admissions'] } });
    assert.equal((await json('GET', `/api/public/${CODE}/admissions/info`)).status, 200);
  });

  it('needs the captcha, valid data and a real course', async () => {
    assert.equal((await apply(CODE, { captchaToken: 'x' })).status, 400);
    assert.equal((await apply(CODE, { email: 'not-an-email' })).status, 400);
    assert.equal((await apply(CODE, { dob: '2999-01-01' })).status, 400);
    assert.equal((await apply(CODE, { name: '' })).status, 400);
    assert.equal((await apply(CODE, { courseId: '00000000-0000-0000-0000-000000000000' })).status, 400);
  });

  it('returns an access code once, and only its hash is stored', async () => {
    const r = await apply(CODE);
    assert.equal(r.status, 201);
    assert.match(r.body.applicationNo, /^APP\d{4}-\d{5}$/);
    const { rows: [row] } = await withTx({ tenantId }, () => q('select access_hash from applications where id = $1', [r.body.id]));
    assert.ok(!row.access_hash.includes(r.body.accessCode));
    assert.equal(row.access_hash.length, 64);
  });

  it('the access code is the key: wrong, missing, or another application\'s code is refused', async () => {
    const a = (await apply(CODE)).body; const b = (await apply(CODE)).body;
    assert.equal((await st(CODE, a.id, a.accessCode)).status, 200);
    assert.equal((await st(CODE, a.id, 'wrong')).status, 404);
    assert.equal((await st(CODE, a.id, b.accessCode)).status, 404);
    assert.equal((await json('GET', `/api/public/${CODE}/admissions/applications/${a.id}`)).status, 401);
    assert.equal((await put(CODE, a.id, b.accessCode, 'photo', PNG)).status, 404);
  });

  it('an applicant can find their application by number + access code (and nothing else works)', async () => {
    const a = (await apply(CODE)).body;
    const lookup = (b, code = CODE) => json('POST', `/api/public/${code}/admissions/applications/lookup`, { body: b });
    const ok = await lookup({ applicationNo: a.applicationNo, accessCode: a.accessCode });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.application.id, a.id);
    assert.equal((await lookup({ applicationNo: a.applicationNo, accessCode: 'wrong' })).status, 404);
    assert.equal((await lookup({ applicationNo: a.applicationNo })).status, 400);
    assert.equal((await lookup({ applicationNo: a.applicationNo, accessCode: a.accessCode }, 'demo-college')).status, 404);
  });

  it('another institute cannot see or touch the application, even with the right code', async () => {
    const a = (await apply(CODE)).body;
    assert.equal((await st('demo-college', a.id, a.accessCode)).status, 404);
    assert.equal((await put('demo-college', a.id, a.accessCode, 'photo', PNG)).status, 404);
  });

  it('rejects a disguised document; replaces a re-uploaded one', async () => {
    const a = (await apply(CODE)).body;
    assert.equal((await put(CODE, a.id, a.accessCode, 'photo', Buffer.from('MZ not an image'))).status, 415);
    assert.equal((await put(CODE, a.id, a.accessCode, 'photo', PNG)).status, 201);
    assert.equal((await put(CODE, a.id, a.accessCode, 'photo', PNG)).status, 201);
    const v = (await st(CODE, a.id, a.accessCode)).body.application;
    assert.equal(v.documents.filter((d) => d.docType === 'photo').length, 1);
  });

  it('cannot be submitted without the required documents', async () => {
    const a = (await apply(CODE)).body;
    await put(CODE, a.id, a.accessCode, 'photo', PNG);
    const r = await submit(CODE, a.id, a.accessCode);
    assert.equal(r.status, 400);
    assert.match(r.body.message, /id_proof/);
  });

  it('submits when complete, then locks; the same person cannot apply twice for a course', async () => {
    const email = 'dup@example.com';
    const a = await fullApplication(CODE, { email });
    assert.equal((await st(CODE, a.id, a.accessCode)).body.application.status, 'submitted');
    assert.equal((await put(CODE, a.id, a.accessCode, 'other')).status, 409);
    assert.equal((await submit(CODE, a.id, a.accessCode)).status, 409);
    const b = (await apply(CODE, { email })).body; // a draft is allowed...
    await put(CODE, b.id, b.accessCode, 'photo', PNG); await put(CODE, b.id, b.accessCode, 'id_proof'); await put(CODE, b.id, b.accessCode, 'marksheet');
    assert.equal((await submit(CODE, b.id, b.accessCode)).status, 409); // ...submitting a duplicate is not
  });
});

describe('Admin review, decision and enrolment', () => {
  it('admins of other institutes see none of these applications', async () => {
    const a = await fullApplication();
    const other = await login('demo-college', 'admin', 'ADM001', 'Admin@123');
    const list = await json('GET', '/api/admin/admissions', { cookie: other });
    assert.ok(list.body.applications.every((x) => x.id !== a.id));
    assert.equal((await json('GET', `/api/admin/admissions/${a.id}`, { cookie: other })).status, 404);
    assert.equal((await json('POST', `/api/admin/admissions/${a.id}/decision`, { cookie: other, body: { decision: 'reject', note: 'x' } })).status, 404);
    assert.equal((await json('GET', '/api/admin/admissions')).status, 401);
  });

  it('drafts are invisible to admins; submitted ones are listed with counts', async () => {
    const draft = (await apply(CODE)).body;
    const done = await fullApplication();
    const list = (await json('GET', '/api/admin/admissions', { cookie: admin })).body;
    assert.ok(list.applications.some((x) => x.id === done.id));
    assert.ok(list.applications.every((x) => x.id !== draft.id));
    assert.ok(list.counts.submitted >= 1);
    assert.equal((await json('GET', `/api/admin/admissions/${draft.id}`, { cookie: admin })).status, 404);
  });

  it('admin can open an applicant\'s document; anonymous and other institutes cannot', async () => {
    const a = await fullApplication();
    const { documents } = (await json('GET', `/api/admin/admissions/${a.id}`, { cookie: admin })).body.application;
    const ok = await fetch(`${base}/api/files/${documents[0].fileId}`, { headers: { cookie: admin } });
    assert.equal(ok.status, 200);
    assert.equal((await fetch(`${base}/api/files/${documents[0].fileId}`)).status, 401);
    const other = await login('demo-college', 'admin', 'ADM001', 'Admin@123');
    assert.equal((await fetch(`${base}/api/files/${documents[0].fileId}`, { headers: { cookie: other } })).status, 404);
  });

  it('cannot accept until every required document is verified', async () => {
    const a = await fullApplication();
    const r = await json('POST', `/api/admin/admissions/${a.id}/decision`, { cookie: admin, body: { decision: 'accept' } });
    assert.equal(r.status, 409);
    assert.match(r.body.message, /Verify these documents/);
  });

  it('a rejected document sends the application back; the applicant fixes it and resubmits', async () => {
    const a = await fullApplication();
    const app = (await json('GET', `/api/admin/admissions/${a.id}`, { cookie: admin })).body.application;
    const marks = app.documents.find((d) => d.docType === 'marksheet');
    assert.equal((await json('PUT', `/api/admin/admissions/${a.id}/documents/${marks.id}`, { cookie: admin, body: { status: 'rejected' } })).status, 400); // needs a reason
    const rej = await json('PUT', `/api/admin/admissions/${a.id}/documents/${marks.id}`, { cookie: admin, body: { status: 'rejected', remark: 'Blurry scan' } });
    assert.equal(rej.body.application.status, 'documents_pending');
    const view = (await st(CODE, a.id, a.accessCode)).body.application;
    assert.equal(view.documents.find((d) => d.docType === 'marksheet').remark, 'Blurry scan');
    assert.equal((await submit(CODE, a.id, a.accessCode)).status, 400); // must replace it first
    assert.equal((await put(CODE, a.id, a.accessCode, 'marksheet')).status, 201);
    assert.equal((await submit(CODE, a.id, a.accessCode)).status, 200);
    assert.equal((await json('GET', `/api/admin/admissions/${a.id}`, { cookie: admin })).body.application.status, 'submitted');
  });

  it('reject/waitlist need a note; a waitlisted applicant can be accepted later', async () => {
    const a = await fullApplication();
    assert.equal((await json('POST', `/api/admin/admissions/${a.id}/decision`, { cookie: admin, body: { decision: 'waitlist' } })).status, 400);
    const w = await json('POST', `/api/admin/admissions/${a.id}/decision`, { cookie: admin, body: { decision: 'waitlist', note: 'Seats full' } });
    assert.equal(w.body.application.status, 'waitlisted');
    assert.equal((await st(CODE, a.id, a.accessCode)).body.application.decisionNote, 'Seats full');
  });

  it('accept -> enrol creates a student with a PRN and a working login', async () => {
    const a = await fullApplication(CODE, { name: 'Enrol Me', email: 'enrol.me@example.com' });
    const app = (await json('GET', `/api/admin/admissions/${a.id}`, { cookie: admin })).body.application;
    assert.equal((await json('POST', `/api/admin/admissions/${a.id}/enroll`, { cookie: admin })).status, 409); // not accepted yet
    for (const d of app.documents) await json('PUT', `/api/admin/admissions/${a.id}/documents/${d.id}`, { cookie: admin, body: { status: 'verified' } });
    assert.equal((await json('POST', `/api/admin/admissions/${a.id}/decision`, { cookie: admin, body: { decision: 'accept' } })).body.application.status, 'accepted');

    const e = await json('POST', `/api/admin/admissions/${a.id}/enroll`, { cookie: admin });
    assert.equal(e.status, 200, JSON.stringify(e.body));
    assert.match(e.body.student.prn, /^PRN\d{7}$/);
    assert.equal(e.body.application.status, 'enrolled');
    assert.equal((await json('POST', `/api/admin/admissions/${a.id}/enroll`, { cookie: admin })).status, 409); // only once

    const first = await login(CODE, 'student', e.body.student.prn, e.body.student.temporaryPassword);
    const blocked = await json('GET', '/api/student/dashboard', { cookie: first });
    assert.equal(blocked.status, 403);
    assert.equal(blocked.body.code, 'PASSWORD_CHANGE_REQUIRED');
    const ch = await fetch(`${base}/api/auth/change-password`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie: first },
      body: JSON.stringify({ currentPassword: e.body.student.temporaryPassword, newPassword: 'Student@2026x' }),
    });
    assert.equal(ch.status, 200);
    const s = ch.headers.getSetCookie().map((c) => c.split(';')[0]).find((c) => c.startsWith(`${env.COOKIE_NAME}=`));
    const dash = await json('GET', '/api/student/dashboard', { cookie: s });
    assert.equal(dash.status, 200);
    assert.equal(dash.body.student.name, 'Enrol Me');
    assert.equal(dash.body.student.course, 'B.Sc');
    assert.equal((await st(CODE, a.id, a.accessCode)).body.application.status, 'enrolled');
  });

  it('simultaneous enrolments get distinct PRNs', async () => {
    const apps = [];
    for (let i = 0; i < 4; i += 1) {
      const a = await fullApplication(CODE, { email: `par${i}@example.com` });
      const app = (await json('GET', `/api/admin/admissions/${a.id}`, { cookie: admin })).body.application;
      for (const d of app.documents) await json('PUT', `/api/admin/admissions/${a.id}/documents/${d.id}`, { cookie: admin, body: { status: 'verified' } });
      await json('POST', `/api/admin/admissions/${a.id}/decision`, { cookie: admin, body: { decision: 'accept' } });
      apps.push(a);
    }
    const res = await Promise.all(apps.map((a) => json('POST', `/api/admin/admissions/${a.id}/enroll`, { cookie: admin })));
    assert.ok(res.every((r) => r.status === 200), JSON.stringify(res.map((r) => r.body)));
    assert.equal(new Set(res.map((r) => r.body.student.prn)).size, 4);
  });

  it('the admissions module can be switched off for the institute', async () => {
    await json('PUT', `/api/super-admin/tenants/${tenantId}`, { cookie: sa, body: { modules: ['institute', 'departments', 'employees'] } });
    const r = await json('GET', '/api/admin/admissions', { cookie: admin });
    assert.equal(r.status, 403);
    assert.equal(r.body.code, 'MODULE_DISABLED');
    await json('PUT', `/api/super-admin/tenants/${tenantId}`, { cookie: sa, body: { modules: ['institute', 'departments', 'employees', 'admissions'] } });
  });
});

describe('Abuse protection', () => {
  it('rate-limits application creation per client', async () => {
    process.env.PUBLIC_CREATE_LIMIT = '1'; // window already holds many hits, so this trips at once
    const r = await apply(CODE);
    assert.equal(r.status, 429);
    process.env.PUBLIC_CREATE_LIMIT = '1000';
  });
});

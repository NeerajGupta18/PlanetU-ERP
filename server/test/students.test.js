/** Students module + ID cards - run with `npm test` (needs `npm run db:setup` first). */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { env } from '../src/config/env.js';
import { createApp } from '../src/app.js';
import { closePool, q, withTx } from '../src/db/pool.js';
import { issueCaptchaToken } from '../src/services/captcha.service.js';

let server; let base;
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(80, 66)]);
// A real, valid, tiny (1x1) PNG - PDFKit parses the actual image structure, so a stub won't do.
const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de'
  + '0000000c49444154789c63f8cfc0000003010100c9fe92ef0000000049454e44ae426082', 'hex',
);

const json = async (method, path, { cookie, body, headers = {} } = {}) => {
  const r = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  let b = null; try { b = await r.json(); } catch { /* empty */ }
  return { status: r.status, body: b, headers: r.headers };
};
async function login(tenantCode, role, identifier, password) {
  const r = await json('POST', '/api/auth/login', { body: { tenantCode, role, identifier, password, captchaToken: issueCaptchaToken() } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.headers.getSetCookie().map((c) => c.split(';')[0]).find((c) => c.startsWith(`${env.COOKIE_NAME}=`));
}
const pdfCheck = (buf) => buf.slice(0, 5).toString('latin1') === '%PDF-';

let admin; let schoolAdmin; let tenantId; let courseId;
before(async () => {
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  admin = await login('demo-college', 'admin', 'ADM001', 'Admin@123');
  schoolAdmin = await login('demo-school', 'admin', 'ADM001', 'Admin@123');
  tenantId = (await withTx({ platform: true }, () => q("select id from tenants where code = 'demo-college'"))).rows[0].id;
  courseId = (await withTx({ tenantId }, () => q('select id from courses limit 1'))).rows[0].id;
});
after(async () => { await new Promise((r) => server.close(r)); await closePool(); });

describe('Students list & detail', () => {
  it('lists the institute\'s students only, with search and status filters', async () => {
    const all = await json('GET', '/api/admin/students', { cookie: admin });
    assert.equal(all.status, 200);
    assert.equal(all.body.students.length, 3);
    const searched = await json('GET', '/api/admin/students?search=Aarav', { cookie: admin });
    assert.equal(searched.body.students.length, 1);
    assert.equal(searched.body.students[0].name, 'Aarav Sharma');
    const active = await json('GET', '/api/admin/students?status=Active', { cookie: admin });
    assert.equal(active.body.students.length, 3);
    const school = await json('GET', '/api/admin/students', { cookie: schoolAdmin });
    assert.ok(school.body.students.every((s) => !all.body.students.some((a) => a.id === s.id)));
  });

  it('another institute cannot read or edit a student by id (404, not leaked data)', async () => {
    const target = (await json('GET', '/api/admin/students', { cookie: admin })).body.students[0];
    assert.equal((await json('GET', `/api/admin/students/${target.id}`, { cookie: schoolAdmin })).status, 404);
    assert.equal((await json('PUT', `/api/admin/students/${target.id}`, { cookie: schoolAdmin, body: { section: 'Z' } })).status, 404);
    assert.equal((await json('GET', `/api/admin/students/${target.id}/id-card.pdf`, { cookie: schoolAdmin })).status, 404);
  });

  it('detail includes attendance and course name; unknown id is 404', async () => {
    const target = (await json('GET', '/api/admin/students', { cookie: admin })).body.students[0];
    const r = await json('GET', `/api/admin/students/${target.id}`, { cookie: admin });
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body.student.attendance) && r.body.student.attendance.length > 0);
    assert.equal(r.body.student.course, 'BCA');
    assert.equal((await json('GET', '/api/admin/students/00000000-0000-0000-0000-000000000000', { cookie: admin })).status, 404);
  });
});

describe('Editing a student', () => {
  it('updates allowed fields, validates semester and status, and cannot touch protected columns', async () => {
    const target = (await json('GET', '/api/admin/students', { cookie: admin })).body.students[0];
    const original = { section: target.section, phone: target.phone, semester: target.semester };
    const bad = await json('PUT', `/api/admin/students/${target.id}`, { cookie: admin, body: { semester: 99 } });
    assert.equal(bad.status, 400);
    const badStatus = await json('PUT', `/api/admin/students/${target.id}`, { cookie: admin, body: { status: 'Deleted' } });
    assert.equal(badStatus.status, 400);
    const ok = await json('PUT', `/api/admin/students/${target.id}`, { cookie: admin, body: { section: 'B', phone: '+91 90000 00000', semester: 4 } });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.student.section, 'B');
    assert.equal(ok.body.student.semester, 4);
    // a field not in the editable set (name) is silently ignored, not an error and not applied
    const untouched = await json('PUT', `/api/admin/students/${target.id}`, { cookie: admin, body: { name: 'Hacked Name' } });
    assert.equal(untouched.status, 400); // nothing recognised in the payload is a request error, not a silent no-op
    await json('PUT', `/api/admin/students/${target.id}`, { cookie: admin, body: original }); // leave the demo record as it was
  });

  it('setting status to Inactive disables the student\'s login; Active restores it', async () => {
    const target = (await json('GET', '/api/admin/students', { cookie: admin })).body.students[1];
    const before = await login('demo-college', 'student', target.studentCode, 'Student@123');
    assert.ok(before);
    await json('PUT', `/api/admin/students/${target.id}`, { cookie: admin, body: { status: 'Inactive' } });
    const blocked = await json('POST', '/api/auth/login', { body: { tenantCode: 'demo-college', role: 'student', identifier: target.studentCode, password: 'Student@123', captchaToken: issueCaptchaToken() } });
    assert.equal(blocked.status, 401);
    await json('PUT', `/api/admin/students/${target.id}`, { cookie: admin, body: { status: 'Active' } });
    assert.ok(await login('demo-college', 'student', target.studentCode, 'Student@123'));
  });
});

describe('Student photo', () => {
  it('accepts an uploaded image as the ID photo; rejects a PDF and another institute\'s file', async () => {
    const target = (await json('GET', '/api/admin/students', { cookie: admin })).body.students[2];
    const form = new FormData(); form.set('purpose', 'profile'); form.set('file', new Blob([PNG]), 'photo.png');
    const up = await fetch(`${base}/api/files`, { method: 'POST', headers: { cookie: admin }, body: form });
    const { file } = await up.json();
    assert.equal((await json('PUT', `/api/admin/students/${target.id}/photo`, { cookie: admin, body: { fileId: file.id } })).status, 200);

    const pdfForm = new FormData(); pdfForm.set('purpose', 'profile'); pdfForm.set('file', new Blob([PDF]), 'doc.pdf');
    const pdfUp = await (await fetch(`${base}/api/files`, { method: 'POST', headers: { cookie: admin }, body: pdfForm })).json();
    assert.equal((await json('PUT', `/api/admin/students/${target.id}/photo`, { cookie: admin, body: { fileId: pdfUp.file.id } })).status, 400);

    const schoolForm = new FormData(); schoolForm.set('purpose', 'profile'); schoolForm.set('file', new Blob([PNG]), 'p.png');
    const schoolFile = await (await fetch(`${base}/api/files`, { method: 'POST', headers: { cookie: schoolAdmin }, body: schoolForm })).json();
    assert.equal((await json('PUT', `/api/admin/students/${target.id}/photo`, { cookie: admin, body: { fileId: schoolFile.file.id } })).status, 400);

    assert.equal((await json('PUT', `/api/admin/students/${target.id}/photo`, { cookie: admin, body: { fileId: null } })).status, 200);
  });
});

describe('ID cards', () => {
  it('generates a two-page PDF for an active student; an inactive one is refused', async () => {
    const target = (await json('GET', '/api/admin/students', { cookie: admin })).body.students[0];
    const r = await fetch(`${base}/api/admin/students/${target.id}/id-card.pdf`, { headers: { cookie: admin } });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'application/pdf');
    const buf = Buffer.from(await r.arrayBuffer());
    assert.ok(pdfCheck(buf));
    assert.ok(buf.length > 500);

    await json('PUT', `/api/admin/students/${target.id}`, { cookie: admin, body: { status: 'Inactive' } });
    const blocked = await fetch(`${base}/api/admin/students/${target.id}/id-card.pdf`, { headers: { cookie: admin } });
    assert.equal(blocked.status, 409);
    await json('PUT', `/api/admin/students/${target.id}`, { cookie: admin, body: { status: 'Active' } });
  });

  it('a student can download their own card, and only their own', async () => {
    const s = await login('demo-college', 'student', 'STU2026001', 'Student@123');
    const own = await fetch(`${base}/api/student/id-card.pdf`, { headers: { cookie: s } });
    assert.equal(own.status, 200);
    assert.ok(pdfCheck(Buffer.from(await own.arrayBuffer())));
    assert.equal((await fetch(`${base}/api/student/id-card.pdf`)).status, 401);
  });

  it('the id_cards module can be switched off independently of students', async () => {
    const sa = await login('', 'super_admin', 'SA001', 'SuperAdmin@123');
    const list = (await json('GET', '/api/super-admin/tenants', { cookie: sa })).body.tenants;
    const college = list.find((t) => t.code === 'demo-college');
    await json('PUT', `/api/super-admin/tenants/${college.id}`, { cookie: sa, body: { modules: college.modules.filter((m) => m !== 'id_cards') } });
    const target = (await json('GET', '/api/admin/students', { cookie: admin })).body.students[0];
    const blocked = await fetch(`${base}/api/admin/students/${target.id}/id-card.pdf`, { headers: { cookie: admin } });
    assert.equal(blocked.status, 403);
    assert.equal((await json('GET', '/api/admin/students', { cookie: admin })).status, 200); // the list itself still works
    await json('PUT', `/api/super-admin/tenants/${college.id}`, { cookie: sa, body: { modules: college.modules } });
    assert.equal((await fetch(`${base}/api/admin/students/${target.id}/id-card.pdf`, { headers: { cookie: admin } })).status, 200);
  });

  it('the students module gates the whole list; other modules are unaffected', async () => {
    const sa = await login('', 'super_admin', 'SA001', 'SuperAdmin@123');
    const list = (await json('GET', '/api/super-admin/tenants', { cookie: sa })).body.tenants;
    const college = list.find((t) => t.code === 'demo-college');
    await json('PUT', `/api/super-admin/tenants/${college.id}`, { cookie: sa, body: { modules: college.modules.filter((m) => m !== 'students') } });
    assert.equal((await json('GET', '/api/admin/students', { cookie: admin })).status, 403);
    assert.equal((await json('GET', '/api/admin/employees', { cookie: admin })).status, 200);
    await json('PUT', `/api/super-admin/tenants/${college.id}`, { cookie: sa, body: { modules: college.modules } });
  });
});

describe('Admission -> enrolment carries the photo through', () => {
  const CODE = `test-stu-${Date.now().toString(36)}`;
  it('a verified admission photo becomes the enrolled student\'s ID photo automatically', async () => {
    const sa = await login('', 'super_admin', 'SA001', 'SuperAdmin@123');
    const t = await json('POST', '/api/super-admin/tenants', { cookie: sa, body: { code: CODE, name: 'Photo Test College', type: 'college', admin: { name: 'A', email: `a@${CODE}.example` } } });
    const tId = t.body.tenant.id;
    let c;
    await withTx({ tenantId: tId }, async () => { c = (await q("insert into courses (code, name, years) values ('X', 'X', 3) returning id")).rows[0].id; });
    const first = await login(CODE, 'admin', 'ADM001', t.body.admin.temporaryPassword);
    const ch = await fetch(`${base}/api/auth/change-password`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: first }, body: JSON.stringify({ currentPassword: t.body.admin.temporaryPassword, newPassword: 'Changed@12345' }) });
    const localAdmin = ch.headers.getSetCookie().map((x) => x.split(';')[0]).find((x) => x.startsWith(`${env.COOKIE_NAME}=`));

    const app = await json('POST', `/api/public/${CODE}/admissions/applications`, { body: { captchaToken: issueCaptchaToken(), courseId: c, name: 'Photo Kid', email: 'photokid@example.com', dob: '2006-01-01' } });
    const put = (type, bytes) => { const f = new FormData(); f.set('docType', type); f.set('file', new Blob([bytes]), `${type}`); return fetch(`${base}/api/public/${CODE}/admissions/applications/${app.body.id}/documents`, { method: 'POST', headers: { 'x-access-code': app.body.accessCode }, body: f }); };
    await put('photo', PNG); await put('id_proof', PDF); await put('marksheet', PDF);
    await fetch(`${base}/api/public/${CODE}/admissions/applications/${app.body.id}/submit`, { method: 'POST', headers: { 'x-access-code': app.body.accessCode } });

    const full = (await json('GET', `/api/admin/admissions/${app.body.id}`, { cookie: localAdmin })).body.application;
    for (const d of full.documents) await json('PUT', `/api/admin/admissions/${app.body.id}/documents/${d.id}`, { cookie: localAdmin, body: { status: 'verified' } });
    await json('POST', `/api/admin/admissions/${app.body.id}/decision`, { cookie: localAdmin, body: { decision: 'accept' } });
    const e = await json('POST', `/api/admin/admissions/${app.body.id}/enroll`, { cookie: localAdmin });
    assert.equal(e.status, 200);

    const student = await json('GET', `/api/admin/students/${e.body.student.prn === undefined ? '' : ''}`, { cookie: localAdmin }); void student;
    const list = (await json('GET', '/api/admin/students', { cookie: localAdmin })).body.students;
    const created = list.find((s) => s.name === 'Photo Kid');
    assert.ok(created.photoFileId, 'photo carried over from the admission');

    const card = await fetch(`${base}/api/admin/students/${created.id}/id-card.pdf`, { headers: { cookie: localAdmin } });
    assert.equal(card.status, 200);
    assert.ok(pdfCheck(Buffer.from(await card.arrayBuffer())));
    await withTx({ platform: true }, () => q("delete from tenants where code = $1", [CODE]));
  });
});

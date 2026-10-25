/** The seven-step setup wizard, staff import, sample data and the vendor's view of setup progress - run with `npm test`. */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { env } from '../src/config/env.js';
import { createApp } from '../src/app.js';
import { closePool, q, withTx } from '../src/db/pool.js';
import { issueCaptchaToken } from '../src/services/captcha.service.js';
import { provisionTenant } from '../src/services/tenant.service.js';
import { createVendor } from '../src/db/vendor.js';
import { contrastWithWhite } from '../src/services/setup.service.js';

const RUN = `sw${Date.now().toString(36)}`;
const CODE = `${RUN}-college`;
const VENDOR = `${RUN}-owner`;
const VENDOR_PW = 'Setup-Wizard-Test-42';
let server; let base; let tenantId; let admin;

const call = async (method, path, cookie, body) => {
  const r = await fetch(`${base}${path}`, { method, headers: { cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  let b = null; try { b = await r.clone().json(); } catch { /* not json */ }
  return { status: r.status, body: b, res: r };
};
const upload = async (path, cookie, name, content, type = 'text/csv', fields = {}) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  fd.append('file', new Blob([content], { type }), name);
  const r = await fetch(`${base}${path}`, { method: 'POST', headers: { cookie }, body: fd });
  let b = null; try { b = await r.json(); } catch { /* not json */ }
  return { status: r.status, body: b };
};
async function login(role, identifier, password, tenantCode) {
  const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tenantCode, role, identifier, password, captchaToken: issueCaptchaToken() }) });
  assert.equal(r.status, 200, `${role} ${identifier} signs in`);
  return r.headers.getSetCookie().map((c) => c.split(';')[0]).find((c) => c.startsWith(`${env.COOKIE_NAME}=`));
}
const step = (w, key) => w.steps.find((s) => s.key === key);
const inTenant = (fn) => withTx({ tenantId }, fn);
// A real 1 x 1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

before(async () => {
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  const r = await withTx({ platform: true }, () => provisionTenant({
    code: CODE, name: 'Wizard Test College', type: 'college', plan: 'trial',
    admin: { name: 'Wizard Admin', email: `admin@${RUN}.example`, loginId: 'ADM001', password: 'Admin@12345' },
  }));
  tenantId = r.tenantId;
  admin = await login('admin', 'ADM001', 'Admin@12345', CODE);
});

after(async () => {
  try {
    await withTx({ platform: true }, async () => {
      await q('delete from notifications where to_email like $1', [`%@${RUN}.example`]);
      await q('delete from tenants where code = $1', [CODE]);
      await q("delete from users where role = 'super_admin' and lower(login_id) = $1", [VENDOR]);
    });
  } finally {
    await new Promise((r) => server.close(r));
    await closePool();
  }
});

describe('setup wizard', () => {
  it('starts a brand-new institute at step 1 with nothing done but the module-free steps', async () => {
    const { status, body: w } = await call('GET', '/api/admin/setup', admin);
    assert.equal(status, 200);
    assert.equal(w.total, 7);
    assert.deepEqual(w.steps.map((s) => s.key), ['profile', 'year', 'classes', 'subjects', 'fees', 'import', 'invite']);
    assert.equal(w.current, 'profile');
    assert.equal(step(w, 'profile').done, false);
    assert.equal(step(w, 'classes').done, false);
  });

  it('step 1: refuses a brand colour too light for white text, and says how to fix it', async () => {
    assert.ok(contrastWithWhite('#1E3A5F') > 10);
    const bad = await call('PUT', '/api/admin/setup/brand', admin, { brandColor: '#FFE066' });
    assert.equal(bad.status, 400);
    assert.match(bad.body.message, /darker shade/);
    assert.equal((await call('PUT', '/api/admin/setup/brand', admin, { brandColor: 'blue' })).status, 400);
    const ok = await call('PUT', '/api/admin/setup/brand', admin, { brandColor: '#0f766e' });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.brandColor, '#0F766E');
    const me = await call('GET', '/api/auth/me', admin);
    assert.equal(me.body.institute.brandColor, '#0F766E');
  });

  it('step 1: takes a PNG logo, serves it to the institute, and refuses anything that is not a picture', async () => {
    const bad = await upload('/api/admin/setup/logo', admin, 'logo.png', 'not a picture', 'image/png');
    assert.equal(bad.status, 400);
    assert.match(bad.body.message, /PNG or JPG/);
    const ok = await upload('/api/admin/setup/logo', admin, 'logo.png', PNG, 'image/png');
    assert.equal(ok.status, 200);
    assert.ok(ok.body.logoVersion);
    const img = await fetch(`${base}/api/me/logo`, { headers: { cookie: admin } });
    assert.equal(img.status, 200);
    assert.equal(img.headers.get('content-type'), 'image/png');
    assert.deepEqual(Buffer.from(await img.arrayBuffer()), PNG);
    assert.equal((await call('GET', '/api/auth/me', admin)).body.institute.logoVersion, ok.body.logoVersion);
  });

  it('keeps the wizard settings out of the institute details list', async () => {
    const { body } = await call('GET', '/api/admin/institute', admin);
    assert.equal(body.institute.details._setup, undefined);
    assert.equal(body.institute.setup.brandColor, '#0F766E');
    assert.equal(body.institute.setup.logo, undefined, 'the picture itself is not sent with the profile');
  });

  it('step 1 is done once address, phone and email are in', async () => {
    await call('PUT', '/api/admin/institute', admin, { name: 'Wizard Test College', address: '1 College Road', phone: '9876543210', email: `office@${RUN}.example` });
    const { body: w } = await call('GET', '/api/admin/setup', admin);
    assert.equal(step(w, 'profile').done, true);
    assert.equal(w.current, 'year');
  });

  it('step 2: checks the academic year dates and names it', async () => {
    assert.equal((await call('PUT', '/api/admin/setup/year', admin, { start: '2026-06-01', end: '2026-05-01' })).status, 400);
    assert.equal((await call('PUT', '/api/admin/setup/year', admin, { start: '2026-06-01', end: '2028-06-01' })).status, 400);
    const ok = await call('PUT', '/api/admin/setup/year', admin, { start: '2026-06-01', end: '2027-04-30' });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.academicYear.name, '2026-27');
    const { body: w } = await call('GET', '/api/admin/setup', admin);
    assert.equal(step(w, 'year').done, true);
  });

  let courseId; let teacherId;
  it('step 3: a class with its divisions', async () => {
    const c = await call('POST', '/api/admin/courses', admin, { code: 'BSC-CS', name: 'B.Sc. Computer Science', years: 3 });
    assert.equal(c.status, 201);
    courseId = c.body.course.id;
    const d = await call('PUT', `/api/admin/setup/divisions/${courseId}`, admin, { divisions: 'A, B, A, ' });
    assert.equal(d.status, 200);
    assert.deepEqual(d.body.divisions, ['A', 'B']);
    const { body: w } = await call('GET', '/api/admin/setup', admin);
    assert.equal(step(w, 'classes').done, true);
    assert.deepEqual(w.settings.divisions[courseId], ['A', 'B']);
  });

  it('step 4: adds a teacher and a subject, and refuses the same subject twice', async () => {
    const t = await call('POST', '/api/admin/setup/teachers', admin, { name: 'Priya Nair', email: `priya@${RUN}.example` });
    assert.equal(t.status, 201);
    teacherId = t.body.teacher.id;
    assert.equal((await call('POST', '/api/admin/setup/teachers', admin, { name: 'Priya again', email: `priya@${RUN}.example` })).status, 409);
    const s = await call('POST', '/api/admin/setup/subjects', admin, { courseId, name: 'Data Structures', teacherId });
    assert.equal(s.status, 201);
    const dup = await call('POST', '/api/admin/setup/subjects', admin, { courseId, name: 'data structures' });
    assert.equal(dup.status, 409);
    const { body: w } = await call('GET', '/api/admin/setup', admin);
    assert.equal(step(w, 'subjects').done, true);
    assert.equal(w.settings.subjects.length, 1);
  });

  it('step 5: a fee plan for the class', async () => {
    const f = await call('POST', '/api/admin/fees/structures', admin, { name: 'First year fees', courseId, academicYear: '2026-27', items: [{ label: 'Tuition', amount: 45000 }] });
    assert.equal(f.status, 201);
    const { body: w } = await call('GET', '/api/admin/setup', admin);
    assert.equal(step(w, 'fees').done, true);
  });

  it('step 6: the staff check-before-import explains each bad row and writes nothing', async () => {
    const tpl = await fetch(`${base}/api/admin/setup/staff-import/template.csv`, { headers: { cookie: admin } });
    assert.equal(tpl.status, 200);
    assert.match(await tpl.text(), /name,email,department,designation/);
    const csv = [
      'Name,Email,Department,Designation,Join Date',
      `Rahul Mehta,rahul@${RUN}.example,Office,Accountant,01/06/2025`,
      `,nobody@${RUN}.example,Office,Clerk,`,
      `Dup Person,rahul@${RUN}.example,Office,Clerk,`,
      `Anil Kumar,not-an-email,Science,Teacher,31/02/2025`,
      `Priya Copy,priya@${RUN}.example,Teaching,Teacher,`,
    ].join('\n');
    const p = await upload('/api/admin/setup/staff-import/preview', admin, 'staff.csv', csv);
    assert.equal(p.status, 200);
    assert.equal(p.body.summary.rows, 5);
    assert.equal(p.body.summary.ready, 1);
    const byLine = Object.fromEntries(p.body.rows.map((r) => [r.line, r]));
    assert.match(byLine[3].errors.join(' '), /Name is missing/);
    assert.match(byLine[4].errors.join(' '), /also on line 2/);
    assert.match(byLine[5].errors.join(' '), /not a valid email/);
    assert.match(byLine[5].errors.join(' '), /Join date/);
    assert.match(byLine[6].errors.join(' '), /already belongs/);
    assert.match(byLine[2].warnings.join(' '), /Department "Office" is new/);
    const before = await inTenant(() => q('select count(*)::int as n from employees'));
    assert.equal(before.rows[0].n, 1, 'the check wrote nothing');

    const refused = await upload('/api/admin/setup/staff-import', admin, 'staff.csv', csv);
    assert.equal(refused.status, 409);
    const done = await upload('/api/admin/setup/staff-import', admin, 'staff.csv', csv, 'text/csv', { skipInvalid: 'true' });
    assert.equal(done.status, 201);
    assert.equal(done.body.created, 1);
    assert.equal(done.body.skipped, 4);
    const { rows } = await inTenant(() => q("select e.join_date::text as j, d.name as dept from employees e join departments d on d.id = e.department_id where e.email = $1", [`rahul@${RUN}.example`]));
    assert.deepEqual(rows[0], { j: '2025-06-01', dept: 'Office' });
  });

  it('sample data: adds made-up students that do not count as real, and removes exactly them', async () => {
    const on = await call('PUT', '/api/admin/setup/sample-data', admin, { on: true });
    assert.equal(on.status, 200);
    let { body: w } = await call('GET', '/api/admin/setup', admin);
    assert.equal(w.settings.sampleData, true);
    assert.equal(w.counts.students, 0, 'sample students are not real students');
    assert.equal(w.counts.classes, 1, 'the Sample class is not a real class');
    assert.equal((await call('PUT', '/api/admin/setup/sample-data', admin, { on: true })).status, 200, 'switching it on twice is harmless');
    const { rows: [{ n }] } = await inTenant(() => q("select count(*)::int as n from students where student_code like 'SAMPLE-%'"));
    assert.equal(n, 8);
    const off = await call('PUT', '/api/admin/setup/sample-data', admin, { on: false });
    assert.equal(off.body.removed, 8);
    ({ body: w } = await call('GET', '/api/admin/setup', admin));
    assert.equal(w.settings.sampleData, false);
    const { rows: [left] } = await inTenant(() => q("select (select count(*) from students)::int as s, (select count(*) from courses where code = 'SAMPLE')::int as c"));
    assert.deepEqual(left, { s: 0, c: 0 });
  });

  it('step 6 is done with real students and staff', async () => {
    const csv = `name,email,course,section\nAsha Patil,asha@${RUN}.example,BSC-CS,A\n`;
    const r = await upload('/api/admin/students/import', admin, 'students.csv', csv, 'text/csv', { createLogins: 'false' });
    assert.equal(r.status, 201);
    const { body: w } = await call('GET', '/api/admin/setup', admin);
    assert.equal(step(w, 'import').done, true);
  });

  it('step 7: invites every staff member without a login, once', async () => {
    const r = await call('POST', '/api/admin/setup/invite', admin);
    assert.equal(r.status, 200);
    assert.equal(r.body.staff.invited, 2);
    const { rows } = await inTenant(() => q("select login_id, must_change_password as m from users where role = 'employee' order by login_id"));
    assert.equal(rows.length, 2);
    assert.ok(rows.every((u) => u.m));
    assert.equal((await call('POST', '/api/admin/setup/invite', admin)).body.staff.invited, 0, 'nobody is invited twice');
    const { body: w } = await call('GET', '/api/admin/setup', admin);
    assert.equal(w.complete, true);
    assert.equal(w.done, 7);
  });

  it('is for the institute admin only: a teacher cannot open it', async () => {
    const { rows: [u] } = await inTenant(() => q("select login_id from users where role = 'employee' limit 1"));
    await inTenant(async () => q("update users set password_hash = (select password_hash from users where role = 'admin' limit 1), must_change_password = false where login_id = $1", [u.login_id]));
    const teacher = await login('employee', u.login_id, 'Admin@12345', CODE);
    assert.equal((await call('GET', '/api/admin/setup', teacher)).status, 403);
    assert.equal((await fetch(`${base}/api/me/logo`, { headers: { cookie: teacher } })).status, 200, 'but every member sees the logo');
  });

  it('shows the vendor how far each client has got', async () => {
    await createVendor({ login: VENDOR, email: `owner@${RUN}.example`, password: VENDOR_PW });
    const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ role: 'super_admin', identifier: VENDOR, password: VENDOR_PW, captchaToken: issueCaptchaToken() }) });
    assert.equal(r.status, 200);
    const owner = r.headers.getSetCookie().map((c) => c.split(';')[0]).find((c) => c.startsWith(`${env.COOKIE_NAME}=`));
    const { body } = await call('GET', '/api/super-admin/tenants', owner);
    const mine = body.tenants.find((t) => t.code === CODE);
    assert.equal(mine.setup.done, 7);
    assert.equal(mine.setup.total, 7);
    const demo = body.tenants.find((t) => t.code === 'demo-college');
    if (demo) assert.ok(demo.setup.done >= 4, 'the demo college is mostly set up');
  });
});

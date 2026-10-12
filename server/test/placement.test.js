/** Placement - run with `npm test` (needs `npm run db:setup` first). */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import bcrypt from 'bcryptjs';
import { env } from '../src/config/env.js';
import { createApp } from '../src/app.js';
import { closePool, q, withTx } from '../src/db/pool.js';
import { issueCaptchaToken } from '../src/services/captcha.service.js';
import { addDays, toISO } from '../src/utils/dates.js';

let server; let base; let tenantId;
const json = async (method, path, { cookie, body } = {}) => {
  const r = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let b = null; try { b = await r.json(); } catch { /* empty */ }
  return { status: r.status, body: b };
};
async function login(tenantCode, role, identifier, password) {
  const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tenantCode, role, identifier, password, captchaToken: issueCaptchaToken() }) });
  assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
  return r.headers.getSetCookie().map((c) => c.split(';')[0]).find((c) => c.startsWith(`${env.COOKIE_NAME}=`));
}
const A = '/api/admin/placement';
const S = '/api/student/placement';
let admin; let schoolAdmin; let uniAdmin; let sIn; let sOut; let sLow; let courseId; let otherCourse;
let company; let drive;
const day = (n) => toISO(addDays(new Date(), n));

before(async () => {
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  admin = await login('demo-college', 'admin', 'ADM001', 'Admin@123');
  schoolAdmin = await login('demo-school', 'admin', 'ADM001', 'Admin@123');
  uniAdmin = await login('demo-university', 'admin', 'ADM001', 'Admin@123');
  tenantId = (await withTx({ platform: true }, () => q("select id from tenants where code = 'demo-college'"))).rows[0].id;
  await withTx({ tenantId }, async () => {
    courseId = (await q("insert into courses (code, name) values ('PLTEST', 'Placement Test Course') returning id")).rows[0].id;
    otherCourse = (await q("insert into courses (code, name) values ('PLOTH', 'Placement Other Course') returning id")).rows[0].id;
    const hash = bcrypt.hashSync('Student@123', 10);
    for (const [code, course, sem] of [['PL-IN', courseId, 6], ['PL-OUT', otherCourse, 6], ['PL-LOW', courseId, 2]]) {
      const { rows: [st] } = await q("insert into students (student_code, roll_no, name, email, course_id, semester, status) values ($1, $2, $3, $4, $5, $6, 'Active') returning id",
        [code, code, `Name ${code}`, `${code.toLowerCase()}@test.example`, course, sem]);
      await q("insert into users (role, login_id, email, name, password_hash, student_id) values ('student', $1, $2, $3, $4, $5)", [code, `${code.toLowerCase()}@test.example`, `Name ${code}`, hash, st.id]);
    }
  });
  sIn = await login('demo-college', 'student', 'PL-IN', 'Student@123');
  sOut = await login('demo-college', 'student', 'PL-OUT', 'Student@123');
  sLow = await login('demo-college', 'student', 'PL-LOW', 'Student@123');
});
after(async () => {
  await withTx({ tenantId }, async () => {
    await q("delete from placement_applications where student_id in (select id from students where student_code like 'PL-%')");
    await q("delete from placement_drives where title like 'PLT %'");
    await q("delete from placement_companies where name like 'PLT %'");
    await q("delete from users where login_id like 'PL-%'");
    await q("delete from students where student_code like 'PL-%'");
    await q("delete from courses where code in ('PLTEST', 'PLOTH')");
  });
  server.close(); await closePool();
});

describe('placement', () => {
  it('is off for schools and on for colleges', async () => {
    assert.equal((await json('GET', `${A}/stats`, { cookie: schoolAdmin })).status, 403);
    assert.equal((await json('GET', `${A}/stats`, { cookie: admin })).status, 200);
    assert.equal((await json('GET', `${A}/stats`, { cookie: uniAdmin })).status, 200);
  });

  it('students cannot use the office screens', async () => {
    assert.equal((await json('GET', `${A}/drives`, { cookie: sIn })).status, 403);
    assert.equal((await json('POST', `${A}/companies`, { cookie: sIn, body: { name: 'PLT Nope' } })).status, 403);
  });

  it('creates a company, rejects a duplicate and a blank name', async () => {
    const r = await json('POST', `${A}/companies`, { cookie: admin, body: { name: 'PLT Acme', industry: 'Software' } });
    assert.equal(r.status, 201); company = r.body.company;
    assert.equal((await json('POST', `${A}/companies`, { cookie: admin, body: { name: 'plt acme' } })).status, 409);
    assert.equal((await json('POST', `${A}/companies`, { cookie: admin, body: { name: '  ' } })).status, 400);
  });

  it('validates a drive', async () => {
    const base0 = { companyId: company.id, title: 'PLT Role', ctcLpa: 6 };
    assert.equal((await json('POST', `${A}/drives`, { cookie: admin, body: { ...base0, companyId: null } })).status, 400);
    assert.equal((await json('POST', `${A}/drives`, { cookie: admin, body: { ...base0, driveDate: day(2), applyBy: day(5) } })).status, 400);
    assert.equal((await json('POST', `${A}/drives`, { cookie: admin, body: { ...base0, courseIds: ['nope'] } })).status, 400);
    assert.equal((await json('POST', `${A}/drives`, { cookie: admin, body: { ...base0, ctcLpa: -1 } })).status, 400);
  });

  it('a draft drive is invisible to students until opened', async () => {
    const r = await json('POST', `${A}/drives`, { cookie: admin, body: { companyId: company.id, title: 'PLT Role', ctcLpa: 6.5, applyBy: day(5), driveDate: day(9), courseIds: [courseId], minSemester: 4 } });
    assert.equal(r.status, 201); drive = r.body.drive; assert.equal(drive.status, 'draft');
    assert.equal((await json('GET', S, { cookie: sIn })).body.drives.some((d) => d.id === drive.id), false);
    assert.equal((await json('POST', `${S}/${drive.id}/apply`, { cookie: sIn, body: {} })).status, 404);
    assert.equal((await json('POST', `${A}/drives/${drive.id}/open`, { cookie: admin })).status, 200);
    assert.equal((await json('POST', `${A}/drives/${drive.id}/open`, { cookie: admin })).status, 409);
  });

  it('shows eligibility reasons and blocks ineligible students', async () => {
    const find = async (c) => (await json('GET', S, { cookie: c })).body.drives.find((d) => d.id === drive.id);
    assert.equal((await find(sIn)).eligible, true);
    const out = await find(sOut); assert.equal(out.eligible, false); assert.match(out.reasons.join(' '), /course/);
    const low = await find(sLow); assert.equal(low.eligible, false); assert.match(low.reasons.join(' '), /semester 4/);
    assert.equal((await json('POST', `${S}/${drive.id}/apply`, { cookie: sOut, body: {} })).status, 403);
    assert.equal((await json('POST', `${S}/${drive.id}/apply`, { cookie: sLow, body: {} })).status, 403);
  });

  it('applies once, and a second application is refused', async () => {
    const r = await json('POST', `${S}/${drive.id}/apply`, { cookie: sIn, body: {} });
    assert.equal(r.status, 200);
    assert.equal(r.body.drives.find((d) => d.id === drive.id).myStatus, 'applied');
    assert.equal((await json('POST', `${S}/${drive.id}/apply`, { cookie: sIn, body: {} })).status, 409);
  });

  it('does not accept someone else\'s file as a resume', async () => {
    assert.equal((await json('POST', `${S}/${drive.id}/withdraw`, { cookie: sIn })).status, 200);
    const r = await json('POST', `${S}/${drive.id}/apply`, { cookie: sIn, body: { resumeFileId: '00000000-0000-4000-8000-000000000000' } });
    assert.equal(r.status, 400);
  });

  it('can withdraw and apply again', async () => {
    const r = await json('POST', `${S}/${drive.id}/apply`, { cookie: sIn, body: {} });
    assert.equal(r.status, 200);
    assert.equal((await json('POST', `${S}/${drive.id}/withdraw`, { cookie: sOut })).status, 404);
    assert.equal((await json('POST', `${S}/${drive.id}/withdraw`, { cookie: sIn })).status, 200);
    assert.equal((await json('POST', `${S}/${drive.id}/apply`, { cookie: sIn, body: {} })).status, 200);
  });

  it('moves an application through the pipeline and records the offer', async () => {
    const detail = (await json('GET', `${A}/drives/${drive.id}`, { cookie: admin })).body;
    const app = detail.applications.find((a) => a.studentCode === 'PL-IN');
    assert.ok(app);
    assert.equal((await json('PUT', `${A}/applications/${app.id}`, { cookie: admin, body: { status: 'bogus' } })).status, 400);
    assert.equal((await json('PUT', `${A}/applications/${app.id}`, { cookie: admin, body: { status: 'shortlisted' } })).status, 200);
    const sel = await json('PUT', `${A}/applications/${app.id}`, { cookie: admin, body: { status: 'selected', offerLpa: 6.5, note: 'Welcome aboard' } });
    assert.equal(sel.status, 200); assert.equal(sel.body.application.offerLpa, 6.5);
    const mine = (await json('GET', S, { cookie: sIn })).body.drives.find((d) => d.id === drive.id);
    assert.equal(mine.myStatus, 'selected'); assert.equal(mine.myOffer, 6.5);
    assert.equal((await json('POST', `${S}/${drive.id}/withdraw`, { cookie: sIn })).status, 409);
    const st = (await json('GET', `${A}/stats`, { cookie: admin })).body;
    assert.ok(st.placed >= 1); assert.ok(st.highest >= 6.5);
  });

  it('closed drives refuse applications and cannot be deleted once students applied', async () => {
    assert.equal((await json('POST', `${A}/drives/${drive.id}/close`, { cookie: admin })).status, 200);
    assert.equal((await json('POST', `${S}/${drive.id}/apply`, { cookie: sLow, body: {} })).status, 404);
    assert.equal((await json('DELETE', `${A}/drives/${drive.id}`, { cookie: admin })).status, 409);
    assert.equal((await json('DELETE', `${A}/companies/${company.id}`, { cookie: admin })).status, 409);
  });

  it('keeps one institute\'s placement data away from another', async () => {
    const list = (await json('GET', `${A}/companies`, { cookie: uniAdmin })).body.companies;
    assert.equal(list.some((c) => c.name === 'PLT Acme'), false);
    assert.equal((await json('GET', `${A}/drives/${drive.id}`, { cookie: uniAdmin })).status, 404);
    assert.equal((await json('PUT', `${A}/applications/${drive.id}`, { cookie: uniAdmin, body: { status: 'rejected' } })).status, 404);
  });
});

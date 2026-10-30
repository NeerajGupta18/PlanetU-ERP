/** The employee dashboard (Day 12F): only this person's work, and the same figures as the pages it links to. */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { env } from '../src/config/env.js';
import { createApp } from '../src/app.js';
import { closePool, q, withTx } from '../src/db/pool.js';
import { issueCaptchaToken } from '../src/services/captcha.service.js';

let server; let base; let tid;
const get = async (path, cookie) => {
  const r = await fetch(`${base}${path}`, { headers: cookie ? { cookie } : {} });
  let b = null; try { b = await r.json(); } catch { /* empty */ }
  return { status: r.status, body: b };
};
async function login(tenantCode, role, identifier, password) {
  const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tenantCode, role, identifier, password, captchaToken: issueCaptchaToken() }) });
  assert.equal(r.status, 200, identifier);
  return r.headers.getSetCookie().map((c) => c.split(';')[0]).find((c) => c.startsWith(`${env.COOKIE_NAME}=`));
}
const emp = (code) => login('demo-college', 'employee', code, 'Employee@123');

before(async () => {
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  tid = (await withTx({ platform: true }, () => q("select id from tenants where code = 'demo-college'"))).rows[0].id;
});
after(async () => {
  await new Promise((r) => server.close(r));
  await closePool();
});

describe('The figures equal the pages they link to', () => {
  it('lectures, papers, leave and notices', async () => {
    const c = await emp('EMP002');
    const d = (await get('/api/employee/dashboard', c)).body;
    const today = (await get('/api/employee/attendance/today', c)).body;
    assert.deepEqual(d.lectures.items.map((l) => l.slotId), today.lectures.map((l) => l.slotId));
    const papers = (await get('/api/employee/exams/papers', c)).body.papers.filter((p) => p.examStatus === 'draft');
    assert.deepEqual(d.papers.map((p) => p.id), papers.map((p) => p.id));
    for (const p of d.papers) assert.equal(p.entered, papers.find((x) => x.id === p.id).entered);
    const leave = (await get('/api/employee/leave', c)).body;
    assert.deepEqual(d.leave.balances.map((b) => b.left), leave.balances.map((b) => b.left));
    assert.equal(d.notices.unread, (await get('/api/employee/notices', c)).body.unread);
  });
});

describe('Only their own work', () => {
  it('a class teacher sees only their own class in Students who need a call', async () => {
    const { rows } = await withTx({ tenantId: tid }, () => q(
      `select c.id, c.name, e.emp_code as code from courses c join employees e on e.id = c.class_teacher_id
       where not exists (select 1 from staff_roles r where r.employee_id = e.id) order by c.code limit 1`,
    ));
    const c = await emp(rows[0].code);
    const d = (await get('/api/employee/dashboard', c)).body;
    const w = (await get('/api/assistants/attendance/overview', c)).body;
    assert.equal(d.needCall.count, w.counts.flagged, 'the same count as Attendance watch');
    for (const s of d.needCall.students) assert.equal(s.class, rows[0].name);
    for (const s of d.needCall.students) assert.equal(s.guardianPhone, undefined, 'no phone number on the dashboard');
  });
  it('someone who is not a class teacher has no such list', async () => {
    const d = (await get('/api/employee/dashboard', await emp('EMP008'))).body;
    assert.equal(d.needCall, null);
  });
  it('a teacher only ever sees their own lectures and papers', async () => {
    const c = await emp('EMP002');
    const me = (await withTx({ tenantId: tid }, () => q("select id from employees where emp_code = 'EMP002'"))).rows[0].id;
    const d = (await get('/api/employee/dashboard', c)).body;
    for (const l of d.lectures.items) assert.equal(l.facultyId, me);
    const theirs = await withTx({ tenantId: tid }, () => q('select id from exam_papers where employee_id = $1', [me]));
    const ids = new Set(theirs.rows.map((r) => r.id));
    for (const p of d.papers) assert.ok(ids.has(p.id));
  });
  it('approvals only appear for a role that decides them', async () => {
    assert.equal((await get('/api/employee/dashboard', await emp('EMP002'))).body.approvals, null, 'a plain teacher');
    const principal = (await get('/api/employee/dashboard', await emp('EMP007'))).body;
    assert.equal(typeof principal.approvals.count, 'number');
    const hod = (await get('/api/employee/dashboard', await emp('EMP011'))).body;
    assert.equal(hod.approvals.to, '/admin/leave', 'a head of department decides their department\'s leave');
  });
  it('is closed to students, parents and the signed out', async () => {
    assert.equal((await get('/api/employee/dashboard', await login('demo-college', 'student', 'STU2026001', 'Student@123'))).status, 403);
    assert.equal((await get('/api/employee/dashboard', await login('demo-college', 'parent', 'PAR001', 'Parent@123'))).status, 403);
    assert.equal((await get('/api/employee/dashboard')).status, 401);
  });
});

/** Staff roles and to-do lists - run with `npm test` (needs `npm run db:setup` first). */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
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
const status = async (method, path, cookie, body) => (await json(method, path, { cookie, body })).status;
async function login(tenantCode, role, identifier, password) {
  const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tenantCode, role, identifier, password, captchaToken: issueCaptchaToken() }) });
  assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
  return r.headers.getSetCookie().map((c) => c.split(';')[0]).find((c) => c.startsWith(`${env.COOKIE_NAME}=`));
}
const E = (code) => login('demo-college', 'employee', code, 'Employee@123');

let teacherA; let admin; let principal; let accountant; let librarian; let security; let hod; let teacher; let student; let uniAdmin;
let ids = {};
const cleanup = [];

before(async () => {
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  admin = await login('demo-college', 'admin', 'ADM001', 'Admin@123');
  uniAdmin = await login('demo-university', 'admin', 'ADM001', 'Admin@123');
  principal = await E('EMP007'); accountant = await E('EMP008'); librarian = await E('EMP009'); security = await E('EMP010');
  hod = await E('EMP011'); teacher = await E('EMP003'); teacherA = await E('EMP001');
  student = await login('demo-college', 'student', 'STU2026001', 'Student@123');
  tenantId = (await withTx({ platform: true }, () => q("select id from tenants where code = 'demo-college'"))).rows[0].id;
  await withTx({ tenantId }, async () => {
    for (const c of ['EMP003', 'EMP006', 'EMP002']) ids[c] = (await q('select id from employees where emp_code = $1', [c])).rows[0].id;
    ids.cs = (await q("select id from departments where name = 'Computer Science'")).rows[0].id;
    ids.maths = (await q("select id from departments where name = 'Mathematics'")).rows[0].id;
  });
});
after(async () => {
  await withTx({ tenantId }, async () => {
    await q("delete from staff_roles where employee_id = $1 and role <> 'hod'", [ids.EMP003]);
    for (const id of cleanup) await q('delete from leave_requests where id = $1', [id]);
  });
  server.close(); await closePool();
});

describe('staff roles: who may open which office page', () => {
  it('tells the app what each person may do', async () => {
    const me = (await json('GET', '/api/auth/me', { cookie: accountant })).body;
    assert.deepEqual(me.office.roles.map((r) => r.role), ['accountant']);
    assert.ok(me.office.areas.fees && me.office.areas.payroll && !me.office.areas.library);
    assert.equal((await json('GET', '/api/auth/me', { cookie: teacher })).body.office, null);
    assert.equal((await json('GET', '/api/auth/me', { cookie: admin })).body.office, null);
  });

  it('an accountant gets fees and payroll, the lookups, and the fee reports - nothing else', async () => {
    assert.equal(await status('GET', '/api/admin/fees/summary', accountant), 200);
    assert.equal(await status('GET', '/api/admin/payroll/runs', accountant), 200);
    assert.equal(await status('GET', '/api/admin/students?search=aa', accountant), 200);
    assert.equal(await status('GET', '/api/admin/courses', accountant), 200);
    for (const p of ['/api/admin/library/books', '/api/admin/visitors', '/api/admin/dashboard', '/api/admin/approvals', '/api/admin/institute', '/api/admin/staff-roles', '/api/admin/billing']) {
      assert.equal(await status('GET', p, accountant), 403, p);
    }
    assert.equal(await status('POST', '/api/admin/courses', accountant, { code: 'X', name: 'X' }), 403, 'lookups are read-only');
    const reports = (await json('GET', '/api/admin/reports', { cookie: accountant })).body.reports;
    assert.ok(reports.length > 0 && reports.every((r) => r.group === 'Fees'));
    assert.equal(await status('GET', '/api/admin/reports/students', accountant), 403);
    assert.equal(await status('GET', '/api/admin/reports/fee-dues', accountant), 200);
  });

  it('a librarian gets the library, gate security the visitor desk', async () => {
    assert.equal(await status('GET', '/api/admin/library/books', librarian), 200);
    assert.equal(await status('GET', '/api/admin/fees/summary', librarian), 403);
    assert.equal(await status('GET', '/api/admin/visitors', security), 200);
    assert.equal(await status('GET', '/api/admin/library/books', security), 403);
    assert.equal(await status('GET', '/api/admin/reports', security), 403, 'no report groups');
  });

  it('what staff do is recorded as staff in the audit log', async () => {
    const r = await json('POST', '/api/admin/visitors', { cookie: security, body: { visitorName: 'SR Audit Visitor', purpose: 'Delivery', checkIn: true } });
    assert.equal(r.status, 201);
    const { rows: [a] } = await withTx({ tenantId }, () => q("select actor_role from audit_log where action = 'visitor.walkin' and entity_id = $1", [r.body.visit.id]));
    assert.equal(a.actor_role, 'staff');
    await withTx({ tenantId }, () => q("delete from visitor_visits where visitor_name = 'SR Audit Visitor'"));
  });

  it('a principal runs the office but not the settings', async () => {
    for (const p of ['/api/admin/dashboard', '/api/admin/approvals', '/api/admin/fees/summary', '/api/admin/library/books', '/api/admin/leave', '/api/admin/reports']) {
      assert.equal(await status('GET', p, principal), 200, p);
    }
    for (const p of ['/api/admin/institute', '/api/admin/billing', '/api/admin/staff-roles', '/api/admin/audit']) assert.equal(await status('GET', p, principal), 403, p);
    assert.ok('approvals' in (await json('GET', '/api/me/notifications', { cookie: principal })).body.counts, 'the principal\'s bell counts approvals');
  });

  it('a teacher without staff roles and a student get no office pages at all', async () => {
    for (const c of [teacher, student]) {
      for (const p of ['/api/admin/students', '/api/admin/courses', '/api/admin/fees/summary']) assert.equal(await status('GET', p, c), 403, p);
    }
  });
});

describe('a head of department', () => {
  let csLeave; let mathsLeave;
  before(async () => {
    const day = (k) => toISO(addDays(new Date(), k));
    await withTx({ tenantId }, async () => {
      const type = (await q("select id from leave_types where name = 'Casual leave'")).rows[0].id;
      csLeave = (await q("insert into leave_requests (employee_id, leave_type_id, from_date, to_date, days, reason) values ($1, $2, $3, $3, 1, 'SR cs') returning id", [ids.EMP003, type, day(70)])).rows[0].id;
      mathsLeave = (await q("insert into leave_requests (employee_id, leave_type_id, from_date, to_date, days, reason) values ($1, $2, $3, $3, 1, 'SR maths') returning id", [ids.EMP006, type, day(71)])).rows[0].id;
    });
    cleanup.push(csLeave, mathsLeave);
  });

  it('sees and decides leave only for their own department', async () => {
    const list = (await json('GET', '/api/admin/leave?status=pending', { cookie: hod })).body.requests;
    assert.ok(list.some((r) => r.id === csLeave));
    assert.ok(!list.some((r) => r.id === mathsLeave));
    assert.equal(await status('PUT', `/api/admin/leave/${mathsLeave}`, hod, { decision: 'approve' }), 403);
    assert.equal(await status('PUT', `/api/admin/leave/${csLeave}`, hod, { decision: 'approve' }), 200);
    const bal = (await json('GET', '/api/admin/leave/balances', { cookie: hod })).body.employees;
    assert.ok(bal.length > 0 && !bal.some((e) => e.employeeId === ids.EMP006));
  });

  it('may only read attendance, for their department, and change nothing else', async () => {
    assert.equal(await status('GET', '/api/admin/attendance/report', hod), 200);
    assert.equal(await status('GET', '/api/admin/attendance/day', hod), 200);
    assert.equal(await status('PUT', '/api/admin/attendance/lecture', hod, {}), 403);
    assert.equal(await status('POST', '/api/admin/leave/types', hod, { name: 'X' }), 403);
    assert.equal(await status('POST', '/api/admin/leave', hod, {}), 403);
    assert.equal(await status('GET', '/api/admin/fees/summary', hod), 403);
    assert.equal(await status('GET', '/api/admin/reports/attendance', hod), 403, 'institute-wide reports are not for a department');
  });
});

describe('giving and removing staff roles', () => {
  it('only the admin manages roles; giving one opens its pages straight away', async () => {
    assert.equal(await status('POST', '/api/admin/staff-roles', principal, { employeeId: ids.EMP003, role: 'librarian' }), 403);
    assert.equal(await status('GET', '/api/admin/library/books', teacher), 403);
    const g = await json('POST', '/api/admin/staff-roles', { cookie: admin, body: { employeeId: ids.EMP003, role: 'librarian' } });
    assert.equal(g.status, 201);
    assert.ok(g.body.holders.some((h) => h.employeeId === ids.EMP003 && h.role === 'librarian'));
    assert.equal(await status('GET', '/api/admin/library/books', teacher), 200);
    assert.ok((await json('GET', '/api/me/notifications', { cookie: teacher })).body.items.some((n) => n.kind === 'staff_role'));
    assert.equal(await status('DELETE', `/api/admin/staff-roles/${ids.EMP003}/librarian`, admin), 200);
    assert.equal(await status('GET', '/api/admin/library/books', teacher), 403);
    assert.equal(await status('DELETE', `/api/admin/staff-roles/${ids.EMP003}/librarian`, admin), 404);
  });

  it('checks the details', async () => {
    assert.equal(await status('POST', '/api/admin/staff-roles', admin, { employeeId: ids.EMP003, role: 'king' }), 400);
    assert.equal(await status('POST', '/api/admin/staff-roles', admin, { employeeId: ids.EMP003, role: 'hod' }), 400, 'a head of department needs a department');
    assert.equal(await status('POST', '/api/admin/staff-roles', admin, { employeeId: ids.EMP002, role: 'hod', departmentId: ids.cs }), 409, 'one head per department');
    assert.equal(await status('POST', '/api/admin/staff-roles', admin, { employeeId: '00000000-0000-4000-8000-000000000000', role: 'librarian' }), 400);
    const other = (await json('GET', '/api/admin/staff-roles', { cookie: uniAdmin })).body.holders;
    assert.ok(!other.some((h) => h.employeeId === ids.EMP003), 'another institute sees only its own');
  });
});

describe('to-do lists', () => {
  it('a student sees what to hand in and pay, most urgent first', async () => {
    const r = await json('GET', '/api/student/todo', { cookie: student });
    assert.equal(r.status, 200);
    assert.ok(r.body.items.every((i) => i.title && i.link && ['bad', 'warn', 'info'].includes(i.tone)));
    const tones = r.body.items.map((i) => ({ bad: 0, warn: 1, info: 2 }[i.tone]));
    assert.deepEqual([...tones].sort(), tones);
  });

  it('a teacher sees lectures to mark, work to grade and marks to enter', async () => {
    const r = await json('GET', '/api/employee/todo', { cookie: teacherA });
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body.items) && Array.isArray(r.body.lowAttendance));
    assert.ok(r.body.items.some((i) => i.kind === 'marks' || i.kind === 'assignment'), JSON.stringify(r.body.items));
    assert.equal(await status('GET', '/api/student/todo', teacherA), 403);
  });
});

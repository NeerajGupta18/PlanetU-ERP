/**
 * Tenant-isolation tests. Run against a real PostgreSQL that has been set up with
 * `npm run db:setup` (migrations + the three demo tenants):
 *
 *   npm test -w server
 *
 * Part 1 talks to the database directly as the restricted application role and
 * proves Row Level Security + composite foreign keys do their job.
 * Part 2 drives the real HTTP API and proves one client can't reach another's data.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import jwt from 'jsonwebtoken';
import { env } from '../src/config/env.js';
import { createApp } from '../src/app.js';
import { closePool, q, withTx } from '../src/db/pool.js';
import { issueCaptchaToken } from '../src/services/captcha.service.js';

let server;
let base;
const tenants = {}; // code -> id

const inTenant = (code, fn) => withTx({ tenantId: tenants[code] }, fn);
const count = async (table) => (await q(`select count(*)::int as n from ${table}`)).rows[0].n;

async function login(tenantCode, role, identifier, password) {
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tenantCode, role, identifier, password, captchaToken: issueCaptchaToken() }),
  });
  const body = await res.json();
  const cookie = res.headers.getSetCookie().map((c) => c.split(';')[0]).find((c) => c.startsWith(`${env.COOKIE_NAME}=`));
  return { status: res.status, body, cookie };
}

async function call(cookie, method, path, body, headers = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, body: json };
}

const NEW_PASSWORD = 'Changed@12345';
const DEMO = ['demo-college', 'demo-school', 'demo-university'];
const sessions = {};

before(async () => {
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;

  const rows = (await withTx({ platform: true }, () => q("select id, code from tenants where settings->>'demo' = 'true'"))).rows;
  rows.forEach((r) => { tenants[r.code] = r.id; });
  assert.deepEqual(Object.keys(tenants).sort(), [...DEMO].sort(), 'run `npm run db:setup` first - the three demo tenants are missing');

  for (const code of DEMO) sessions[code] = (await login(code, 'admin', 'ADM001', 'Admin@123')).cookie;
  sessions.superAdmin = (await login('', 'super_admin', 'SA001', 'SuperAdmin@123')).cookie;
});

after(async () => {
  // remove anything the tests created
  await withTx({ platform: true }, () => q("delete from tenants where code like 'test-%'"));
  await new Promise((r) => server.close(r));
  await closePool();
});

/* =====================================================================
   1. Database level
   ===================================================================== */
describe('Row Level Security (database)', () => {
  it('the app role is neither superuser nor BYPASSRLS', async () => {
    const { rows: [r] } = await withTx({ platform: true }, () => q(
      'select rolsuper, rolbypassrls from pg_roles where rolname = current_user',
    ));
    assert.equal(r.rolsuper, false);
    assert.equal(r.rolbypassrls, false);
  });

  it('with NO tenant context every tenant table is empty (fails closed)', async () => {
    await withTx({}, async () => {
      for (const t of ['employees', 'students', 'departments', 'events', 'timetable_slots', 'notices', 'institute_profiles']) {
        assert.equal(await count(t), 0, `${t} leaked rows without a tenant`);
      }
    });
  });

  it('each tenant sees only its own rows', async () => {
    for (const code of DEMO) {
      await inTenant(code, async () => {
        const { rows } = await q('select distinct tenant_id from employees');
        assert.deepEqual(rows.map((r) => r.tenant_id), [tenants[code]]);
        assert.equal(await count('employees'), 6);
      });
    }
  });

  it('platform context can read the tenant list but NOT clients\' business data', async () => {
    await withTx({ platform: true }, async () => {
      assert.ok((await count('tenants')) >= 3);
      assert.equal(await count('employees'), 0);
      assert.equal(await count('students'), 0);
    });
  });

  it('a tenant cannot INSERT a row for another tenant', async () => {
    await assert.rejects(
      inTenant('demo-college', () => q('insert into departments (tenant_id, name) values ($1, $2)', [tenants['demo-school'], 'Injected'])),
      (e) => e.code === '42501',
    );
  });

  it('a tenant cannot UPDATE or DELETE another tenant\'s rows', async () => {
    await inTenant('demo-college', async () => {
      assert.equal((await q("update employees set name = 'HACKED' where tenant_id = $1", [tenants['demo-school']])).rowCount, 0);
      assert.equal((await q('delete from employees where tenant_id = $1', [tenants['demo-school']])).rowCount, 0);
    });
    await inTenant('demo-school', async () => {
      assert.equal(await count('employees'), 6);
      assert.equal((await q("select count(*)::int as n from employees where name = 'HACKED'")).rows[0].n, 0);
    });
  });

  it('composite foreign keys stop a row pointing at another tenant\'s parent', async () => {
    const other = await inTenant('demo-school', async () => ({
      dept: (await q('select id from departments limit 1')).rows[0].id,
      desig: (await q('select id from designations limit 1')).rows[0].id,
    }));
    await assert.rejects(
      inTenant('demo-college', () => q(
        `insert into employees (emp_code, name, email, department_id, designation_id) values ('X1', 'Cross', 'cross@x.example', $1, $2)`,
        [other.dept, other.desig],
      )),
      (e) => e.code === '23503',
    );
  });

  it('a tenant cannot read another tenant\'s users or tenant row', async () => {
    await inTenant('demo-college', async () => {
      assert.equal((await q('select count(*)::int as n from users where tenant_id = $1', [tenants['demo-school']])).rows[0].n, 0);
      const { rows } = await q('select code from tenants');
      assert.deepEqual(rows.map((r) => r.code), ['demo-college']);
    });
  });

  it('a tenant cannot switch itself into platform mode by writing the tenants table', async () => {
    await inTenant('demo-college', async () => {
      const r = await q("update tenants set plan = 'premium' where id = $1", [tenants['demo-college']]);
      assert.equal(r.rowCount, 0, 'tenant admin must not be able to change its own plan');
    });
  });

  // Needs a separate, restricted app role. In single-role mode (one database login, see DB_SINGLE_ROLE) the login that
  // runs the app also owns the tables, so this database-level guarantee does not exist there; Row Level Security does.
  it('the audit log is append-only for the app role', { skip: env.DB_SINGLE_ROLE && 'single-role mode: no separate app role' }, async () => {
    await inTenant('demo-college', async () => {
      await q("insert into audit_log (action) values ('test.append')");
    });
    await assert.rejects(inTenant('demo-college', () => q("update audit_log set action = 'tampered'")), (e) => e.code === '42501');
    await assert.rejects(inTenant('demo-college', () => q('delete from audit_log')), (e) => e.code === '42501');
  });
});

/* =====================================================================
   2. HTTP API
   ===================================================================== */
describe('Login is scoped to the institute', () => {
  it('the same login ID works in every institute - and lands in that institute\'s data', async () => {
    const names = [];
    for (const code of DEMO) {
      const r = await login(code, 'admin', 'ADM001', 'Admin@123');
      assert.equal(r.status, 200);
      assert.equal(r.body.tenant.code, code);
      names.push(r.body.institute.name);
    }
    assert.equal(new Set(names).size, 3);
  });

  it('a wrong or missing institute code is rejected with the generic message', async () => {
    const wrong = await login('no-such-school', 'admin', 'ADM001', 'Admin@123');
    assert.equal(wrong.status, 401);
    assert.match(wrong.body.message, /Incorrect institute code/);
    const missing = await login('', 'admin', 'ADM001', 'Admin@123');
    assert.equal(missing.status, 400);
  });

  it('a student of one institute cannot sign in through another', async () => {
    assert.equal((await login('demo-college', 'student', 'STU2026001', 'Student@123')).status, 200);
    assert.equal((await login('demo-school', 'student', 'STU2026001', 'Student@123')).status, 401);
  });

  it('super admin signs in without an institute code and has no tenant', async () => {
    const r = await login('', 'super_admin', 'SA001', 'SuperAdmin@123');
    assert.equal(r.status, 200);
    assert.equal(r.body.tenant, null);
  });
});

describe('API data isolation between institutes', () => {
  let college;
  let school;

  before(async () => {
    college = (await call(sessions['demo-college'], 'GET', '/api/admin/employees')).body.employees;
    school = (await call(sessions['demo-school'], 'GET', '/api/admin/employees')).body.employees;
  });

  it('each admin sees only their own employees', () => {
    assert.equal(college.length, 6);
    assert.equal(school.length, 6);
    const ids = new Set(college.map((e) => e.id));
    assert.ok(school.every((e) => !ids.has(e.id)));
    assert.ok(college.some((e) => e.name === 'Amandeep Kaur'));
    assert.ok(!school.some((e) => e.name === 'Amandeep Kaur'));
  });

  it('another institute\'s record id is simply "not found" for read, update and delete', async () => {
    const target = college[0];
    assert.equal((await call(sessions['demo-school'], 'PUT', `/api/admin/employees/${target.id}`, { name: 'HACKED' })).status, 404);
    assert.equal((await call(sessions['demo-school'], 'DELETE', `/api/admin/employees/${target.id}`)).status, 404);
    const after = (await call(sessions['demo-college'], 'GET', '/api/admin/employees')).body.employees;
    assert.equal(after.find((e) => e.id === target.id).name, target.name);
  });

  it('cannot reassign another institute\'s lecture', async () => {
    const slots = (await call(sessions['demo-college'], 'GET', '/api/admin/timetable/slots')).body.slots;
    const [emp] = school;
    const r = await call(sessions['demo-school'], 'PUT', '/api/admin/timetable/reassign',
      { slotId: slots[0].id, date: '2030-01-07', toEmployeeId: emp.id });
    assert.equal(r.status, 400);
  });

  it('cannot create a lecture slot pointing at another institute\'s course or employee', async () => {
    const collegeCourse = (await call(sessions['demo-college'], 'GET', '/api/admin/timetable/filters')).body.courses[0];
    const r = await call(sessions['demo-school'], 'POST', '/api/admin/timetable/slots', {
      courseId: collegeCourse.id, weekday: 1, start: '09:00', end: '10:00', subject: 'Injected', employeeId: school[0].id,
    });
    assert.equal(r.status, 400);
  });

  it('sending a tenant id in headers, query or body does not switch tenant', async () => {
    const r = await call(
      sessions['demo-school'], 'GET', `/api/admin/employees?tenantId=${tenants['demo-college']}&tenant_id=${tenants['demo-college']}`,
      undefined, { 'x-tenant-id': tenants['demo-college'], 'x-tenant': 'demo-college' },
    );
    assert.equal(r.status, 200);
    assert.ok(r.body.employees.every((e) => !college.some((c) => c.id === e.id)));
  });

  it('a token for one institute\'s tenant id with another institute\'s user id is rejected', async () => {
    const collegeAdmin = (await withTx({ tenantId: tenants['demo-college'] }, () => q("select id from users where role = 'admin'"))).rows[0].id;
    const forged = jwt.sign({ typ: 'session', role: 'admin', tid: tenants['demo-school'] }, env.JWT_SECRET, { subject: collegeAdmin });
    const r = await call(`${env.COOKIE_NAME}=${forged}`, 'GET', '/api/admin/employees');
    assert.equal(r.status, 401);
  });

  it('old-style / malformed session cookies are rejected, not crashed on', async () => {
    const legacy = jwt.sign({ typ: 'session', role: 'admin' }, env.JWT_SECRET, { subject: 'U-AD-1' });
    assert.equal((await call(`${env.COOKIE_NAME}=${legacy}`, 'GET', '/api/admin/employees')).status, 401);
    assert.equal((await call(`${env.COOKIE_NAME}=garbage`, 'GET', '/api/admin/employees')).status, 401);
  });

  it('a malformed id is a clean 404, never a database error', async () => {
    assert.equal((await call(sessions['demo-college'], 'DELETE', '/api/admin/employees/not-a-uuid')).status, 404);
  });

  it('students only see their own institute\'s public data', async () => {
    const s = (await login('demo-school', 'student', 'GPS2026001', 'Student@123')).cookie;
    const inst = (await call(s, 'GET', '/api/student/institute')).body.institute;
    assert.equal(inst.name, 'Greenfield Public School');
    for (const secret of ['stakeholders', 'authorizedPersons', 'documents', 'beneficiaries', 'stamp']) {
      assert.equal(secret in inst, false, `${secret} must not reach students`);
    }
    const dash = (await call(s, 'GET', '/api/student/dashboard')).body;
    assert.equal(dash.student.name, 'Ananya Kulkarni');
  });
});

describe('Role boundaries', () => {
  it('roles cannot cross into each other\'s areas', async () => {
    const student = (await login('demo-college', 'student', 'STU2026001', 'Student@123')).cookie;
    assert.equal((await call(student, 'GET', '/api/admin/dashboard')).status, 403);
    assert.equal((await call(student, 'GET', '/api/super-admin/tenants')).status, 403);
    assert.equal((await call(sessions['demo-college'], 'GET', '/api/super-admin/tenants')).status, 403);
    assert.equal((await call(sessions.superAdmin, 'GET', '/api/admin/employees')).status, 403);
    assert.equal((await call(null, 'GET', '/api/admin/dashboard')).status, 401);
  });
});

describe('Vendor console: provisioning and configuration', () => {
  const code = `test-${Date.now().toString(36)}`;
  let tenantId;
  let adminCookie;
  let tempPassword;

  it('creates a new institute with its first admin (one-time password)', async () => {
    const r = await call(sessions.superAdmin, 'POST', '/api/super-admin/tenants', {
      code, name: 'Test Academy', type: 'school', plan: 'trial',
      admin: { name: 'Test Admin', email: `admin@${code}.example` },
    });
    assert.equal(r.status, 201);
    tenantId = r.body.tenant.id;
    tempPassword = r.body.admin.temporaryPassword;
    assert.ok(tempPassword.length >= 10);
    assert.equal(r.body.tenant.terminology.course, 'Class'); // school preset applied
    assert.ok(r.body.tenant.modules.includes('timetable'));
  });

  it('rejects a duplicate institute code and bad input', async () => {
    const dup = await call(sessions.superAdmin, 'POST', '/api/super-admin/tenants', {
      code, name: 'Again', type: 'school', admin: { name: 'X', email: 'x@x.example' },
    });
    assert.equal(dup.status, 409);
    const bad = await call(sessions.superAdmin, 'POST', '/api/super-admin/tenants', {
      code: 'Bad Code!', name: 'X', type: 'school', admin: { name: 'X', email: 'x@x.example' },
    });
    assert.equal(bad.status, 400);
    const badType = await call(sessions.superAdmin, 'POST', '/api/super-admin/tenants', {
      code: `${code}-b`, name: 'X', type: 'bank', admin: { name: 'X', email: 'x@x.example' },
    });
    assert.equal(badType.status, 400);
  });

  it('the new admin signs in and starts with an empty institute - none of another client\'s data', async () => {
    const r = await login(code, 'admin', 'ADM001', tempPassword);
    assert.equal(r.status, 200);
    assert.equal(r.body.user.mustChangePassword, true);
    // on a temporary password nothing works until it is replaced
    assert.equal((await call(r.cookie, 'GET', '/api/admin/employees')).status, 403);
    const ch = await fetch(`${base}/api/auth/change-password`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie: r.cookie },
      body: JSON.stringify({ currentPassword: tempPassword, newPassword: NEW_PASSWORD }),
    });
    assert.equal(ch.status, 200);
    adminCookie = ch.headers.getSetCookie().map((c) => c.split(';')[0]).find((c) => c.startsWith(`${env.COOKIE_NAME}=`));
    assert.equal((await call(adminCookie, 'GET', '/api/admin/employees')).body.employees.length, 0);
    assert.equal((await call(adminCookie, 'GET', '/api/admin/departments')).body.departments.length, 0);
    assert.equal((await call(adminCookie, 'GET', '/api/admin/institute')).body.institute.name, 'Test Academy');
  });

  it('employee codes come from a per-institute number series, even under concurrency', async () => {
    const dept = (await call(adminCookie, 'POST', '/api/admin/departments', { name: 'Science' })).body.department;
    await call(adminCookie, 'POST', '/api/admin/designations', { name: 'Teacher', department: 'Science' });
    const made = await Promise.all([1, 2, 3, 4, 5].map((n) => call(adminCookie, 'POST', '/api/admin/employees', {
      name: `Teacher ${n}`, email: `t${n}@${code}.example`, department: dept.name, designation: 'Teacher',
    })));
    assert.ok(made.every((m) => m.status === 201), JSON.stringify(made.map((m) => m.body)));
    const codes = made.map((m) => m.body.employee.code).sort();
    assert.deepEqual(codes, ['EMP001', 'EMP002', 'EMP003', 'EMP004', 'EMP005']);
    // and the demo college's series is untouched
    const c = (await call(sessions['demo-college'], 'GET', '/api/admin/employees')).body.employees;
    assert.equal(c.length, 6);
  });

  it('module switches are enforced on the server for admin AND student routes', async () => {
    const off = await call(sessions.superAdmin, 'PUT', `/api/super-admin/tenants/${tenantId}`, {
      modules: ['institute', 'departments', 'employees', 'calendar'], // timetable off
    });
    assert.equal(off.status, 200);
    assert.equal(off.body.tenant.modules.includes('timetable'), false);

    // modules are read per request from the tenant row, so the existing session sees it immediately
    const blocked = await call(adminCookie, 'GET', '/api/admin/timetable/filters');
    assert.equal(blocked.status, 403);
    assert.equal(blocked.body.code, 'MODULE_DISABLED');
    assert.equal((await call(adminCookie, 'GET', '/api/admin/employees')).status, 200); // still on
    // other clients are unaffected
    assert.equal((await call(sessions['demo-college'], 'GET', '/api/admin/timetable/filters')).status, 200);
  });

  it('core modules can never be switched off', async () => {
    const r = await call(sessions.superAdmin, 'PUT', `/api/super-admin/tenants/${tenantId}`, { modules: [] });
    for (const core of ['institute', 'departments', 'employees']) assert.ok(r.body.tenant.modules.includes(core));
  });

  it('suspending an institute blocks its sessions and new sign-ins - and only that institute', async () => {
    await call(sessions.superAdmin, 'PUT', `/api/super-admin/tenants/${tenantId}`, { status: 'suspended' });
    assert.equal((await call(adminCookie, 'GET', '/api/admin/employees')).status, 403);
    assert.equal((await login(code, 'admin', 'ADM001', NEW_PASSWORD)).status, 403);
    assert.equal((await call(sessions['demo-college'], 'GET', '/api/admin/employees')).status, 200);

    await call(sessions.superAdmin, 'PUT', `/api/super-admin/tenants/${tenantId}`, { status: 'active' });
    assert.equal((await call(adminCookie, 'GET', '/api/admin/employees')).status, 200);
  });

  it('the vendor can reset an institute admin\'s password', async () => {
    const r = await call(sessions.superAdmin, 'POST', `/api/super-admin/tenants/${tenantId}/reset-admin-password`);
    assert.equal(r.status, 200);
    assert.equal((await login(code, 'admin', 'ADM001', NEW_PASSWORD)).status, 401); // the old password is dead
    assert.equal((await login(code, 'admin', 'ADM001', r.body.admin.temporaryPassword)).status, 200);
  });

  it('vendor actions are written to the audit trail', async () => {
    const entries = (await withTx({ platform: true }, () => q(
      "select action from audit_log where tenant_id is null and action like 'tenant.%'",
    ))).rows.map((r) => r.action);
    for (const a of ['tenant.create', 'tenant.update', 'tenant.admin_password_reset']) assert.ok(entries.includes(a), a);
  });

  it('the vendor console lists institutes with counts but is the only route to them', async () => {
    const list = (await call(sessions.superAdmin, 'GET', '/api/super-admin/tenants')).body.tenants;
    const college = list.find((t) => t.code === 'demo-college');
    assert.equal(college.employees, 6);
    assert.equal(college.students, 3);
  });
});

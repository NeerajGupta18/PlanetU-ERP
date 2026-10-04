/** Classes / courses / programmes: an institute admin can create them, and cannot delete one that is in use. */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { env } from '../src/config/env.js';
import { createApp } from '../src/app.js';
import { closePool, q, withTx } from '../src/db/pool.js';
import { issueCaptchaToken } from '../src/services/captcha.service.js';
import { COURSE_DEPENDANTS } from '../src/services/courses.service.js';

let server; let base; let college; let school; let emp; let stu; let tid; let deptId; let schoolDeptId;
const json = async (method, path, { cookie, body } = {}) => {
  const r = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let b = null; try { b = await r.clone().json(); } catch { /* not json */ }
  return { status: r.status, body: b };
};
async function login(tenantCode, role, identifier, password) {
  const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tenantCode, role, identifier, password, captchaToken: issueCaptchaToken() }) });
  assert.equal(r.status, 200);
  return r.headers.getSetCookie().map((c) => c.split(';')[0]).find((c) => c.startsWith(`${env.COOKIE_NAME}=`));
}
const make = (cookie, o = {}) => json('POST', '/api/admin/courses', { cookie, body: { code: 'ZZT-1', name: 'Test Course', fullName: 'Test Course Full Name', years: 3, ...o } });

before(async () => {
  server = createApp().listen(0); base = `http://127.0.0.1:${server.address().port}`;
  college = await login('demo-college', 'admin', 'ADM001', 'Admin@123');
  school = await login('demo-school', 'admin', 'ADM001', 'Admin@123');
  emp = await login('demo-college', 'employee', 'EMP001', 'Employee@123');
  stu = await login('demo-college', 'student', 'STU2026001', 'Student@123');
  tid = (await withTx({ platform: true }, () => q("select id from tenants where code = 'demo-college'"))).rows[0].id;
  deptId = (await json('GET', '/api/admin/departments', { cookie: college })).body.departments[0].id;
  schoolDeptId = (await json('GET', '/api/admin/departments', { cookie: school })).body.departments[0].id;
});
after(async () => {
  try {
    for (const t of ['demo-college', 'demo-school']) {
      const id = (await withTx({ platform: true }, () => q('select id from tenants where code = $1', [t]))).rows[0].id;
      await withTx({ tenantId: id }, async () => {
        await q("delete from students where student_code like 'ZZT-%'");
        await q("delete from quizzes where title like 'ZZT %'");
        await q("delete from timetable_slots where subject like 'ZZT %'");
        await q("delete from courses where code like 'ZZT-%'");
      });
    }
  } finally { await new Promise((r) => server.close(r)); await closePool(); }
});

describe('Who can manage courses', () => {
  it('only the institute admin', async () => {
    assert.equal((await json('GET', '/api/admin/courses')).status, 401);
    assert.equal((await json('GET', '/api/admin/courses', { cookie: stu })).status, 403);
    assert.equal((await json('GET', '/api/admin/courses', { cookie: emp })).status, 403);
    assert.equal((await json('POST', '/api/admin/courses', { cookie: emp, body: { code: 'X', name: 'X' } })).status, 403);
  });
});

describe('Creating and editing', () => {
  it('creates a course that then appears in the list and in the public admission form', async () => {
    const r = await make(college, { code: 'ZZT-A', departmentId: deptId });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.deepEqual([r.body.course.code, r.body.course.name, r.body.course.years, r.body.course.students, r.body.course.departmentId], ['ZZT-A', 'Test Course', 3, 0, deptId]);
    assert.ok(r.body.course.departmentName, 'the department name is included');
    const list = (await json('GET', '/api/admin/courses', { cookie: college })).body.courses;
    assert.ok(list.some((c) => c.code === 'ZZT-A'));
    const pub = await json('GET', '/api/public/demo-college/admissions/info');
    assert.equal(pub.status, 200);
    assert.ok(pub.body.courses.some((c) => c.id === r.body.course.id && c.name === 'Test Course'), 'the applicant can pick it on the public form: this is what a new institute could not do before');
  });

  it('validates what is typed', async () => {
    const bad = (o, re) => make(college, { code: 'ZZT-V', ...o }).then((r) => { assert.equal(r.status, 400, JSON.stringify(o)); if (re) assert.match(r.body.message, re); });
    await bad({ code: '' }, /Code is required/);
    await bad({ code: '   ' }, /Code is required/);
    await bad({ code: 'ZZT/../x' }, /Code may use/);
    await bad({ code: '-leading' }, /must start/);
    await bad({ code: 'x'.repeat(21) }, /too long/);
    await bad({ name: '' }, /Name is required/);
    await bad({ name: 'n'.repeat(81) }, /too long/);
    await bad({ fullName: 'n'.repeat(151) }, /too long/);
    await bad({ years: 0 }, /1 to 8/);
    await bad({ years: 9 }, /1 to 8/);
    await bad({ years: 2.5 }, /whole number/);
    await bad({ years: 'many' }, /whole number/);
    await bad({ departmentId: '00000000-0000-4000-8000-000000000000' }, /Choose a department/);
    await bad({ departmentId: 'nope' }, /Choose a department/);
    await bad({ departmentId: schoolDeptId }, /Choose a department/); // another institute's department
    const ok = await make(college, { code: '  ZZT-Trim  ', name: '  Spaced  ' });
    assert.deepEqual([ok.status, ok.body.course.code, ok.body.course.name], [201, 'ZZT-Trim', 'Spaced'], 'surrounding spaces are trimmed');
  });

  it('refuses a duplicate code (capital letters do not count), but another institute may use the same code', async () => {
    await make(college, { code: 'ZZT-Dup' });
    const again = await make(college, { code: 'zzt-DUP' });
    assert.equal(again.status, 409);
    assert.match(again.body.message, /already uses that code/);
    assert.equal((await make(school, { code: 'ZZT-Dup' })).status, 201, 'a different institute has its own codes');
  });

  it('edits a course, keeps its identity, and refuses to take another course\'s code', async () => {
    const a = (await make(college, { code: 'ZZT-E1', name: 'Before' })).body.course;
    const b = (await make(college, { code: 'ZZT-E2' })).body.course;
    const u = await json('PUT', `/api/admin/courses/${a.id}`, { cookie: college, body: { name: 'After', years: 4, departmentId: deptId } });
    assert.equal(u.status, 200, JSON.stringify(u.body));
    assert.deepEqual([u.body.course.id, u.body.course.code, u.body.course.name, u.body.course.years], [a.id, 'ZZT-E1', 'After', 4], 'only what was sent changes');
    assert.equal((await json('PUT', `/api/admin/courses/${a.id}`, { cookie: college, body: { code: b.code } })).status, 409);
    assert.equal((await json('PUT', `/api/admin/courses/${a.id}`, { cookie: college, body: { departmentId: null } })).body.course.departmentId, null, 'a department can be cleared');
    assert.equal((await json('PUT', '/api/admin/courses/00000000-0000-4000-8000-000000000000', { cookie: college, body: { name: 'x' } })).status, 404);
    assert.equal((await json('PUT', '/api/admin/courses/not-a-uuid', { cookie: college, body: { name: 'x' } })).status, 404);
  });

  it("another institute cannot see, edit or delete this institute's courses", async () => {
    const c = (await make(college, { code: 'ZZT-Iso' })).body.course;
    assert.ok(!(await json('GET', '/api/admin/courses', { cookie: school })).body.courses.some((x) => x.id === c.id));
    assert.equal((await json('PUT', `/api/admin/courses/${c.id}`, { cookie: school, body: { name: 'hijack' } })).status, 404);
    assert.equal((await json('DELETE', `/api/admin/courses/${c.id}`, { cookie: school })).status, 404);
    assert.equal((await json('GET', '/api/admin/courses', { cookie: college })).body.courses.find((x) => x.id === c.id).name, 'Test Course', 'untouched');
  });

  it('records who did it in the audit log', async () => {
    const c = (await make(college, { code: 'ZZT-Aud' })).body.course;
    await json('DELETE', `/api/admin/courses/${c.id}`, { cookie: college });
    const rows = (await withTx({ tenantId: tid }, () => q("select action from audit_log where entity = 'course' and entity_id = $1 order by at", [c.id]))).rows.map((r) => r.action);
    assert.deepEqual(rows, ['course.create', 'course.delete']);
  });
});

describe('Deleting', () => {
  it('removes an unused course, once', async () => {
    const c = (await make(college, { code: 'ZZT-Del' })).body.course;
    assert.equal((await json('DELETE', `/api/admin/courses/${c.id}`, { cookie: college })).status, 200);
    assert.equal((await json('DELETE', `/api/admin/courses/${c.id}`, { cookie: college })).status, 404);
  });

  it('refuses to delete a course that students, a timetable or quizzes still use - and loses nothing', async () => {
    const c = (await make(college, { code: 'ZZT-Use' })).body.course;
    const del = () => json('DELETE', `/api/admin/courses/${c.id}`, { cookie: college });
    const count = async (sql) => (await withTx({ tenantId: tid }, () => q(sql, [c.id]))).rows[0].n;

    await withTx({ tenantId: tid }, () => q("insert into students (student_code, name, email, course_id, semester, section) values ('ZZT-S1', 'Zed Student', 'zzt-s1@x.example', $1, 1, 'A')", [c.id]));
    let r = await del();
    assert.equal(r.status, 409); assert.match(r.body.message, /1 student\b/);

    const empId = (await withTx({ tenantId: tid }, () => q("select id from employees where emp_code = 'EMP001'"))).rows[0].id;
    await withTx({ tenantId: tid }, () => q("insert into timetable_slots (course_id, weekday, start_time, end_time, subject, employee_id) values ($1, 1, '22:00', '22:30', 'ZZT Subject', $2)", [c.id, empId]));
    await withTx({ tenantId: tid }, () => q("insert into quizzes (title, subject, course_id, semester) values ('ZZT Quiz', 'ZZT Subject', $1, 1)", [c.id]));
    r = await del();
    assert.equal(r.status, 409);
    assert.match(r.body.message, /1 student/); assert.match(r.body.message, /1 timetable slot/); assert.match(r.body.message, /1 quiz\b/);
    assert.equal(await count('select count(*)::int as n from students where course_id = $1'), 1, 'the student is still there');
    assert.equal(await count('select count(*)::int as n from quizzes where course_id = $1'), 1, 'the quiz is still there');
    assert.equal(await count('select count(*)::int as n from timetable_slots where course_id = $1'), 1, 'the timetable slot is still there');
    assert.equal((await json('GET', '/api/admin/courses', { cookie: college })).body.courses.find((x) => x.id === c.id).students, 1, 'and the list shows the student count');

    await withTx({ tenantId: tid }, async () => { await q("delete from students where student_code = 'ZZT-S1'"); await q("delete from quizzes where title = 'ZZT Quiz'"); await q("delete from timetable_slots where subject = 'ZZT Subject'"); });
    assert.equal((await del()).status, 200, 'once nothing uses it, it can go');
  });

  it("the delete check covers EVERY table that references a course (fails when a future migration adds one)", async () => {
    const { rows } = await withTx({ tenantId: tid }, () => q(`select c.conrelid::regclass::text as t, a.attname as col from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey) and a.attname <> 'tenant_id'
      where c.contype = 'f' and c.confrelid = 'courses'::regclass`));
    const inDb = new Set(rows.map((r) => `${r.t}.${r.col}`));
    const inCode = new Set(COURSE_DEPENDANTS.map(([t, col]) => `${t}.${col}`));
    assert.deepEqual([...inDb].filter((x) => !inCode.has(x)), [], 'a table references courses but the delete check does not know about it: add it to COURSE_DEPENDANTS');
    assert.deepEqual([...inCode].filter((x) => !inDb.has(x)), [], 'COURSE_DEPENDANTS lists something that is not a real reference');
  });
});

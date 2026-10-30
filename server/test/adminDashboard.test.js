/** The Institute Admin dashboard (Day 12B): every figure must agree with its detail page. Run with `npm test` (needs `npm run db:setup` first). */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { env } from '../src/config/env.js';
import { createApp } from '../src/app.js';
import { closePool, q, withTx } from '../src/db/pool.js';
import { issueCaptchaToken } from '../src/services/captcha.service.js';
import { pulseScore } from '../src/services/adminDashboard.service.js';

let server; let base; let admin; let principal; let schoolAdmin; let teacher; let student; let parent; let d; let o;
const get = async (path, cookie) => {
  const r = await fetch(`${base}${path}`, { headers: cookie ? { cookie } : {} });
  let b = null; try { b = await r.json(); } catch { /* empty */ }
  return { status: r.status, body: b };
};
async function login(tenantCode, role, identifier, password) {
  const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tenantCode, role, identifier, password, captchaToken: issueCaptchaToken() }) });
  assert.equal(r.status, 200);
  return r.headers.getSetCookie().map((c) => c.split(';')[0]).find((c) => c.startsWith(`${env.COOKIE_NAME}=`));
}

before(async () => {
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  admin = await login('demo-college', 'admin', 'ADM001', 'Admin@123');
  principal = await login('demo-college', 'employee', 'EMP007', 'Employee@123');
  teacher = await login('demo-college', 'employee', 'EMP001', 'Employee@123');
  schoolAdmin = await login('demo-school', 'admin', 'ADM001', 'Admin@123');
  student = await login('demo-college', 'student', 'STU2026001', 'Student@123');
  parent = await login('demo-college', 'parent', 'PAR001', 'Parent@123');
  const r = await get('/api/admin/dashboard/overview?fresh=1', admin);
  assert.equal(r.status, 200);
  d = r.body; o = d.overview;
});
after(async () => {
  await new Promise((r) => server.close(r));
  await closePool();
});

describe('Dashboard figures reconcile with their detail pages', () => {
  it('total students and active equal the Students page', async () => {
    const all = (await get('/api/admin/students', admin)).body.students;
    assert.equal(o.glance.students, all.length);
    assert.equal(o.glance.active, all.filter((s) => s.status === 'Active').length);
  });
  it('employees equal the Employees page, split into teaching and non-teaching', async () => {
    const all = (await get('/api/admin/employees', admin)).body.employees;
    assert.equal(o.glance.employees, all.length);
    assert.equal(o.glance.faculty + o.glance.nonTeaching, all.length);
    assert.ok(o.glance.faculty > 0 && o.glance.nonTeaching > 0);
  });
  it('departments and divisions equal the Departments and Courses pages', async () => {
    assert.equal(o.glance.departments, (await get('/api/admin/departments', admin)).body.departments.length);
    assert.equal(o.glance.courses, (await get('/api/admin/courses', admin)).body.courses.length);
    assert.equal(o.glance.divisions, 3, 'BCA has divisions A, B and C');
    assert.equal(o.glance.programmes, 1, 'and they are one programme');
  });
  it('fees collected, outstanding and overdue equal the Fees page', async () => {
    const f = (await get('/api/admin/fees/summary', admin)).body;
    const t = f.totals || f;
    assert.equal(o.money.collectedToday, t.collectedToday);
    assert.equal(o.money.thisMonth, t.collectedThisMonth);
    assert.equal(o.money.outstanding, t.outstanding);
    assert.equal(o.money.overdue, t.overdue);
    assert.equal(o.money.studentsOverdue, t.studentsOverdue);
  });
  it('collected today equals the day-end summary', async () => {
    assert.equal(o.money.collectedToday, (await get('/api/admin/fees/day-end', admin)).body.total);
  });
  it('billed less collected is exactly what is outstanding, and the rate is collected over billed', () => {
    assert.equal(Math.round(o.money.billed - o.money.allocated), Math.round(o.money.outstanding));
    assert.equal(o.money.collectionRate, Math.round((o.money.allocated / o.money.billed) * 1000) / 10);
  });
  it('the six months add up to the payments on record and billed uses the fee items', async () => {
    assert.equal(o.money.months.length, 6);
    const tid = (await withTx({ platform: true }, () => q("select id from tenants where code = 'demo-college'"))).rows[0].id;
    const { rows: [t] } = await withTx({ tenantId: tid }, () => q("select to_char(paid_at, 'YYYY-MM') as m, sum(amount)::float8 as s from payments group by 1 order by 1 desc limit 1"));
    assert.equal(o.money.months.at(-1).collected, t.s);
  });
  it('attendance on any day equals the Attendance report for that day', async () => {
    const day = o.attendance.latest;
    assert.ok(day, 'the demo has marked days');
    const r = (await get(`/api/admin/attendance/report?from=${day.day}&to=${day.day}`, admin)).body;
    const done = r.students.reduce((a, s) => a + s.attended, 0); const total = r.students.reduce((a, s) => a + s.total, 0);
    assert.equal(day.pct, Math.round((done / total) * 1000) / 10);
  });
  it('students below 75% equal the Attendance report', async () => {
    const r = (await get('/api/admin/attendance/report?below=75', admin)).body;
    const low = r.students.filter((s) => s.total >= 3 && s.pct < 75);
    assert.equal(o.attendance.below.count, low.length);
  });
  it('latest exam average and pass rate equal the exam results page', async () => {
    const l = o.academics.latest;
    const r = (await get(`/api/admin/exams/${l.id}/results`, admin)).body.stats;
    assert.equal(l.average, r.average);
    assert.equal(l.passRate, r.passRate);
  });
  it('each class row in the department grid agrees with that class in the results page', async () => {
    const klass = o.departments.flatMap((g) => g.classes).find((c) => c.results !== null);
    const exams = (await get('/api/admin/exams', admin)).body.exams.filter((e) => e.status === 'published' && e.courseId === klass.id);
    const r = (await get(`/api/admin/exams/${exams[0].id}/results`, admin)).body.stats;
    assert.equal(klass.results, r.passRate);
  });
  it('approvals equal the Approvals page, and the funnel equals the Admissions board', async () => {
    const a = (await get('/api/admin/approvals', admin)).body;
    assert.equal(o.decisions.waiting.approvals, (a.items || a.approvals || []).length);
    const b = (await get('/api/admin/admissions/board', admin)).body;
    for (const s of o.decisions.funnel) assert.equal(s.count, b.counts[s.stage], s.stage);
    assert.ok(o.decisions.funnel.filter((s) => s.count > 0).length >= 4, 'the demo funnel has several stages filled');
  });
});

describe('The Year Journey and Pulse', () => {
  it('has the seven stages in order, each with a status, one number and a next step', () => {
    assert.deepEqual(o.journey.stages.map((s) => s.key), ['admissions', 'fees', 'timetable', 'attendance', 'exams', 'results', 'certificates']);
    for (const s of o.journey.stages) {
      assert.ok(['not_started', 'in_progress', 'done'].includes(s.status));
      assert.ok(s.number && s.next && s.to.startsWith('/admin/'));
    }
    assert.ok(o.journey.progress >= 0 && o.journey.progress <= 100);
  });
  it('the score is the weighted average of its parts, and a missing part shares its weight', () => {
    assert.equal(pulseScore({ attendance: 80, fees: 50, approvals: 100, exams: 50 }), 69);
    assert.equal(pulseScore({ attendance: 80, fees: null, approvals: 100, exams: null }), 88);
    assert.equal(pulseScore({ attendance: null, fees: null, approvals: null, exams: null }), null);
    const w = Object.fromEntries(o.pulse.parts.map((p) => [p.key, p.value]));
    assert.equal(o.pulse.score, pulseScore(w));
    assert.ok(o.pulse.score >= 0 && o.pulse.score <= 100);
  });
});

describe('Who sees it, and the cache', () => {
  it('the admin and principal can open it; nobody else', async () => {
    assert.equal((await get('/api/admin/dashboard/overview', principal)).status, 200);
    for (const c of [teacher, student, parent]) assert.equal((await get('/api/admin/dashboard/overview', c)).status, 403);
    assert.equal((await get('/api/admin/dashboard/overview')).status, 401);
  });
  it('is never shared between institutes or users', async () => {
    const other = (await get('/api/admin/dashboard/overview', schoolAdmin)).body;
    assert.notEqual(other.institute.name, d.institute.name);
    const again = (await get('/api/admin/dashboard/overview', admin)).body;
    assert.equal(again.institute.name, d.institute.name);
    assert.equal(again.generatedAt, d.generatedAt, 'a second look within a minute uses the short memory');
    assert.notEqual((await get('/api/admin/dashboard/overview', principal)).body.generatedAt, undefined);
  });
  it('the refresh button skips the short memory', async () => {
    await new Promise((r) => setTimeout(r, 5));
    const r = (await get('/api/admin/dashboard/overview?fresh=1', admin)).body;
    assert.notEqual(r.generatedAt, d.generatedAt);
  });
});

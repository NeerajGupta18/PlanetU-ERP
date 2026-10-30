/** The student dashboard (Day 12G): the student's own figures only, equal to their detail pages. */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { env } from '../src/config/env.js';
import { createApp } from '../src/app.js';
import { closePool, q, withTx } from '../src/db/pool.js';
import { issueCaptchaToken } from '../src/services/captcha.service.js';
import { whatIfAttendance } from '../../client/src/utils/kpi.js';

let server; let base; let a; let c;
const get = async (path, cookie) => {
  const r = await fetch(`${base}${path}`, { headers: cookie ? { cookie } : {} });
  let b = null; try { b = await r.json(); } catch { /* empty */ }
  return { status: r.status, body: b };
};
async function login(identifier) {
  const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tenantCode: 'demo-college', role: 'student', identifier, password: 'Student@123', captchaToken: issueCaptchaToken() }) });
  assert.equal(r.status, 200);
  return r.headers.getSetCookie().map((x) => x.split(';')[0]).find((x) => x.startsWith(`${env.COOKIE_NAME}=`));
}
before(async () => {
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  a = await login('STU2026001');
  c = await login('STU2026003');
});
after(async () => {
  await new Promise((r) => server.close(r));
  await closePool();
});

describe('The student dashboard', () => {
  it('its figures equal the attendance, fees and results pages', async () => {
    const d = (await get('/api/student/dashboard', a)).body;
    const att = (await get('/api/student/attendance', a)).body;
    assert.equal(d.stats.attendance, att.overall);
    assert.equal(d.attendanceGuide.attended, att.attended);
    assert.equal(d.attendanceGuide.total, att.total);
    assert.deepEqual(d.attendance.map((s) => s.pct), att.subjects.map((s) => s.pct));
    const fees = (await get('/api/student/fees', a)).body;
    assert.equal(d.fees.outstanding, fees.summary.outstanding);
    assert.equal(d.fees.paid, fees.summary.paid);
    const res = (await get('/api/student/results', a)).body;
    assert.equal(d.latestResult.pct, res.exams[0].pct);
    assert.deepEqual(d.latestResult.trend.map((t) => t.pct), [...res.exams].reverse().map((e) => e.pct));
    assert.equal(whatIfAttendance(d.attendanceGuide.attended, d.attendanceGuide.total, 0), d.stats.attendance);
  });
  it('coursework due matches the count and the assignments page', async () => {
    const d = (await get('/api/student/dashboard', a)).body;
    assert.equal(typeof d.assignmentsDue, 'number');
    assert.ok(d.coursework.length <= d.assignmentsDue);
    const all = (await get('/api/student/assignments', a)).body.assignments.map((x) => x.id);
    for (const w of d.coursework) assert.ok(all.includes(w.id));
  });
  it('answers only for the signed-in student', async () => {
    const one = (await get('/api/student/dashboard', a)).body;
    const other = (await get('/api/student/dashboard', c)).body;
    assert.notEqual(one.student.rollNo, other.student.rollNo);
    const tid = (await withTx({ platform: true }, () => q("select id from tenants where code = 'demo-college'"))).rows[0].id;
    const { rows: [p] } = await withTx({ tenantId: tid }, () => q("select coalesce(sum(p.amount), 0)::float8 as s from payments p join students s on s.id = p.student_id where s.student_code = 'STU2026003'"));
    assert.equal(other.fees.paid, p.s);
    assert.equal((await get('/api/student/dashboard')).status, 401);
  });
});

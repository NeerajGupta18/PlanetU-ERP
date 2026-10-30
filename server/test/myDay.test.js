/** Day 5: "My day" for a parent (the child they picked) and a student - run with `npm test` (needs `npm run db:setup` first). */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { env } from '../src/config/env.js';
import { createApp } from '../src/app.js';
import { closePool, q, withTx } from '../src/db/pool.js';
import { issueCaptchaToken } from '../src/services/captcha.service.js';

let server; let base; let tenantId; let student; let parent; let ids = {};

const json = async (method, path, { cookie, body } = {}) => {
  const r = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let b = null; try { b = await r.json(); } catch { /* empty */ }
  return { status: r.status, body: b };
};
async function login(tenantCode, role, identifier, password) {
  const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tenantCode, role, identifier, password, captchaToken: issueCaptchaToken() }) });
  assert.equal(r.status, 200);
  return r.headers.getSetCookie().map((c) => c.split(';')[0]).find((c) => c.startsWith(`${env.COOKIE_NAME}=`));
}
const withChild = (cookie, childId) => `${cookie}; erp_child=${childId}`;
const tx = (fn) => withTx({ tenantId }, fn);

before(async () => {
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  student = await login('demo-college', 'student', 'STU2026001', 'Student@123');
  parent = await login('demo-college', 'parent', 'PAR001', 'Parent@123');
  tenantId = (await withTx({ platform: true }, () => q("select id from tenants where code = 'demo-college'"))).rows[0].id;
  const rows = (await tx(() => q("select id, student_code from students where student_code in ('STU2026001', 'STU2026002', 'STU2026003')"))).rows;
  ids = Object.fromEntries(rows.map((r) => [r.student_code, r.id]));
});
after(async () => {
  await tx(() => q("delete from student_fee_items where label = 'MD test fee'"));
  server.close(); await closePool();
});

describe('My day', () => {
  it("a parent sees the picked child's day, the same as the student does", async () => {
    const p = await json('GET', '/api/student/my-day', { cookie: withChild(parent, ids.STU2026001) });
    const s = await json('GET', '/api/student/my-day', { cookie: student });
    assert.equal(p.status, 200);
    assert.equal(p.body.student.studentCode, 'STU2026001');
    assert.deepEqual(p.body.today, s.body.today);
    assert.equal(p.body.fees.outstanding, s.body.fees.outstanding);
    assert.ok(Array.isArray(p.body.today.classes));
    for (const c of p.body.today.classes) assert.ok(['present', 'absent', 'late', 'upcoming', 'now', 'not_marked'].includes(c.status), c.status);
    assert.ok(['today', 'pay', 'notices'].includes(p.body.next.step));
  });

  it('the other child answers for that child, and an unlinked child is refused with no data', async () => {
    const two = await json('GET', '/api/student/my-day', { cookie: withChild(parent, ids.STU2026002) });
    assert.equal(two.body.student.studentCode, 'STU2026002');
    const other = await json('GET', '/api/student/my-day', { cookie: withChild(parent, ids.STU2026003) });
    assert.equal(other.status, 403);
    assert.equal(other.body.student, undefined);
  });

  it('fees owed make Pay the one next thing, with the amount on the button', async () => {
    await tx(() => q("insert into student_fee_items (student_id, label, amount, due_date, status) values ($1, 'MD test fee', 1500, current_date - 3, 'unpaid')", [ids.STU2026001]));
    const r = await json('GET', '/api/student/my-day', { cookie: withChild(parent, ids.STU2026001) });
    assert.ok(r.body.fees.outstanding >= 1500);
    assert.equal(r.body.next.step, 'pay');
    assert.equal(r.body.next.action, 'pay');
    assert.match(r.body.next.label, /^Pay ₹/);
    assert.equal(typeof r.body.fees.payOnline, 'boolean');
  });

  it('a lecture marked for the class shows the child as absent or present', async () => {
    const day = await json('GET', '/api/student/my-day', { cookie: student });
    const marked = day.body.today.classes.filter((c) => ['present', 'absent', 'late'].includes(c.status));
    assert.equal(day.body.today.marked, marked.length);
    assert.equal(day.body.today.absent, marked.filter((c) => c.status === 'absent').length);
  });

  it('needs a sign-in', async () => {
    assert.equal((await json('GET', '/api/student/my-day')).status, 401);
  });
});

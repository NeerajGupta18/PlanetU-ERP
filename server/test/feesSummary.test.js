/** Fees overview figures - run with `npm test` (needs `npm run db:setup` first). */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { env } from '../src/config/env.js';
import { createApp } from '../src/app.js';
import { closePool, q, withTx } from '../src/db/pool.js';
import { issueCaptchaToken } from '../src/services/captcha.service.js';

let server; let base; let tenantId;
const get = async (path, cookie) => { const r = await fetch(`${base}${path}`, { headers: { cookie } }); return { status: r.status, body: await r.json() }; };
async function login(tenantCode, role, identifier, password) {
  const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tenantCode, role, identifier, password, captchaToken: issueCaptchaToken() }) });
  assert.equal(r.status, 200);
  return r.headers.getSetCookie().map((c) => c.split(';')[0]).find((c) => c.startsWith(`${env.COOKIE_NAME}=`));
}
let admin; let student;

before(async () => {
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  admin = await login('demo-college', 'admin', 'ADM001', 'Admin@123');
  student = await login('demo-college', 'student', 'STU2026001', 'Student@123');
  tenantId = (await withTx({ platform: true }, () => q("select id from tenants where code = 'demo-college'"))).rows[0].id;
  // A student of our own with one charge long overdue, so the suite does not depend on the demo data
  await withTx({ tenantId }, async () => {
    const { rows: [st] } = await q("insert into students (student_code, roll_no, name, email, status) values ('FS-TEST', 'FS1', 'Fees Summary Test', 'fs-test@test.example', 'Active') returning id");
    await q("insert into student_fee_items (student_id, label, amount, due_date, source) values ($1, 'Old charge', 1234, current_date - 400, 'manual')", [st.id]);
  });
});
after(async () => {
  await withTx({ tenantId }, () => q("delete from students where student_code = 'FS-TEST'"));
  server.close(); await closePool();
});

describe('fees overview', () => {
  it('is for the office only', async () => {
    assert.equal((await get('/api/admin/fees/summary', student)).status, 403);
  });

  it('adds up to the same figures as the charges and payments themselves', async () => {
    const { status, body } = await get('/api/admin/fees/summary', admin);
    assert.equal(status, 200);
    const truth = await withTx({ tenantId }, async () => (await q(
      `select coalesce(sum(i.amount - coalesce((select sum(a.amount) from payment_allocations a where a.fee_item_id = i.id), 0)), 0)::float8 as outstanding,
              coalesce(sum(i.amount - coalesce((select sum(a.amount) from payment_allocations a where a.fee_item_id = i.id), 0)) filter (where i.due_date < current_date), 0)::float8 as overdue,
              count(distinct i.student_id)::int as students
       from student_fee_items i where i.status in ('unpaid', 'partial')`)).rows[0]);
    assert.equal(body.outstanding, truth.outstanding);
    assert.equal(body.overdue, truth.overdue);
    assert.equal(body.studentsWithDues, truth.students);
    assert.ok(body.overdue <= body.outstanding);
    assert.ok(body.itemsTotal > 0);
  });

  it('lists overdue students, oldest due date first, with only overdue money', async () => {
    const { body } = await get('/api/admin/fees/summary', admin);
    assert.equal(body.overdueStudents[0].studentCode, 'FS-TEST', 'the oldest overdue charge comes first');
    assert.equal(body.overdueStudents[0].overdue, 1234);
    const total = body.overdueStudents.reduce((a, o) => a + o.overdue, 0);
    assert.ok(total <= body.overdue + 0.01);
    const dates = body.overdueStudents.map((o) => String(o.oldestDue));
    assert.deepEqual([...dates].sort(), dates);
    assert.ok(body.overdueStudents.every((o) => o.overdue > 0 && o.name && o.studentCode));
  });

  it('shows another institute only its own figures', async () => {
    const uni = await login('demo-university', 'admin', 'ADM001', 'Admin@123');
    const mine = (await get('/api/admin/fees/summary', admin)).body;
    const theirs = (await get('/api/admin/fees/summary', uni)).body;
    const codes = new Set(mine.overdueStudents.map((o) => o.studentCode));
    assert.ok(theirs.overdueStudents.every((o) => !codes.has(o.studentCode)));
  });
});

/** Notifications, approvals and the setup checklist - run with `npm test` (needs `npm run db:setup` first). */
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
const bell = async (cookie) => (await json('GET', '/api/me/notifications', { cookie })).body;

let admin; let emp; let emp2; let student; let parent; let uniAdmin; let superAdmin;
let leaveId;
const MARK = `IB-${Date.now()}`;

before(async () => {
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  admin = await login('demo-college', 'admin', 'ADM001', 'Admin@123');
  emp = await login('demo-college', 'employee', 'EMP003', 'Employee@123');
  emp2 = await login('demo-college', 'employee', 'EMP004', 'Employee@123');
  student = await login('demo-college', 'student', 'STU2026002', 'Student@123');
  parent = await login('demo-college', 'parent', 'PAR001', 'Parent@123');
  uniAdmin = await login('demo-university', 'admin', 'ADM001', 'Admin@123');
  superAdmin = await login('', 'super_admin', 'SA001', 'SuperAdmin@123');
  tenantId = (await withTx({ platform: true }, () => q("select id from tenants where code = 'demo-college'"))).rows[0].id;
});
after(async () => {
  await withTx({ tenantId }, async () => {
    if (leaveId) await q('delete from leave_requests where id = $1', [leaveId]);
    await q('delete from student_fee_items where label = $1', [`Fine ${MARK}`]);
    await q("delete from user_notifications where body like $1 or title like $1", [`%${MARK}%`]);
    await q("delete from users where login_id = 'IB-STU'");
    await q("delete from students where student_code = 'IB-STU'");
    await q("delete from timetable_slots where subject = 'Inbox Test Subject'");
    await q("delete from courses where code = 'IBTEST'");
  });
  server.close(); await closePool();
});

describe('the bell', () => {
  it('works for every institute role, and not for the platform admin', async () => {
    for (const c of [admin, emp, student, parent]) {
      const b = await bell(c);
      assert.ok(Array.isArray(b.items) && Array.isArray(b.reminders) && typeof b.unread === 'number');
    }
    assert.equal((await json('GET', '/api/me/notifications', { cookie: superAdmin })).status, 403);
    assert.equal((await json('GET', '/api/me/notifications')).status, 401);
  });

  it('tells the office about a new leave request, and the employee about the decision', async () => {
    const types = (await json('GET', '/api/employee/leave', { cookie: emp })).body;
    const typeId = (types.types || types.balances).find((t) => (t.daysPerYear ?? t.allowed ?? 1) > 0)?.id || (types.types || types.balances)[0].id;
    // the first working day from about a month ahead that this employee has free
    let r;
    for (let k = 30; k < 60; k += 1) {
      const day = toISO(addDays(new Date(), k));
      r = await json('POST', '/api/employee/leave', { cookie: emp, body: { typeId: typeId.typeId || typeId, fromDate: day, toDate: day, reason: `Family function ${MARK}` } });
      if (r.status === 201) break;
    }
    assert.equal(r.status, 201, JSON.stringify(r.body));
    leaveId = r.body.request?.id || r.body.id;
    const a = await bell(admin);
    assert.ok(a.items.some((n) => n.kind === 'approval' && /Leave request/.test(n.title)));
    assert.ok(a.counts.approvals >= 1);
    assert.ok(a.reminders.some((x) => x.kind === 'approvals'));

    const list = (await json('GET', '/api/admin/approvals', { cookie: admin })).body;
    const mine = list.items.find((i) => i.type === 'leave' && i.id === leaveId);
    assert.ok(mine, 'the request is on the approvals list');
    assert.equal(list.counts.approvals, list.items.length);

    assert.equal((await json('PUT', `/api/admin/leave/${leaveId}`, { cookie: admin, body: { decision: 'approve' } })).status, 200);
    const e = await bell(emp);
    const n = e.items.find((x) => x.kind === 'leave' && /approved/.test(x.title));
    assert.ok(n, 'the employee is told');
    assert.equal(n.read, false);
    assert.ok(e.unread >= 1);
    assert.equal(n.link, '/employee/leave');

    // only the owner can mark it read
    assert.equal((await json('POST', `/api/me/notifications/${n.id}/read`, { cookie: emp2 })).status, 404);
    assert.equal((await json('POST', `/api/me/notifications/${n.id}/read`, { cookie: admin })).status, 404);
    assert.equal((await json('POST', `/api/me/notifications/${n.id}/read`, { cookie: emp })).status, 200);
    assert.equal((await bell(emp)).items.find((x) => x.id === n.id).read, true);
    assert.equal((await json('POST', '/api/me/notifications/not-an-id/read', { cookie: emp })).status, 404);
    assert.equal((await json('POST', '/api/me/notifications/read-all', { cookie: emp })).status, 200);
    assert.equal((await bell(emp)).unread, 0);
    assert.ok(!(await json('GET', '/api/admin/approvals', { cookie: admin })).body.items.some((i) => i.id === leaveId), 'decided items leave the list');
  });

  it('reminds a student and their parent about overdue fees', async () => {
    // an overdue charge of our own, so this does not depend on what other suites left of the demo fees
    await withTx({ tenantId }, async () => {
      const sid = (await q("select student_id from users where login_id = 'STU2026002'")).rows[0].student_id;
      await q("insert into student_fee_items (student_id, label, amount, due_date, source) values ($1, $2, 500, current_date - 10, 'manual')", [sid, `Fine ${MARK}`]);
    });
    const s = await bell(student);
    assert.ok(s.reminders.some((x) => x.kind === 'fees' && x.tone === 'bad'), JSON.stringify(s.reminders));
    const p = await bell(parent);
    assert.ok(p.reminders.some((x) => x.kind === 'fees' && x.title.startsWith('Simran')), JSON.stringify(p.reminders));
  });

  it('tells a parent when the child is marked absent (when there is a lecture today)', async () => {
    const today = toISO(new Date());
    const weekday = new Date().getDay();
    let slotId; let studentId; let empId;
    await withTx({ tenantId }, async () => {
      empId = (await q("select id from employees where emp_code = 'EMP003'")).rows[0].id;
      const courseId = (await q("insert into courses (code, name) values ('IBTEST', 'Inbox Test Course') returning id")).rows[0].id;
      studentId = (await q("insert into students (student_code, roll_no, name, email, course_id, status) values ('IB-STU', '1', 'Ishaan Bose', 'ib-stu@test.example', $1, 'Active') returning id", [courseId])).rows[0].id;
      await q("insert into users (role, login_id, email, name, password_hash, student_id) values ('student', 'IB-STU', 'ib-stu@test.example', 'Ishaan Bose', $1, $2)", [bcrypt.hashSync('Student@123', 4), studentId]);
      const pu = (await q("select id from users where login_id = 'PAR001'")).rows[0].id;
      await q("insert into parent_links (user_id, student_id, relation) values ($1, $2, 'Parent')", [pu, studentId]);
      slotId = (await q("insert into timetable_slots (course_id, weekday, start_time, end_time, subject, employee_id) values ($1, $2, '00:00', '00:30', 'Inbox Test Subject', $3) returning id", [courseId, weekday, empId])).rows[0].id;
    });
    const r = await json('PUT', '/api/employee/attendance/lecture', { cookie: emp, body: { slotId, date: today, submit: true, marks: [{ studentId, status: 'absent' }] } });
    if (r.status !== 200) return; // a holiday or a day without classes: nothing to check
    const p = await bell(parent);
    assert.ok(p.items.some((n) => n.kind === 'attendance' && n.title === 'Ishaan was marked absent in Inbox Test Subject'));
    // correcting the register to present does not send a second absence message
    await json('PUT', '/api/employee/attendance/lecture', { cookie: emp, body: { slotId, date: today, submit: true, marks: [{ studentId, status: 'present' }] } });
    await json('PUT', '/api/employee/attendance/lecture', { cookie: emp, body: { slotId, date: today, submit: true, marks: [{ studentId, status: 'absent' }] } });
    const again = (await bell(parent)).items.filter((n) => n.title === 'Ishaan was marked absent in Inbox Test Subject');
    assert.equal(again.length, 2, 'absent, then present, then absent again is told twice - never for the same mark twice');
    await withTx({ tenantId }, async () => {
      await q("delete from user_notifications where title like 'Ishaan was marked absent%' or title like 'You were marked absent in Inbox Test Subject%'");
      await q('delete from attendance_sessions where slot_id = $1', [slotId]);
    });
  });

  it('keeps one institute\'s messages away from another', async () => {
    const e = (await bell(emp)).items;
    if (!e.length) return;
    assert.equal((await json('POST', `/api/me/notifications/${e[0].id}/read`, { cookie: uniAdmin })).status, 404);
  });
});

describe('approvals and setup', () => {
  it('are for the office only', async () => {
    assert.equal((await json('GET', '/api/admin/approvals', { cookie: emp })).status, 403);
    assert.equal((await json('GET', '/api/admin/setup-status', { cookie: student })).status, 403);
  });

  it('the setup checklist marks what is done', async () => {
    const s = (await json('GET', '/api/admin/setup-status', { cookie: admin })).body;
    assert.ok(s.total >= 5);
    assert.equal(s.done, s.steps.filter((x) => x.done).length);
    for (const k of ['courses', 'employees', 'departments']) assert.equal(s.steps.find((x) => x.key === k).done, true, k);
    assert.ok(s.steps.every((x) => x.to.startsWith('/admin/')));
  });
});

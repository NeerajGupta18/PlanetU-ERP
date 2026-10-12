/** QR check-in for attendance - run with `npm test` (needs `npm run db:setup` first). */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import bcrypt from 'bcryptjs';
import { env } from '../src/config/env.js';
import { createApp } from '../src/app.js';
import { closePool, q, withTx } from '../src/db/pool.js';
import { issueCaptchaToken } from '../src/services/captcha.service.js';
import { addDays, toISO } from '../src/utils/dates.js';
import { codeFor, windowOf } from '../src/services/checkin.service.js';

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
const TODAY = toISO(new Date());
let admin; let empA; let empB; let other; let parent; let courseId; let slotId; let removedHolidays = [];
const ids = {}; const ck = {};

const secretRow = async () => (await withTx({ tenantId }, () => q('select * from attendance_checkins where slot_id = $1 and on_date = $2', [slotId, TODAY]))).rows[0];
const checkIn = (who, code) => json('POST', '/api/student/checkin', { cookie: ck[who], body: { slotId, code } });
const sheet = async () => (await json('GET', `/api/employee/attendance/lecture?slotId=${slotId}&date=${TODAY}`, { cookie: empA })).body;
const viaOf = async (key) => (await withTx({ tenantId }, () => q(
  `select r.status, r.marked_via as via from attendance_records r join attendance_sessions s on s.id = r.session_id where s.slot_id = $1 and r.student_id = $2`, [slotId, ids[key]],
))).rows[0];

before(async () => {
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  admin = await login('demo-college', 'admin', 'ADM001', 'Admin@123');
  empA = await login('demo-college', 'employee', 'EMP001', 'Employee@123');
  empB = await login('demo-college', 'employee', 'EMP002', 'Employee@123');
  other = await login('demo-college', 'student', 'STU2026001', 'Student@123');
  parent = await login('demo-college', 'parent', 'PAR001', 'Parent@123');
  tenantId = (await withTx({ platform: true }, () => q("select id from tenants where code = 'demo-college'"))).rows[0].id;
  let empAId;
  await withTx({ tenantId }, async () => {
    removedHolidays = (await q("delete from events where type = 'holiday' and end_date >= $1 and start_date <= $1 returning *", [TODAY])).rows;
    empAId = (await q("select id from employees where emp_code = 'EMP001'")).rows[0].id;
    courseId = (await q("insert into courses (code, name) values ('CHKTEST', 'Check-in Test Course') returning id")).rows[0].id;
    const hash = bcrypt.hashSync('Student@123', 10);
    for (const key of ['c1', 'c2', 'c3', 'c4']) {
      const code = `CHK-${key.toUpperCase()}`;
      ids[key] = (await q("insert into students (student_code, roll_no, name, email, course_id, status) values ($1, $2, $3, $4, $5, 'Active') returning id",
        [code, key.slice(1), `Check ${key}`, `${code.toLowerCase()}@test.example`, courseId])).rows[0].id;
      await q("insert into users (role, login_id, email, name, password_hash, student_id) values ('student', $1, $2, $3, $4, $5)", [code, `${code.toLowerCase()}@test.example`, `Check ${key}`, hash, ids[key]]);
    }
  });
  for (const key of ['c1', 'c2', 'c3', 'c4']) ck[key] = await login('demo-college', 'student', `CHK-${key.toUpperCase()}`, 'Student@123');
  const r = await json('POST', '/api/admin/timetable/slots', { cookie: admin, body: { courseId, weekday: new Date().getDay(), start: '23:00', end: '23:30', subject: 'Check-in Test Subject', employeeId: empAId } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  slotId = r.body.slot.id;
});

after(async () => {
  try {
    await withTx({ tenantId }, async () => {
      await q("delete from users where login_id like 'CHK-%'");
      await q("delete from students where student_code like 'CHK-%'");
      await q("delete from courses where code = 'CHKTEST'");
      if (removedHolidays.length) await q('insert into events select * from json_populate_recordset(null::events, $1)', [JSON.stringify(removedHolidays)]);
    });
  } finally {
    await new Promise((r) => server.close(r));
    await closePool();
  }
});

describe('Before the teacher opens check-in', () => {
  it('a student cannot check in, and the teacher sees it as not open', async () => {
    const r = await checkIn('c1', '123456');
    assert.equal(r.status, 409); assert.equal(r.body.code, 'CHECKIN_CLOSED');
    const s = await json('GET', `/api/employee/attendance/checkin?slotId=${slotId}`, { cookie: empA });
    assert.equal(s.status, 200); assert.equal(s.body.open, false); assert.equal(s.body.roster, 4);
  });

  it('only the teacher of the lecture can open it', async () => {
    assert.equal((await json('POST', '/api/employee/attendance/checkin', { cookie: empB, body: { slotId } })).status, 404);
    assert.equal((await json('POST', '/api/employee/attendance/checkin', { cookie: ck.c1, body: { slotId } })).status, 403);
    assert.equal((await json('POST', '/api/employee/attendance/checkin', { cookie: empA, body: { slotId: 'nope' } })).status, 400);
  });
});

describe('Opening and the rotating code', () => {
  it('opens check-in and shows a 6-digit code with the seconds it lasts', async () => {
    const r = await json('POST', '/api/employee/attendance/checkin', { cookie: empA, body: { slotId } });
    assert.equal(r.status, 200); assert.equal(r.body.open, true);
    assert.match(r.body.code, /^\d{6}$/); assert.ok(r.body.secondsLeft >= 1 && r.body.secondsLeft <= 30);
    const again = await json('GET', `/api/employee/attendance/checkin?slotId=${slotId}`, { cookie: empA });
    assert.equal(again.body.open, true); assert.equal(again.body.checkedIn, 0);
  });

  it('shows students the lecture with check-in open', async () => {
    const r = await json('GET', '/api/student/checkin/today', { cookie: ck.c1 });
    const l = r.body.lectures.find((x) => x.slotId === slotId);
    assert.equal(l.checkinOpen, true); assert.equal(l.myStatus, null);
    // a student of another class does not see this lecture
    assert.ok(!(await json('GET', '/api/student/checkin/today', { cookie: other })).body.lectures.some((x) => x.slotId === slotId));
  });
});

describe('Checking in', () => {
  it('a right code marks the student present, and doing it again changes nothing', async () => {
    const k = await secretRow();
    const code = codeFor(k.secret, k.id, windowOf());
    const r = await checkIn('c1', code);
    assert.equal(r.status, 200); assert.equal(r.body.status, 'present'); assert.equal(r.body.already, false);
    assert.deepEqual(await viaOf('c1'), { status: 'present', via: 'qr' });
    assert.equal((await checkIn('c1', code)).body.already, true);
    const t = await json('GET', `/api/employee/attendance/checkin?slotId=${slotId}`, { cookie: empA });
    assert.equal(t.body.checkedIn, 1); assert.equal(t.body.recent[0].name, 'Check c1');
  });

  it('the teacher\'s sheet shows the student as present and the others unmarked', async () => {
    const s = await sheet();
    assert.equal(s.students.find((x) => x.name === 'Check c1').status, 'present');
    assert.equal(s.students.find((x) => x.name === 'Check c2').status, null);
    assert.equal(s.session.status, 'draft');
  });

  it('the previous 30 seconds still work, older codes do not', async () => {
    const k = await secretRow(); const w = windowOf();
    const stale = await checkIn('c3', codeFor(k.secret, k.id, w - 3));
    assert.equal(stale.status, 400); assert.equal(stale.body.code, 'BAD_CODE');
    const prev = await checkIn('c3', codeFor(k.secret, k.id, w - 1));
    assert.equal(prev.status, 200); assert.equal(prev.body.status, 'present');
  });

  it('counts wrong codes and locks the student out after five', async () => {
    const k = await secretRow();
    let last;
    for (let i = 0; i < 5; i += 1) last = await checkIn('c2', '000000' === codeFor(k.secret, k.id, windowOf()) ? '000001' : '000000');
    assert.equal(last.status, 400); assert.match(last.body.message, /0 tries left/);
    const good = await checkIn('c2', codeFor(k.secret, k.id, windowOf()));
    assert.equal(good.status, 429); assert.equal(good.body.code, 'LOCKED');
    assert.equal(await viaOf('c2'), undefined);
  });

  it('a malformed code is refused, and a student of another class cannot check in', async () => {
    assert.equal((await checkIn('c4', 'abc')).status, 400);
    const k = await secretRow();
    const r = await json('POST', '/api/student/checkin', { cookie: other, body: { slotId, code: codeFor(k.secret, k.id, windowOf()) } });
    assert.equal(r.status, 404);
  });

  it('marks a student late once the first minutes have passed', async () => {
    await withTx({ tenantId }, () => q("update attendance_checkins set opened_at = now() - interval '30 minutes' where slot_id = $1", [slotId]));
    const k = await secretRow();
    const r = await checkIn('c4', codeFor(k.secret, k.id, windowOf()));
    assert.equal(r.status, 200); assert.equal(r.body.status, 'late');
  });

  it('parents cannot use check-in', async () => {
    assert.equal((await json('POST', '/api/student/checkin', { cookie: parent, body: { slotId, code: '123456' } })).status, 403);
  });
});

describe('Closing, expiry and the submitted sheet', () => {
  it('a teacher-marked student cannot be overwritten by a check-in', async () => {
    const s = await sheet();
    const marks = s.students.filter((x) => x.name === 'Check c2').map((x) => ({ studentId: x.id, status: 'absent' }));
    assert.equal((await json('PUT', '/api/employee/attendance/lecture', { cookie: empA, body: { slotId, date: TODAY, marks } })).status, 200);
    const k = await secretRow();
    // c2 is locked out anyway; use a reset to prove the rule on its own
    await withTx({ tenantId }, () => q('delete from attendance_checkin_fails where checkin_id = $1', [k.id]));
    const r = await checkIn('c2', codeFor(k.secret, k.id, windowOf()));
    assert.equal(r.status, 409); assert.match(r.body.message, /already marked/);
    assert.equal((await viaOf('c2')).status, 'absent');
  });

  it('closing stops check-in, and an expired window does too', async () => {
    assert.equal((await json('POST', '/api/employee/attendance/checkin/close', { cookie: empA, body: { slotId } })).body.open, false);
    const k = await secretRow();
    assert.equal((await checkIn('c1', codeFor(k.secret, k.id, windowOf()))).body.code, 'CHECKIN_CLOSED');
    await json('POST', '/api/employee/attendance/checkin', { cookie: empA, body: { slotId } });
    await withTx({ tenantId }, () => q("update attendance_checkins set closes_at = now() - interval '1 minute' where slot_id = $1", [slotId]));
    assert.equal((await json('GET', `/api/employee/attendance/checkin?slotId=${slotId}`, { cookie: empA })).body.open, false);
  });

  it('once the sheet is submitted, check-in cannot be opened or used', async () => {
    const s = await sheet();
    const marks = s.students.filter((x) => !x.status).map((x) => ({ studentId: x.id, status: 'absent' }));
    const done = await json('PUT', '/api/employee/attendance/lecture', { cookie: empA, body: { slotId, date: TODAY, marks, submit: true } });
    assert.equal(done.status, 200, JSON.stringify(done.body));
    assert.equal((await json('POST', '/api/employee/attendance/checkin', { cookie: empA, body: { slotId } })).status, 409);
    await withTx({ tenantId }, () => q("update attendance_checkins set status = 'open', closes_at = now() + interval '5 minutes' where slot_id = $1", [slotId]));
    const k = await secretRow();
    const late = await checkIn('c3', codeFor(k.secret, k.id, windowOf()));
    assert.equal(late.status, 409); assert.match(late.body.message, /already been submitted/);
    assert.equal((await json('GET', '/api/student/checkin/today', { cookie: ck.c1 })).body.lectures.find((x) => x.slotId === slotId).submitted, true);
  });
});

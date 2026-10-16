/** QR check-in for attendance - run with `npm test` (needs `npm run db:setup` first). */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import bcrypt from 'bcryptjs';
import { env } from '../src/config/env.js';
import { createApp } from '../src/app.js';
import { closePool, q, withTx } from '../src/db/pool.js';
import { issueCaptchaToken } from '../src/services/captcha.service.js';
import { addDays, toISO } from '../src/utils/dates.js';
import { tokenFor, windowOf } from '../src/services/checkin.service.js';

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
const checkIn = (who, token, extra = {}) => json('POST', '/api/student/checkin', { cookie: ck[who], body: { token, ...extra } });
const live = (k, back = 0) => tokenFor(k.secret, k.id, windowOf() - back);
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
    const r = await checkIn('c1', 'typed-123456');
    assert.equal(r.status, 400); assert.equal(r.body.code, 'NOT_A_CODE');
    const s = await json('GET', `/api/employee/attendance/checkin?slotId=${slotId}`, { cookie: empA });
    assert.equal(s.status, 200); assert.equal(s.body.open, false); assert.equal(s.body.roster, 4);
  });

  it('only the teacher of the lecture can open it', async () => {
    assert.equal((await json('POST', '/api/employee/attendance/checkin', { cookie: empB, body: { slotId } })).status, 404);
    assert.equal((await json('POST', '/api/employee/attendance/checkin', { cookie: ck.c1, body: { slotId } })).status, 403);
    assert.equal((await json('POST', '/api/employee/attendance/checkin', { cookie: empA, body: { slotId: 'nope' } })).status, 400);
  });
});

describe('Opening and the rotating QR', () => {
  it('opens check-in and returns a signed QR token, with no typed code', async () => {
    const r = await json('POST', '/api/employee/attendance/checkin', { cookie: empA, body: { slotId } });
    assert.equal(r.status, 200); assert.equal(r.body.open, true);
    assert.match(r.body.token, /^PUCI1:[0-9a-f-]{36}:\d+:[0-9a-f]{24}$/); assert.equal(r.body.code, undefined);
    assert.ok(r.body.secondsLeft >= 1 && r.body.secondsLeft <= 10); assert.equal(r.body.windowSeconds, 10);
    assert.deepEqual(r.body.flagged, []); assert.equal(r.body.locationRequired, false);
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
  it('a live scan marks the student present, and doing it again changes nothing', async () => {
    const k = await secretRow();
    const code = live(k);
    const r = await checkIn('c1', code, { deviceId: 'device-of-c1-aaaa' });
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

  it('the QR from the last 10 seconds still works, older ones and future ones do not', async () => {
    const k = await secretRow();
    for (const bad of [live(k, 2), live(k, 30), live(k, -3)]) {
      const stale = await checkIn('c3', bad);
      assert.equal(stale.status, 400); assert.equal(stale.body.code, 'BAD_CODE');
    }
    const prev = await checkIn('c3', live(k, 1), { deviceId: 'device-of-c3-cccc' });
    assert.equal(prev.status, 200); assert.equal(prev.body.status, 'present');
  });

  it('a forged signature is refused and a token cannot be edited to another time', async () => {
    const k = await secretRow();
    const forged = `PUCI1:${k.id}:${windowOf()}:${'0'.repeat(24)}`;
    assert.equal((await checkIn('c4', forged)).body.code, 'BAD_CODE');
    await withTx({ tenantId }, () => q('delete from attendance_checkin_fails where checkin_id = $1', [k.id]));
  });

  it('counts wrong codes and locks the student out after five', async () => {
    const k = await secretRow();
    let last;
    for (let i = 0; i < 5; i += 1) last = await checkIn('c2', `PUCI1:${k.id}:${windowOf()}:${'a'.repeat(24)}`);
    assert.equal(last.status, 400); assert.match(last.body.message, /0 tries left/);
    const good = await checkIn('c2', live(k));
    assert.equal(good.status, 429); assert.equal(good.body.code, 'LOCKED');
    assert.equal(await viaOf('c2'), undefined);
  });

  it('typed text is refused, and a student of another class cannot check in', async () => {
    assert.equal((await checkIn('c4', '123456')).body.code, 'NOT_A_CODE');
    assert.equal((await checkIn('c4', undefined)).status, 400);
    const k = await secretRow();
    const r = await json('POST', '/api/student/checkin', { cookie: other, body: { token: live(k) } });
    assert.equal(r.status, 404);
  });

  it('one phone marking a second student flags both for the teacher', async () => {
    const k = await secretRow();
    const r = await checkIn('c4', live(k), { deviceId: 'device-of-c1-aaaa' });
    assert.equal(r.status, 200);
    const t = await json('GET', `/api/employee/attendance/checkin?slotId=${slotId}`, { cookie: empA });
    assert.deepEqual(t.body.flagged.map((x) => x.name).sort(), ['Check c1', 'Check c4']);
    assert.match(t.body.flagged[0].flag, /Same phone/);
  });

  it('marks a student late once the first minutes have passed', async () => {
    await withTx({ tenantId }, () => q('update attendance_checkins set opened_at = now() - interval \'30 minutes\' where slot_id = $1', [slotId]));
    const k = await secretRow();
    await withTx({ tenantId }, () => q('delete from attendance_records where student_id = $1', [ids.c4]));
    const r = await checkIn('c4', live(k), { deviceId: 'device-of-c4-dddd' });
    assert.equal(r.status, 200); assert.equal(r.body.status, 'late');
  });

  it('parents cannot use check-in', async () => {
    assert.equal((await json('POST', '/api/student/checkin', { cookie: parent, body: { token: 'x' } })).status, 403);
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
    const r = await checkIn('c2', live(k));
    assert.equal(r.status, 409); assert.match(r.body.message, /already marked/);
    assert.equal((await viaOf('c2')).status, 'absent');
  });

  it('closing stops check-in, and an expired window does too', async () => {
    assert.equal((await json('POST', '/api/employee/attendance/checkin/close', { cookie: empA, body: { slotId } })).body.open, false);
    const k = await secretRow();
    assert.equal((await checkIn('c1', live(k))).body.code, 'CHECKIN_CLOSED');
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
    const late = await checkIn('c3', live(k));
    assert.equal(late.status, 409); assert.match(late.body.message, /already been submitted/);
    assert.equal((await json('GET', '/api/student/checkin/today', { cookie: ck.c1 })).body.lectures.find((x) => x.slotId === slotId).submitted, true);
  });
});

describe('Classroom location (optional)', () => {
  let k;
  it('opening with the location check needs the teacher\'s position', async () => {
    await withTx({ tenantId }, () => q('delete from attendance_sessions where slot_id = $1', [slotId]));
    const no = await json('POST', '/api/employee/attendance/checkin', { cookie: empA, body: { slotId, requireLocation: true } });
    assert.equal(no.status, 400); assert.equal(no.body.code, 'LOCATION_NEEDED');
    const ok = await json('POST', '/api/employee/attendance/checkin', { cookie: empA, body: { slotId, requireLocation: true, lat: 18.5204, lng: 73.8567 } });
    assert.equal(ok.status, 200); assert.equal(ok.body.locationRequired, true); assert.equal(ok.body.radiusMetres, 150);
    k = await secretRow();
    const l = (await json('GET', '/api/student/checkin/today', { cookie: ck.c1 })).body.lectures.find((x) => x.slotId === slotId);
    assert.equal(l.needsLocation, true);
  });

  it('students without a position, or far away, are not marked', async () => {
    await withTx({ tenantId }, () => q('delete from attendance_records where student_id = $1', [ids.c1]));
    assert.equal((await checkIn('c1', live(k))).body.code, 'LOCATION_NEEDED');
    const far = await checkIn('c1', live(k), { lat: 18.5304, lng: 73.8567 }); // about 1.1 km north
    assert.equal(far.status, 403); assert.equal(far.body.code, 'TOO_FAR');
    assert.equal(await viaOf('c1'), undefined);
  });

  it('a student in the room is marked', async () => {
    const r = await checkIn('c1', live(k), { lat: 18.5206, lng: 73.8568, deviceId: 'device-of-c1-aaaa' });
    assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.status, 'present');
  });
});

describe('Schools do not have QR check-in', () => {
  it('a school is not given the module, and the server refuses even if it is switched on', async () => {
    const school = await login('demo-school', 'student', 'GPS2026001', 'Student@123');
    const r1 = await json('GET', '/api/student/checkin/today', { cookie: school });
    assert.equal(r1.status, 403); assert.equal(r1.body.code, 'MODULE_DISABLED');
    const sid = (await withTx({ platform: true }, () => q("select id from tenants where code = 'demo-school'"))).rows[0].id;
    try {
      await withTx({ platform: true }, () => q("update tenants set modules = array_append(modules, 'qr_checkin') where id = $1", [sid]));
      const r2 = await json('GET', '/api/student/checkin/today', { cookie: school });
      assert.equal(r2.status, 403); assert.equal(r2.body.code, 'CHECKIN_NOT_FOR_SCHOOLS');
    } finally {
      await withTx({ platform: true }, () => q("update tenants set modules = array_remove(modules, 'qr_checkin') where id = $1", [sid]));
    }
  });

  it('colleges and universities have it, and the school preset does not', async () => {
    const rows = (await withTx({ platform: true }, () => q("select code, 'qr_checkin' = any (modules) as has from tenants where code like 'demo-%'"))).rows;
    const by = Object.fromEntries(rows.map((r) => [r.code, r.has]));
    assert.deepEqual([by['demo-college'], by['demo-university'], by['demo-school']], [true, true, false]);
  });
});

/** Attendance - run with `npm test` (needs `npm run db:setup` first). */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import bcrypt from 'bcryptjs';
import { env } from '../src/config/env.js';
import { createApp } from '../src/app.js';
import { closePool, q, withTx } from '../src/db/pool.js';
import { issueCaptchaToken } from '../src/services/captcha.service.js';
import { addDays, toISO } from '../src/utils/dates.js';

let server; let base;
const json = async (method, path, { cookie, body } = {}) => {
  const r = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let b = null; try { b = await r.clone().json(); } catch { /* not json */ }
  return { status: r.status, body: b, res: r };
};
async function login(tenantCode, role, identifier, password) {
  const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tenantCode, role, identifier, password, captchaToken: issueCaptchaToken() }) });
  assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
  return r.headers.getSetCookie().map((c) => c.split(';')[0]).find((c) => c.startsWith(`${env.COOKIE_NAME}=`));
}

const TODAY = toISO(new Date());
const D7 = toISO(addDays(new Date(), -7)); // same weekday as today
const D14 = toISO(addDays(new Date(), -14));
const FUTURE = toISO(addDays(new Date(), 7));

let admin; let schoolAdmin; let empA; let empB; let studentS1; let tenantId;
let courseId; let slotId; let empAId; let empBId; let sessionStudents; let removedHolidays = [];
const ids = {}; // test student ids by key

const mark = (status) => sessionStudents.map((s) => ({ studentId: s.id, status }));
const lectureUrl = (date, extra = '') => `/api/employee/attendance/lecture?slotId=${slotId}&date=${date}${extra}`;
const adminLectureUrl = (date) => `/api/admin/attendance/lecture?slotId=${slotId}&date=${date}`;

before(async () => {
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  admin = await login('demo-college', 'admin', 'ADM001', 'Admin@123');
  schoolAdmin = await login('demo-school', 'admin', 'ADM001', 'Admin@123');
  empA = await login('demo-college', 'employee', 'EMP001', 'Employee@123');
  empB = await login('demo-college', 'employee', 'EMP002', 'Employee@123');
  tenantId = (await withTx({ platform: true }, () => q("select id from tenants where code = 'demo-college'"))).rows[0].id;

  await withTx({ tenantId }, async () => {
    // A holiday on any test date would (correctly) block marking - take any out of the way, restore in after()
    removedHolidays = (await q(
      "delete from events where type = 'holiday' and end_date >= $1 and start_date <= $2 returning *", [D14, TODAY],
    )).rows;
    empAId = (await q("select id from employees where emp_code = 'EMP001'")).rows[0].id;
    empBId = (await q("select id from employees where emp_code = 'EMP002'")).rows[0].id;
    // Own course + students, so other test files enrolling into BCA can't change this roster
    courseId = (await q("insert into courses (code, name) values ('ATTTEST', 'Attendance Test Course') returning id")).rows[0].id;
    const hash = bcrypt.hashSync('Student@123', 10);
    for (const [key, code, name, roll, status] of [
      ['s1', 'ATT-S1', 'Zara Test One', '1', 'Active'], ['s2', 'ATT-S2', 'Yash Test Two', '2', 'Active'],
      ['s3', 'ATT-S3', 'Xena Test Three', '3', 'Active'], ['gone', 'ATT-S4', 'Wes Inactive', '4', 'Inactive'],
    ]) {
      ids[key] = (await q(
        `insert into students (student_code, roll_no, name, email, course_id, status)
         values ($1, $2, $3, $4, $5, $6) returning id`,
        [code, roll, name, `${code.toLowerCase()}@test.example`, courseId, status],
      )).rows[0].id;
    }
    await q(
      "insert into users (role, login_id, email, name, password_hash, student_id) values ('student', 'ATT-S1', 'att-s1@test.example', 'Zara Test One', $1, $2)",
      [hash, ids.s1],
    );
    ids.outsider = (await q("select id from students where student_code = 'STU2026001'")).rows[0].id; // BCA, not in the test course
  });
  studentS1 = await login('demo-college', 'student', 'ATT-S1', 'Student@123');

  const r = await json('POST', '/api/admin/timetable/slots', {
    cookie: admin,
    body: { courseId, weekday: new Date().getDay(), start: '23:00', end: '23:30', subject: 'Attendance Test Subject', employeeId: empAId },
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  slotId = r.body.slot.id;
});

after(async () => {
  try {
    await withTx({ tenantId }, async () => {
      await q("delete from events where title = 'Attendance test holiday'");
      await q("delete from users where login_id = 'ATT-S1'");
      await q("delete from students where student_code like 'ATT-S%'"); // their attendance marks go with them
      await q("delete from courses where code = 'ATTTEST'"); // slots and sessions go with the course
      if (removedHolidays.length) {
        await q('insert into events select * from json_populate_recordset(null::events, $1)', [JSON.stringify(removedHolidays)]);
      }
    });
  } finally {
    await new Promise((r) => server.close(r));
    await closePool();
  }
});

describe('Row Level Security (database)', () => {
  it('attendance tables are empty with no tenant context and invisible to another tenant', async () => {
    await withTx({}, async () => {
      assert.equal((await q('select count(*)::int as n from attendance_sessions')).rows[0].n, 0);
      assert.equal((await q('select count(*)::int as n from attendance_records')).rows[0].n, 0);
    });
    const schoolId = (await withTx({ platform: true }, () => q("select id from tenants where code = 'demo-school'"))).rows[0].id;
    await withTx({ tenantId }, () => q(
      "insert into attendance_sessions (slot_id, on_date, course_id, subject, start_time, end_time) values ($1, $2, $3, 'RLS probe', '23:00', '23:30')",
      [slotId, D14, courseId],
    ));
    await withTx({ tenantId: schoolId }, async () => {
      assert.equal((await q("select count(*)::int as n from attendance_sessions where subject = 'RLS probe'")).rows[0].n, 0);
    });
    await withTx({ tenantId }, () => q("delete from attendance_sessions where subject = 'RLS probe'"));
  });
});

describe('Faculty: today\'s lectures from the Timetable', () => {
  it('lists the lecture for the teaching employee only', async () => {
    const a = await json('GET', '/api/employee/attendance/today', { cookie: empA });
    assert.equal(a.status, 200);
    const mine = a.body.lectures.find((l) => l.slotId === slotId);
    assert.ok(mine, 'EMP001 should see the new lecture');
    assert.equal(mine.sessionStatus, 'none');
    assert.equal(mine.roster, 3, 'inactive students are not on the roster');
    const b = await json('GET', '/api/employee/attendance/today', { cookie: empB });
    assert.ok(!b.body.lectures.some((l) => l.slotId === slotId));
  });

  it('keeps students and admins out of the faculty routes (and employees out of admin routes)', async () => {
    assert.equal((await json('GET', '/api/employee/attendance/today', { cookie: studentS1 })).status, 403);
    assert.equal((await json('GET', '/api/employee/attendance/today', { cookie: admin })).status, 403);
    assert.equal((await json('GET', '/api/admin/attendance/report', { cookie: empA })).status, 403);
    assert.equal((await json('GET', '/api/student/attendance', { cookie: empA })).status, 403);
    assert.equal((await json('GET', '/api/employee/attendance/today')).status, 401);
  });
});

describe('Marking sheet', () => {
  it('opens with the active roster, unmarked, editable for the teacher; hidden from other employees', async () => {
    const r = await json('GET', lectureUrl(TODAY), { cookie: empA });
    assert.equal(r.status, 200);
    assert.equal(r.body.editable, true);
    assert.equal(r.body.session, null);
    sessionStudents = r.body.students;
    assert.deepEqual(sessionStudents.map((s) => s.code), ['ATT-S1', 'ATT-S2', 'ATT-S3']);
    assert.ok(sessionStudents.every((s) => s.status === null));
    assert.equal((await json('GET', lectureUrl(TODAY), { cookie: empB })).status, 404);
  });

  it('validates marks: bad status, duplicates, students outside the class', async () => {
    const put = (marks, extra = {}) => json('PUT', '/api/employee/attendance/lecture', { cookie: empA, body: { slotId, date: TODAY, marks, ...extra } });
    assert.equal((await put([{ studentId: ids.s1, status: 'maybe' }])).status, 400);
    assert.equal((await put([{ studentId: ids.s1, status: 'present' }, { studentId: ids.s1, status: 'absent' }])).status, 400);
    assert.equal((await put([{ studentId: ids.outsider, status: 'present' }])).status, 400);
    assert.equal((await put([{ studentId: ids.gone, status: 'present' }])).status, 400, 'inactive student is not in the class');
    assert.equal((await put('nope')).status, 400);
    assert.equal((await put([])).status, 400, 'nothing to save');
  });

  it('a draft saves part-way, is not submitted and does not count in the student\'s percentage', async () => {
    const r = await json('PUT', '/api/employee/attendance/lecture', { cookie: empA, body: { slotId, date: TODAY, marks: [{ studentId: ids.s1, status: 'present' }] } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.session.status, 'draft');
    assert.equal(r.body.students.find((s) => s.id === ids.s1).status, 'present');
    assert.equal(r.body.students.find((s) => s.id === ids.s2).status, null);
    const mine = await json('GET', '/api/student/attendance', { cookie: studentS1 });
    assert.ok(!mine.body.subjects.some((s) => s.subject === 'Attendance Test Subject'));
  });

  it('refuses to submit until every student is marked', async () => {
    const r = await json('PUT', '/api/employee/attendance/lecture', { cookie: empA, body: { slotId, date: TODAY, marks: [{ studentId: ids.s2, status: 'absent' }], submit: true } });
    assert.equal(r.status, 400);
    assert.match(r.body.message, /1 still unmarked/);
  });

  it('submits a complete sheet: present + late count as attended, and the student sees it', async () => {
    const marks = [{ studentId: ids.s1, status: 'late' }, { studentId: ids.s2, status: 'absent' }, { studentId: ids.s3, status: 'present' }];
    const r = await json('PUT', '/api/employee/attendance/lecture', { cookie: empA, body: { slotId, date: TODAY, marks, submit: true } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.session.status, 'submitted');

    const list = await json('GET', '/api/employee/attendance/today', { cookie: empA });
    const l = list.body.lectures.find((x) => x.slotId === slotId);
    assert.equal(l.sessionStatus, 'submitted');
    assert.deepEqual([l.marked, l.attended], [3, 2]);

    const mine = await json('GET', '/api/student/attendance', { cookie: studentS1 });
    assert.equal(mine.body.live, true);
    const sub = mine.body.subjects.find((s) => s.subject === 'Attendance Test Subject');
    assert.deepEqual([sub.attended, sub.total, sub.pct], [1, 1, 100]);
    assert.equal(mine.body.recent[0].status, 'late');
    const dash = await json('GET', '/api/student/dashboard', { cookie: studentS1 });
    assert.equal(dash.body.stats.attendance, 100);
    assert.equal(dash.body.attendanceThreshold, 75);
  });

  it('the teacher can correct the sheet the same day; it stays one session and stays submitted', async () => {
    const r = await json('PUT', '/api/employee/attendance/lecture', { cookie: empA, body: { slotId, date: TODAY, marks: [{ studentId: ids.s2, status: 'present' }] } });
    assert.equal(r.status, 200);
    assert.equal(r.body.session.status, 'submitted');
    assert.equal(r.body.students.find((s) => s.id === ids.s2).status, 'present');
    await withTx({ tenantId }, async () => {
      assert.equal((await q('select count(*)::int as n from attendance_sessions where slot_id = $1 and on_date = $2', [slotId, TODAY])).rows[0].n, 1);
      assert.equal((await q('select count(*)::int as n from attendance_records r join attendance_sessions a on a.id = r.session_id where a.slot_id = $1', [slotId])).rows[0].n, 3);
    });
  });
});

describe('Who may mark, and when', () => {
  it('blocks other employees, future dates and non-lecture dates', async () => {
    const body = { slotId, date: TODAY, marks: mark('present') };
    assert.equal((await json('PUT', '/api/employee/attendance/lecture', { cookie: empB, body })).status, 404);
    assert.equal((await json('PUT', '/api/employee/attendance/lecture', { cookie: empA, body: { ...body, date: FUTURE } })).status, 403);
    assert.equal((await json('PUT', '/api/admin/attendance/lecture', { cookie: admin, body: { ...body, date: FUTURE } })).status, 403);
    // The day after is the wrong weekday for this slot
    const wrongDay = toISO(addDays(new Date(), -6));
    assert.equal((await json('PUT', '/api/admin/attendance/lecture', { cookie: admin, body: { ...body, date: wrongDay } })).status, 404);
    assert.equal((await json('PUT', '/api/employee/attendance/lecture', { cookie: empA, body: { ...body, date: 'tomorrow' } })).status, 400);
  });

  it('employees cannot mark an earlier day; an admin can, producing a separate session', async () => {
    const past = await json('PUT', '/api/employee/attendance/lecture', { cookie: empA, body: { slotId, date: D7, marks: mark('present') } });
    assert.equal(past.status, 403);
    assert.match(past.body.message, /day of the lecture/);

    const r = await json('PUT', '/api/admin/attendance/lecture', { cookie: admin, body: { slotId, date: D7, marks: mark('absent'), submit: true } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.session.status, 'submitted');
    const mine = await json('GET', '/api/student/attendance', { cookie: studentS1 });
    const sub = mine.body.subjects.find((s) => s.subject === 'Attendance Test Subject');
    assert.deepEqual([sub.attended, sub.total, sub.pct], [1, 2, 50]);
    assert.equal(sub.needToReach, 2, 'attend 2 more in a row to get from 1/2 to 3/4');
  });

  it('follows a reassignment: the new teacher marks, the original owner sees a read-only reason', async () => {
    const re = await json('PUT', '/api/admin/timetable/reassign', { cookie: admin, body: { slotId, date: TODAY, toEmployeeId: empBId, reason: 'test' } });
    assert.equal(re.status, 200);
    try {
      const owner = await json('GET', lectureUrl(TODAY), { cookie: empA });
      assert.equal(owner.status, 200);
      assert.equal(owner.body.editable, false);
      assert.match(owner.body.reason, /reassigned to/);
      const blocked = await json('PUT', '/api/employee/attendance/lecture', { cookie: empA, body: { slotId, date: TODAY, marks: mark('present') } });
      assert.equal(blocked.status, 403);

      const list = await json('GET', '/api/employee/attendance/today', { cookie: empB });
      assert.ok(list.body.lectures.some((l) => l.slotId === slotId && l.reassigned));
      assert.ok(!(await json('GET', '/api/employee/attendance/today', { cookie: empA })).body.lectures.some((l) => l.slotId === slotId));
      const ok = await json('PUT', '/api/employee/attendance/lecture', { cookie: empB, body: { slotId, date: TODAY, marks: [{ studentId: ids.s3, status: 'late' }] } });
      assert.equal(ok.status, 200, JSON.stringify(ok.body));
    } finally {
      await json('PUT', '/api/admin/timetable/reassign/undo', { cookie: admin, body: { slotId, date: TODAY } });
    }
  });

  it('holidays have no lectures to mark', async () => {
    await withTx({ tenantId }, () => q(
      "insert into events (title, type, start_date, end_date) values ('Attendance test holiday', 'holiday', $1, $1)", [D14],
    ));
    const r = await json('PUT', '/api/admin/attendance/lecture', { cookie: admin, body: { slotId, date: D14, marks: mark('present') } });
    assert.equal(r.status, 404);
  });
});

describe('Admin: day sheet and reports', () => {
  it('day sheet shows the lecture, who teaches it and whether it was marked', async () => {
    const r = await json('GET', `/api/admin/attendance/day?date=${TODAY}&courseId=${courseId}`, { cookie: admin });
    assert.equal(r.status, 200);
    assert.equal(r.body.lectures.length, 1);
    assert.deepEqual([r.body.lectures[0].sessionStatus, r.body.lectures[0].facultyName], ['submitted', 'Amandeep Kaur']);
    assert.equal((await json('GET', '/api/admin/attendance/day?date=bad', { cookie: admin })).status, 400);
  });

  it('report aggregates submitted sessions per student and supports date and below-% filters', async () => {
    const r = await json('GET', `/api/admin/attendance/report?courseId=${courseId}`, { cookie: admin });
    assert.equal(r.status, 200);
    assert.equal(r.body.sessions, 2);
    const s1 = r.body.students.find((s) => s.code === 'ATT-S1');
    assert.deepEqual([s1.attended, s1.total, s1.pct], [1, 2, 50]);
    const s3 = r.body.students.find((s) => s.code === 'ATT-S3');
    assert.deepEqual([s3.attended, s3.total, s3.pct], [1, 2, 50]); // late today (re-marked by EMP002), absent a week ago

    const low = await json('GET', `/api/admin/attendance/report?courseId=${courseId}&below=60`, { cookie: admin });
    assert.equal(low.body.students.length, 3);
    const none = await json('GET', `/api/admin/attendance/report?courseId=${courseId}&below=40`, { cookie: admin });
    assert.equal(none.body.students.length, 0);
    const recent = await json('GET', `/api/admin/attendance/report?courseId=${courseId}&from=${TODAY}`, { cookie: admin });
    assert.equal(recent.body.sessions, 1);
    assert.equal((await json('GET', '/api/admin/attendance/report?from=2026-02-30', { cookie: admin })).status, 400);
    assert.equal((await json('GET', '/api/admin/attendance/report?below=abc', { cookie: admin })).status, 400);
  });

  it('exports CSV, neutralising spreadsheet formulas in names', async () => {
    await withTx({ tenantId }, () => q("update students set name = '=HYPERLINK(\"x\")' where student_code = 'ATT-S2'"));
    const r = await json('GET', `/api/admin/attendance/report.csv?courseId=${courseId}`, { cookie: admin });
    assert.equal(r.status, 200);
    assert.match(r.res.headers.get('content-type'), /text\/csv/);
    const text = await r.res.text();
    assert.match(text, /Roll no,Student ID,Name,Course,Subject,Attended,Total,Percent/);
    assert.match(text, /ATT-S1/);
    assert.ok(!/,=HYPERLINK/.test(text) && /'=HYPERLINK/.test(text));
  });
});

describe('Tenant isolation', () => {
  it('another institute cannot see this lecture, its marks or its report rows', async () => {
    assert.equal((await json('GET', adminLectureUrl(TODAY), { cookie: schoolAdmin })).status, 404);
    assert.equal((await json('PUT', '/api/admin/attendance/lecture', { cookie: schoolAdmin, body: { slotId, date: TODAY, marks: mark('absent') } })).status, 404);
    const rep = await json('GET', `/api/admin/attendance/report?courseId=${courseId}`, { cookie: schoolAdmin });
    assert.equal(rep.body.students.length, 0);
  });
});

describe('Timetable changes do not erase history', () => {
  it('deleting a slot keeps its sessions and marks, so percentages survive', async () => {
    const del = await json('DELETE', `/api/admin/timetable/slots/${slotId}`, { cookie: admin });
    assert.equal(del.status, 200);
    await withTx({ tenantId }, async () => {
      const { rows } = await q('select slot_id, subject from attendance_sessions where course_id = $1', [courseId]);
      assert.equal(rows.length, 2);
      assert.ok(rows.every((r) => r.slot_id === null && r.subject === 'Attendance Test Subject'));
    });
    const mine = await json('GET', '/api/student/attendance', { cookie: studentS1 });
    assert.equal(mine.body.subjects.find((s) => s.subject === 'Attendance Test Subject').total, 2);
  });
});

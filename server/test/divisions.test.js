/** Three divisions of 40 in every institute, and who takes attendance - run with `npm test` (needs `npm run db:setup` first). */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { env } from '../src/config/env.js';
import { createApp } from '../src/app.js';
import { closePool, q, withTx } from '../src/db/pool.js';
import { issueCaptchaToken } from '../src/services/captcha.service.js';
import * as att from '../src/services/attendance.service.js';
import { toISO } from '../src/utils/dates.js';

let server; let base;
const T = {}; // institute code -> tenant id
const call = async (method, path, cookie, body) => {
  const r = await fetch(`${base}${path}`, { method, headers: { cookie, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  let b = null; try { b = await r.json(); } catch { /* empty */ }
  return { status: r.status, body: b };
};
async function login(tenantCode, role, identifier, password) {
  const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tenantCode, role, identifier, password, captchaToken: issueCaptchaToken() }) });
  assert.equal(r.status, 200);
  return r.headers.getSetCookie().map((c) => c.split(';')[0]).find((c) => c.startsWith(`${env.COOKIE_NAME}=`));
}
const inTenant = (code, fn) => withTx({ tenantId: T[code] }, fn);
const emp = async (code, c) => (await q('select id from employees where emp_code = $1', [c])).rows[0].id;

/** The most recent working day (a weekday that is not a holiday), so lectures exist on it */
async function lastWorkingDay(code) {
  return inTenant(code, async () => {
    const anyone = (await q('select id from employees limit 1')).rows[0].id;
    for (let back = 1; back < 40; back += 1) {
      const d = new Date(Date.now() - back * 86400000);
      if (d.getDay() === 0 || d.getDay() === 6) continue;
      const iso = toISO(d);
      if (!(await att.lecturesForEmployee(anyone, iso)).holiday) return iso;
    }
    throw new Error('no working day found');
  });
}

let admin;
before(async () => {
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  const rows = await withTx({ platform: true }, () => q("select id, code from tenants where code in ('demo-college', 'demo-school', 'demo-university')"));
  for (const r of rows.rows) T[r.code] = r.id;
  admin = await login('demo-college', 'admin', 'ADM001', 'Admin@123');
});
after(async () => { await new Promise((r) => server.close(r)); await closePool(); });

describe('three divisions of 40 in every institute', () => {
  for (const code of ['demo-college', 'demo-school', 'demo-university']) {
    it(`${code}: three classes, 40 students each, a class teacher each, and no teacher in two places at once`, async () => {
      await inTenant(code, async () => {
        const { rows: classes } = await q(`select c.id, c.code, c.class_teacher_id as ct, (select count(*)::int from students s where s.course_id = c.id and s.status = 'Active') as n,
          (select count(distinct s.section)::int from students s where s.course_id = c.id) as sections from courses c order by c.code`);
        assert.equal(classes.length, 3);
        for (const c of classes) { assert.equal(c.n, 40, c.code); assert.equal(c.sections, 1, 'one division per class'); assert.ok(c.ct, `${c.code} has a class teacher`); }
        const { rows: clash } = await q('select employee_id from timetable_slots group by employee_id, weekday, start_time having count(*) > 1');
        assert.equal(clash.length, 0, 'a teacher is never booked into two classes at the same time');
        const { rows: [{ n }] } = await q('select count(distinct employee_id)::int as n from timetable_slots');
        assert.ok(n >= 12, 'every division has its own faculty');
      });
    });
  }
});

describe('college: attendance is lecture by lecture, by the lecture\'s own teacher', () => {
  it('each teacher sees only their own lectures, and together they cover the whole day exactly once', async () => {
    const day = await lastWorkingDay('demo-college');
    await inTenant('demo-college', async () => {
      const sheet = await att.daySheet(day);
      assert.ok(sheet.lectures.length >= 12, 'three divisions x four lectures');
      assert.equal(sheet.daily, false);
      const { rows: emps } = await q('select id from employees');
      const seen = new Map();
      for (const e of emps) {
        for (const l of (await att.lecturesForEmployee(e.id, day)).lectures) {
          assert.equal(l.facultyId, e.id);
          assert.ok(!seen.has(l.slotId), 'a lecture is listed for one teacher only');
          seen.set(l.slotId, e.id);
        }
      }
      assert.equal(seen.size, sheet.lectures.length);
      for (const l of sheet.lectures) assert.equal(l.roster, 40, 'a lecture is for one division of 40');
    });
  });

  it('a teacher who is not assigned cannot open another teacher\'s register, and the assigned one gets the 40 students', async () => {
    const day = await lastWorkingDay('demo-college');
    await inTenant('demo-college', async () => {
      const sheet = await att.daySheet(day);
      const lecture = sheet.lectures[0];
      const owner = { role: 'employee', employeeId: lecture.facultyId };
      const other = { role: 'employee', employeeId: (await q('select id from employees where id <> $1 and id not in (select employee_id from timetable_slots where id = $2) limit 1', [lecture.facultyId, lecture.slotId])).rows[0].id };
      const mine = await att.getSheet({ slotId: lecture.slotId, date: day, actor: owner });
      assert.equal(mine.students.length, 40);
      await assert.rejects(att.getSheet({ slotId: lecture.slotId, date: day, actor: other }), /No such lecture/);
    });
  });
});

describe('school: one register a day, taken by the class teacher', () => {
  it('there is one register per class per day, in the first period, owned by the class teacher', async () => {
    const day = await lastWorkingDay('demo-school');
    await inTenant('demo-school', async () => {
      const sheet = await att.daySheet(day);
      assert.equal(sheet.daily, true);
      assert.equal(sheet.lectures.length, 3, 'one per class');
      const { rows: classes } = await q('select id, class_teacher_id as ct from courses');
      for (const l of sheet.lectures) {
        assert.equal(l.subject, 'Daily attendance');
        assert.equal(l.daily, true);
        assert.equal(l.facultyId, classes.find((c) => c.id === l.courseId).ct, 'the class teacher takes it');
        assert.equal(l.roster, 40);
      }
      // every class's register is the first lecture of its day
      const { rows: firsts } = await q(
        `select distinct on (course_id) id from timetable_slots where weekday = $1 order by course_id, start_time, id`, [new Date(`${day}T12:00:00`).getDay()],
      );
      assert.deepEqual(sheet.lectures.map((l) => l.slotId).sort(), firsts.map((f) => f.id).sort());
    });
  });

  it('a subject teacher cannot take the register, and the later lectures of the day have no register', async () => {
    const day = await lastWorkingDay('demo-school');
    await inTenant('demo-school', async () => {
      const { rows: classes } = await q('select id, class_teacher_id as ct from courses order by code');
      const teacherIds = new Set(classes.map((c) => c.ct));
      const subjectTeacher = (await q('select id from employees where emp_code = $1', ['EMP005'])).rows[0].id; // teaches, but is not a class teacher
      assert.ok(!teacherIds.has(subjectTeacher));
      assert.equal((await att.lecturesForEmployee(subjectTeacher, day)).lectures.length, 0, 'nothing to mark');
      const classTeacher = classes[0].ct;
      const mine = await att.lecturesForEmployee(classTeacher, day);
      assert.equal(mine.lectures.length, 1);
      assert.equal(mine.lectures[0].courseId, classes[0].id);
      // a lecture that is not first of the day is not a register
      const weekday = new Date(`${day}T12:00:00`).getDay();
      const { rows: [later] } = await q('select id from timetable_slots where course_id = $1 and weekday = $2 order by start_time desc limit 1', [classes[0].id, weekday]);
      assert.equal(await att.findLecture(later.id, day), null);
    });
  });

  it('the class teacher\'s register is saved for the whole class and shows on the student\'s attendance', async () => {
    const day = await lastWorkingDay('demo-school');
    await inTenant('demo-school', async () => {
      const { rows: [c] } = await q('select id from courses order by code limit 1');
      const lecture = (await att.daySheet(day, c.id)).lectures[0];
      const sheet = await att.getSheet({ slotId: lecture.slotId, date: day, actor: { role: 'admin', id: null } });
      const marks = sheet.students.map((s, i) => ({ studentId: s.id, status: i === 0 ? 'absent' : 'present' }));
      const saved = await att.saveSheet({ slotId: lecture.slotId, date: day, marks, submit: true, actor: { role: 'admin', id: null } });
      assert.equal(saved.session.status, 'submitted');
      assert.equal(saved.students.filter((s) => s.status === 'absent').length, 1);
    });
  });
});

describe('the class teacher and the class-wise fee list', () => {
  it('the admin can name a class teacher, and only an existing employee is accepted', async () => {
    const list = (await call('GET', '/api/admin/courses', admin)).body.courses;
    const c = list.find((x) => x.code === 'BCA-B');
    assert.ok(c.classTeacherName, 'seeded with a class teacher');
    const ct = await inTenant('demo-college', () => emp('demo-college', 'EMP004'));
    const ok = await call('PUT', `/api/admin/courses/${c.id}`, admin, { classTeacherId: ct });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.course.classTeacherId, ct);
    assert.equal((await call('PUT', `/api/admin/courses/${c.id}`, admin, { classTeacherId: '00000000-0000-4000-8000-000000000000' })).status, 400);
    await call('PUT', `/api/admin/courses/${c.id}`, admin, { classTeacherId: c.classTeacherId });
  });

  it('lists one class with what each student owes, so the desk can work down it', async () => {
    const c = (await call('GET', '/api/admin/courses', admin)).body.courses.find((x) => x.code === 'BCA-A');
    const r = await call('GET', `/api/admin/fees/class-dues?courseId=${c.id}`, admin);
    assert.equal(r.status, 200);
    assert.equal(r.body.students.length, 40);
    assert.ok(r.body.totals.outstanding > 0 && r.body.totals.clear >= 1 && r.body.totals.clear < 40, 'a mix of paid and owing');
    assert.ok(r.body.students.some((s) => s.overdue > 0), 'some are overdue');
    const first = r.body.students[0];
    assert.equal(first.studentCode, 'STU2026001');
    assert.equal(first.outstanding, Math.round((first.total - first.paid) * 100) / 100);
    assert.equal((await call('GET', '/api/admin/fees/class-dues?courseId=nope', admin)).status, 400);
  });
});

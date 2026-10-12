/** Assignments - run with `npm test` (needs `npm run db:setup` first). */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import bcrypt from 'bcryptjs';
import { env } from '../src/config/env.js';
import { createApp } from '../src/app.js';
import { closePool, q, withTx } from '../src/db/pool.js';
import { issueCaptchaToken } from '../src/services/captcha.service.js';
import { addDays } from '../src/utils/dates.js';

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
async function upload(cookie, name = 'work.pdf') {
  const fd = new FormData();
  fd.set('purpose', 'document');
  fd.set('file', new Blob([Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF')], { type: 'application/pdf' }), name);
  const r = await fetch(`${base}/api/files`, { method: 'POST', headers: { cookie }, body: fd });
  assert.equal(r.status, 201, await r.clone().text());
  return (await r.json()).file.id;
}
const open = (cookie, id) => fetch(`${base}/api/files/${id}`, { headers: { cookie } }).then((r) => r.status);
const inDays = (n) => addDays(new Date(), n).toISOString();

let admin; let schoolAdmin; let empA; let empB; let s1; let s2; let outsider; let courseId; let a1; let a2;
const ids = {};
const E = '/api/employee/assignments';
const mine = async (cookie) => (await json('GET', '/api/student/assignments', { cookie })).body.assignments;

before(async () => {
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  admin = await login('demo-college', 'admin', 'ADM001', 'Admin@123');
  schoolAdmin = await login('demo-school', 'admin', 'ADM001', 'Admin@123');
  empA = await login('demo-college', 'employee', 'EMP001', 'Employee@123');
  empB = await login('demo-college', 'employee', 'EMP002', 'Employee@123');
  outsider = await login('demo-college', 'student', 'STU2026001', 'Student@123');
  tenantId = (await withTx({ platform: true }, () => q("select id from tenants where code = 'demo-college'"))).rows[0].id;
  let empAId;
  await withTx({ tenantId }, async () => {
    empAId = (await q("select id from employees where emp_code = 'EMP001'")).rows[0].id;
    courseId = (await q("insert into courses (code, name) values ('ASGTEST', 'Assignment Test Course') returning id")).rows[0].id;
    const hash = bcrypt.hashSync('Student@123', 10);
    for (const key of ['a1', 'a2', 'a3']) {
      const code = `ASG-${key.toUpperCase()}`;
      ids[key] = (await q("insert into students (student_code, roll_no, name, email, course_id, section, status) values ($1, $2, $3, $4, $5, 'A', 'Active') returning id",
        [code, key.slice(1), `Asg ${key}`, `${code.toLowerCase()}@test.example`, courseId])).rows[0].id;
      await q("insert into users (role, login_id, email, name, password_hash, student_id) values ('student', $1, $2, $3, $4, $5)", [code, `${code.toLowerCase()}@test.example`, `Asg ${key}`, hash, ids[key]]);
    }
    await q("insert into timetable_slots (course_id, weekday, start_time, end_time, subject, employee_id) values ($1, 2, '10:00', '11:00', 'Assign Test Subject', $2)", [courseId, empAId]);
  });
  s1 = await login('demo-college', 'student', 'ASG-A1', 'Student@123');
  s2 = await login('demo-college', 'student', 'ASG-A2', 'Student@123');
});

after(async () => {
  try {
    await withTx({ tenantId }, async () => {
      await q("delete from notifications where template = 'assignmentGraded'");
      await q("delete from assignments where course_id = $1", [courseId]);
      await q("delete from users where login_id like 'ASG-%'");
      await q("delete from students where student_code like 'ASG-%'");
      await q("delete from courses where code = 'ASGTEST'");
    });
  } finally {
    await new Promise((r) => server.close(r));
    await closePool();
  }
});

describe('Setting work', () => {
  it('a teacher sees the class and subject from their timetable, and only those', async () => {
    const a = await json('GET', `${E}/scope`, { cookie: empA });
    assert.ok(a.body.scope.some((p) => p.courseId === courseId && p.subject === 'Assign Test Subject'));
    const b = await json('GET', `${E}/scope`, { cookie: empB });
    assert.ok(!b.body.scope.some((p) => p.courseId === courseId));
  });

  it('refuses bad input and teachers who do not teach the subject', async () => {
    const good = { courseId, subject: 'Assign Test Subject', title: 'Essay 1', dueAt: inDays(5), maxMarks: 20 };
    assert.equal((await json('POST', E, { cookie: empA, body: { ...good, title: '' } })).status, 400);
    assert.equal((await json('POST', E, { cookie: empA, body: { ...good, dueAt: 'soon' } })).status, 400);
    assert.equal((await json('POST', E, { cookie: empA, body: { ...good, maxMarks: 0 } })).status, 400);
    assert.equal((await json('POST', E, { cookie: empA, body: { ...good, courseId: 'x' } })).status, 400);
    assert.equal((await json('POST', E, { cookie: empB, body: good })).status, 403);
    assert.equal((await json('POST', E, { cookie: empA, body: { ...good, subject: 'Not Mine' } })).status, 403);
  });

  it('creates a draft that students cannot see until it is published', async () => {
    const r = await json('POST', E, { cookie: empA, body: { courseId, subject: 'Assign Test Subject', title: 'Essay 1', description: 'Write 500 words', dueAt: inDays(5), maxMarks: 20 } });
    assert.equal(r.status, 201); assert.equal(r.body.assignment.status, 'draft');
    a1 = r.body.assignment.id;
    assert.equal((await mine(s1)).length, 0);
    assert.equal((await json('POST', `${E}/${a1}/publish`, { cookie: empB })).status, 404);
    assert.equal((await json('POST', `${E}/${a1}/publish`, { cookie: empA })).body.assignment.status, 'published');
    assert.equal((await json('POST', `${E}/${a1}/publish`, { cookie: empA })).status, 409);
  });

  it('shows it to the class as pending, and not to another class', async () => {
    const list = await mine(s1);
    assert.equal(list.length, 1); assert.equal(list[0].state, 'pending'); assert.equal(list[0].maxMarks, 20);
    assert.equal((await mine(outsider)).some((a) => a.id === a1), false);
    assert.equal((await json('GET', `/api/student/assignments/${a1}`, { cookie: outsider })).status, 404);
  });
});

describe('Handing in work', () => {
  it('needs an answer or a file, and the file must be the student\'s own', async () => {
    assert.equal((await json('POST', `/api/student/assignments/${a1}/submit`, { cookie: s1, body: {} })).status, 400);
    const theirs = await upload(s2);
    assert.equal((await json('POST', `/api/student/assignments/${a1}/submit`, { cookie: s1, body: { fileId: theirs } })).status, 400);
  });

  it('accepts an answer with a file, and the teacher (only) can open that file', async () => {
    const file = await upload(s1);
    const r = await json('POST', `/api/student/assignments/${a1}/submit`, { cookie: s1, body: { answer: 'My essay', fileId: file } });
    assert.equal(r.status, 200); assert.equal(r.body.assignment.state, 'submitted'); assert.equal(r.body.assignment.late, false);
    assert.equal(await open(empA, file), 200);
    assert.equal(await open(empB, file), 404);
    assert.equal(await open(s2, file), 404);
    assert.equal(await open(admin, file), 200);
  });

  it('lets the class open the attachment the teacher added, and nobody else', async () => {
    const att = await upload(empA, 'brief.pdf');
    const u = await json('PUT', `${E}/${a1}`, { cookie: empA, body: { title: 'Essay 1', dueAt: inDays(5), maxMarks: 20, attachmentFileId: att } });
    assert.equal(u.status, 200);
    assert.equal(await open(s2, att), 200);
    assert.equal(await open(outsider, att), 404);
  });

  it('marks work after the due date as late, or refuses it when late work is not allowed', async () => {
    const r = await json('POST', E, { cookie: empA, body: { courseId, subject: 'Assign Test Subject', title: 'Quiz sheet', dueAt: inDays(2), maxMarks: 5, publish: true, allowLate: false } });
    a2 = r.body.assignment.id;
    await withTx({ tenantId }, () => q("update assignments set due_at = now() - interval '1 day' where id = $1", [a2]));
    assert.equal((await mine(s1)).find((a) => a.id === a2).state, 'overdue');
    assert.equal((await json('POST', `/api/student/assignments/${a2}/submit`, { cookie: s1, body: { answer: 'x' } })).status, 409);
    await json('PUT', `${E}/${a2}`, { cookie: empA, body: { title: 'Quiz sheet', dueAt: new Date(Date.now() - 86_400_000).toISOString(), maxMarks: 5, allowLate: true } });
    const late = await json('POST', `/api/student/assignments/${a2}/submit`, { cookie: s1, body: { answer: 'late answer' } });
    assert.equal(late.status, 200); assert.equal(late.body.assignment.late, true);
  });
});

describe('Marking', () => {
  it('lists every student of the class, and hides it from other teachers and institutes', async () => {
    const d = await json('GET', `${E}/${a1}`, { cookie: empA });
    assert.equal(d.body.students.length, 3);
    assert.equal(d.body.students.find((s) => s.name === 'Asg a1').status, 'submitted');
    assert.equal(d.body.students.find((s) => s.name === 'Asg a2').status, 'pending');
    assert.equal((await json('GET', `${E}/${a1}`, { cookie: empB })).status, 404);
    assert.equal((await json('GET', `/api/admin/assignments/${a1}`, { cookie: schoolAdmin })).status, 404);
    assert.equal((await json('GET', `/api/admin/assignments/${a1}`, { cookie: admin })).status, 200);
  });

  it('grades within the maximum, tells the student, and locks the work', async () => {
    const url = `${E}/${a1}/submissions/${ids.a1}`;
    assert.equal((await json('PUT', url, { cookie: empA, body: { marks: 25 } })).status, 400);
    assert.equal((await json('PUT', url, { cookie: empA, body: {} })).status, 400);
    assert.equal((await json('PUT', url, { cookie: empB, body: { marks: 10 } })).status, 404);
    const r = await json('PUT', url, { cookie: empA, body: { marks: 17.5, feedback: 'Good structure' } });
    assert.equal(r.status, 200); assert.equal(r.body.submission.status, 'graded'); assert.equal(r.body.submission.marks, 17.5);
    const mineNow = (await mine(s1)).find((a) => a.id === a1);
    assert.equal(mineNow.state, 'graded'); assert.equal(mineNow.marks, 17.5); assert.equal(mineNow.feedback, 'Good structure');
    assert.equal((await json('POST', `/api/student/assignments/${a1}/submit`, { cookie: s1, body: { answer: 'again' } })).status, 409);
    const n = (await withTx({ tenantId }, () => q("select count(*)::int n from notifications where template = 'assignmentGraded'"))).rows[0].n;
    assert.ok(n >= 1);
    assert.equal((await json('PUT', `${E}/${a1}/submissions/${ids.a3}`, { cookie: empA, body: { marks: 5 } })).status, 404); // nothing submitted
  });

  it('sends work back with feedback, and the student can send it again', async () => {
    await json('POST', `/api/student/assignments/${a1}/submit`, { cookie: s2, body: { answer: 'first try' } });
    const url = `${E}/${a1}/submissions/${ids.a2}`;
    assert.equal((await json('PUT', url, { cookie: empA, body: { action: 'return' } })).status, 400);
    assert.equal((await json('PUT', url, { cookie: empA, body: { action: 'return', feedback: 'Add sources' } })).body.submission.status, 'returned');
    assert.equal((await mine(s2)).find((a) => a.id === a1).state, 'returned');
    const again = await json('POST', `/api/student/assignments/${a1}/submit`, { cookie: s2, body: { answer: 'second try' } });
    assert.equal(again.body.assignment.state, 'submitted');
  });

  it('cannot cut the maximum below marks already given, and leaves nothing half-changed', async () => {
    const r = await json('PUT', `${E}/${a1}`, { cookie: empA, body: { title: 'Renamed', dueAt: inDays(5), maxMarks: 10 } });
    assert.equal(r.status, 409);
    const d = await json('GET', `${E}/${a1}`, { cookie: empA });
    assert.equal(d.body.assignment.maxMarks, 20); assert.equal(d.body.assignment.title, 'Essay 1');
  });
});

describe('Closing and deleting', () => {
  it('a closed assignment takes no more work, and can be reopened', async () => {
    assert.equal((await json('POST', `${E}/${a1}/close`, { cookie: empA })).body.assignment.status, 'closed');
    assert.equal((await json('POST', `/api/student/assignments/${a1}/submit`, { cookie: s2, body: { answer: 'x' } })).status, 409);
    assert.equal((await mine(s1)).find((a) => a.id === a1).state, 'graded');
    assert.equal((await json('POST', `${E}/${a1}/reopen`, { cookie: empA })).body.assignment.status, 'published');
  });

  it('refuses to delete work that has submissions, and deletes an empty one', async () => {
    assert.equal((await json('DELETE', `${E}/${a1}`, { cookie: empA })).status, 409);
    const e = await json('POST', E, { cookie: empA, body: { courseId, subject: 'Assign Test Subject', title: 'Empty', dueAt: inDays(3) } });
    assert.equal((await json('DELETE', `${E}/${e.body.assignment.id}`, { cookie: empB })).status, 404);
    assert.equal((await json('DELETE', `${E}/${e.body.assignment.id}`, { cookie: empA })).status, 200);
  });

  it('the office list shows counts for every class', async () => {
    const r = await json('GET', '/api/admin/assignments', { cookie: admin });
    const row = r.body.assignments.find((a) => a.id === a1);
    assert.equal(row.roster, 3); assert.ok(row.submitted >= 2);
    assert.equal((await json('GET', '/api/employee/assignments', { cookie: empB })).body.assignments.some((a) => a.id === a1), false);
  });
});

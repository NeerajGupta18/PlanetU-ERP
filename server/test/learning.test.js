/** Learning platform (MOOC courses for compulsory credits) - run with `npm test` (needs `npm run db:setup` first). */
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
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
async function uploadPdf(cookie, name = 'certificate.pdf') {
  const form = new FormData(); form.append('file', new Blob([PDF], { type: 'application/pdf' }), name); form.append('purpose', 'document');
  const r = await fetch(`${base}/api/files`, { method: 'POST', headers: { cookie }, body: form });
  const b = await r.json(); assert.equal(r.status, 201, JSON.stringify(b));
  return b.file?.id ?? b.id;
}

const TODAY = toISO(new Date());
const SUBJ = 'Learning Test Subject';
let admin; let schoolAdmin; let empA; let empB; let st1; let st2; let st3; let tenantId; let schoolTenantId; let courseId; let empAId; let empBId;
const ids = {};

before(async () => {
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  admin = await login('demo-college', 'admin', 'ADM001', 'Admin@123');
  schoolAdmin = await login('demo-school', 'admin', 'ADM001', 'Admin@123');
  empA = await login('demo-college', 'employee', 'EMP001', 'Employee@123');
  empB = await login('demo-college', 'employee', 'EMP002', 'Employee@123');
  tenantId = (await withTx({ platform: true }, () => q("select id from tenants where code = 'demo-college'"))).rows[0].id;
  schoolTenantId = (await withTx({ platform: true }, () => q("select id from tenants where code = 'demo-school'"))).rows[0].id;
  await withTx({ tenantId }, async () => {
    empAId = (await q("select id from employees where emp_code = 'EMP001'")).rows[0].id;
    empBId = (await q("select id from employees where emp_code = 'EMP002'")).rows[0].id;
    courseId = (await q("insert into courses (code, name) values ('LRNTEST', 'Learning Test Class') returning id")).rows[0].id;
    const hash = bcrypt.hashSync('Student@123', 8);
    for (const [key, code, name, roll, sem, sec, status] of [
      ['s1', 'LRN-S1', 'Alpha One', '1', 3, 'A', 'Active'], ['s2', 'LRN-S2', 'Beta Two', '2', 3, 'A', 'Active'], ['s3', 'LRN-S3', 'Gamma Three', '3', 3, 'B', 'Active'],
      ['gone', 'LRN-S4', 'Delta Inactive', '4', 3, 'A', 'Inactive'], ['other', 'LRN-S5', 'Epsilon OtherSem', '5', 4, 'A', 'Active'],
    ]) {
      ids[key] = (await q(
        'insert into students (student_code, roll_no, name, email, course_id, semester, section, status) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id',
        [code, roll, name, `${code.toLowerCase()}@lrntest.example`, courseId, sem, sec, status],
      )).rows[0].id;
      if (['s1', 's2', 's3'].includes(key)) {
        await q("insert into users (role, login_id, email, name, password_hash, student_id) values ('student', $1, $2, $3, $4, $5)", [code, `${code.toLowerCase()}@lrntest.example`, name, hash, ids[key]]);
      }
    }
    // EMP001 teaches SUBJ in this class; EMP002 does not
    await q("insert into timetable_slots (course_id, weekday, start_time, end_time, subject, employee_id) values ($1, 1, '21:00', '21:30', $2, $3)", [courseId, SUBJ, empAId]);
  });
  st1 = await login('demo-college', 'student', 'LRN-S1', 'Student@123');
  st2 = await login('demo-college', 'student', 'LRN-S2', 'Student@123');
  st3 = await login('demo-college', 'student', 'LRN-S3', 'Student@123');
});

after(async () => {
  try {
    await withTx({ tenantId }, async () => {
      await q("delete from learning_assignments where target_course_id = $1", [courseId]);
      await q("delete from learning_courses where title like 'LT %'");
      await q("delete from users where login_id like 'LRN-S%'");
      await q("delete from students where student_code like 'LRN-S%'");
      await q("delete from courses where code = 'LRNTEST'");
    });
  } finally {
    await new Promise((r) => server.close(r));
    await closePool();
  }
});

const lessons = (n = 3) => Array.from({ length: n }, (_, i) => ({ title: `Lesson ${i + 1}`, kind: 'reading', body: `Body ${i + 1}`, durationMin: 5 }));
const mkCourse = async (cookie, extra = {}, path = '/api/admin/learning/courses') => json('POST', path, { cookie, body: { title: 'LT Course', provider: 'NPTEL', url: 'https://nptel.ac.in/x', subject: SUBJ, credits: 2, status: 'published', ...extra } });
const assign = (cookie, body, path = '/api/admin/learning/assignments') => json('POST', path, { cookie, body: { courseId, semester: 3, subject: SUBJ, dueDate: addDays(new Date(), 20) && toISO(addDays(new Date(), 20)), ...body } });
const enrolmentOf = async (assignmentId, studentKey) => (await withTx({ tenantId }, () => q('select id, status, credits_awarded::float8 as credits from learning_enrollments where assignment_id = $1 and student_id = $2', [assignmentId, ids[studentKey]]))).rows[0];

describe('Access and module gating', () => {
  it('keeps the roles apart', async () => {
    assert.equal((await json('GET', '/api/admin/learning/courses', { cookie: st1 })).status, 403);
    assert.equal((await json('GET', '/api/employee/learning/courses', { cookie: admin })).status, 403);
    assert.equal((await json('GET', '/api/student/learning', { cookie: empA })).status, 403);
    assert.equal((await json('GET', '/api/student/learning')).status, 401);
  });

  it('is blocked everywhere when the institute has the module switched off', async () => {
    const original = (await withTx({ platform: true }, () => q('select modules from tenants where id = $1', [schoolTenantId]))).rows[0].modules;
    try {
      await withTx({ platform: true }, () => q("update tenants set modules = array_remove(modules, 'learning') where id = $1", [schoolTenantId]));
      const r = await json('GET', '/api/admin/learning/courses', { cookie: schoolAdmin });
      assert.equal(r.status, 403);
    } finally {
      await withTx({ platform: true }, () => q('update tenants set modules = $1 where id = $2', [original, schoolTenantId]));
    }
  });
});

describe('Course catalogue', () => {
  it('validates the course, its links and its lessons', async () => {
    const bad = (body) => mkCourse(admin, body);
    assert.equal((await bad({ title: '' })).status, 400);
    assert.equal((await bad({ provider: 'Acme' })).status, 400);
    assert.equal((await bad({ credits: 1.3 })).status, 400, 'credits go in half steps');
    assert.equal((await bad({ credits: 25 })).status, 400);
    assert.equal((await bad({ url: 'javascript:alert(1)' })).status, 400, 'only web addresses');
    assert.equal((await bad({ url: 'ftp://x.example/a' })).status, 400);
    assert.equal((await bad({ status: 'published', url: '' })).status, 400, 'a published MOOC needs its link');
    assert.equal((await bad({ provider: 'Internal', completion: 'lessons', status: 'published', url: '' })).status, 400, 'a lessons course needs lessons to publish');
    assert.equal((await bad({ completion: 'evidence', lessons: lessons(1) })).status, 400, 'a certificate course has no lessons');
    assert.equal((await bad({ provider: 'Internal', completion: 'lessons', lessons: [{ title: 'x', kind: 'video', url: '' }] })).status, 400, 'a video lesson needs its link');
    assert.equal((await bad({ provider: 'Internal', completion: 'lessons', lessons: [{ title: 'x', kind: 'reading', body: '' }] })).status, 400);
    const ok = await mkCourse(admin, { title: 'LT Valid MOOC' });
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    assert.deepEqual([ok.body.course.provider, ok.body.course.completion, ok.body.course.credits], ['NPTEL', 'evidence', 2]);
  });

  it('a faculty member sees published courses and their own drafts, and edits only their own', async () => {
    const draft = (await mkCourse(empA, { title: 'LT A Draft', status: 'draft' }, '/api/employee/learning/courses')).body.course;
    const published = (await mkCourse(admin, { title: 'LT Admin Published' })).body.course;
    const a = (await json('GET', '/api/employee/learning/courses', { cookie: empA })).body.courses.map((c) => c.title);
    const b = (await json('GET', '/api/employee/learning/courses', { cookie: empB })).body.courses.map((c) => c.title);
    assert.ok(a.includes('LT A Draft') && a.includes('LT Admin Published'));
    assert.ok(!b.includes('LT A Draft'), "another teacher's draft is invisible");
    assert.ok(b.includes('LT Admin Published'));
    assert.equal((await json('GET', `/api/employee/learning/courses/${draft.id}`, { cookie: empB })).status, 404);
    assert.equal((await json('PUT', `/api/employee/learning/courses/${published.id}`, { cookie: empA, body: { title: 'Hijacked' } })).status, 403, 'not the owner');
    assert.equal((await json('PUT', `/api/employee/learning/courses/${draft.id}`, { cookie: empA, body: { title: 'LT A Draft v2' } })).status, 200);
    assert.equal((await json('GET', `/api/admin/learning/courses/${draft.id}`, { cookie: admin })).status, 200, 'an admin sees everything');
  });

  it('keeps students\' lesson progress when a course is edited, and drops only the lessons taken out', async () => {
    const c = (await mkCourse(admin, { title: 'LT Editable', provider: 'Internal', completion: 'lessons', url: '', lessons: lessons(3) })).body.course;
    const a = (await assign(admin, { learningCourseId: c.id, section: 'A' })).body;
    const enr = await enrolmentOf(a.assignment.id, 's1');
    const [l1, l2, l3] = c.lessons;
    await json('PUT', `/api/student/learning/${enr.id}/lessons/${l1.id}`, { cookie: st1, body: { done: true } });
    const edit = await json('PUT', `/api/admin/learning/courses/${c.id}`, { cookie: admin, body: { lessons: [{ ...l1, title: 'Lesson 1 renamed' }, l3] } });
    assert.equal(edit.status, 200, JSON.stringify(edit.body));
    assert.deepEqual(edit.body.course.lessons.map((l) => l.title), ['Lesson 1 renamed', 'Lesson 3']);
    const mine = (await json('GET', `/api/student/learning/${enr.id}`, { cookie: st1 })).body.item;
    assert.equal(mine.lessonList.find((l) => l.id === l1.id).done, true, 'progress on a kept lesson survives the edit');
    assert.ok(!mine.lessonList.some((l) => l.id === l2.id));
    assert.equal((await json('PUT', `/api/admin/learning/courses/${c.id}`, { cookie: admin, body: { completion: 'evidence', url: 'https://x.example' } })).status, 409, 'how it is completed cannot change once assigned');
  });

  it('a course that has been assigned cannot be deleted; an unused one can', async () => {
    const used = (await json('GET', '/api/admin/learning/courses', { cookie: admin })).body.courses.find((c) => c.title === 'LT Editable');
    assert.equal((await json('DELETE', `/api/admin/learning/courses/${used.id}`, { cookie: admin })).status, 409);
    const spare = (await mkCourse(admin, { title: 'LT Spare' })).body.course;
    assert.equal((await json('DELETE', `/api/admin/learning/courses/${spare.id}`, { cookie: admin })).status, 200);
  });
});

describe('Assigning courses to a class and subject', () => {
  let course;
  it('a teacher can only assign for subjects they teach; an admin for any', async () => {
    course = (await mkCourse(admin, { title: 'LT Assign MOOC' })).body.course;
    const own = await assign(empA, { learningCourseId: course.id, subject: SUBJ.toLowerCase() }, '/api/employee/learning/assignments');
    assert.equal(own.status, 201, JSON.stringify(own.body));
    const notTeacher = await assign(empB, { learningCourseId: course.id }, '/api/employee/learning/assignments');
    assert.equal(notTeacher.status, 403);
    assert.match(notTeacher.body.message, /subject you teach/);
    const otherSubject = await assign(empA, { learningCourseId: course.id, subject: 'Some Other Subject' }, '/api/employee/learning/assignments');
    assert.equal(otherSubject.status, 403);
    const scope = (await json('GET', '/api/employee/learning/subjects', { cookie: empA })).body.scope;
    assert.ok(scope.some((s) => s.subject === SUBJ && s.courseId === courseId));
    assert.ok(!(await json('GET', '/api/employee/learning/subjects', { cookie: empB })).body.scope.some((s) => s.subject === SUBJ));
  });

  it('enrols the class\'s active students of that semester, not inactive students or other semesters, and refuses duplicates', async () => {
    const list = await json('GET', '/api/admin/learning/assignments', { cookie: admin });
    const a = list.body.assignments.find((x) => x.courseTitle === 'LT Assign MOOC');
    assert.equal(a.total, 3, 'three active students in semester 3');
    const detail = (await json('GET', `/api/admin/learning/assignments/${a.id}`, { cookie: admin })).body;
    assert.deepEqual(detail.students.map((s) => s.code).sort(), ['LRN-S1', 'LRN-S2', 'LRN-S3']);
    const dupe = await assign(admin, { learningCourseId: course.id });
    assert.equal(dupe.status, 409);
  });

  it('can target one section only', async () => {
    const c = (await mkCourse(admin, { title: 'LT Section Course' })).body.course;
    const r = await assign(admin, { learningCourseId: c.id, section: 'B' });
    assert.equal(r.status, 201);
    assert.deepEqual(r.body.students.map((s) => s.code), ['LRN-S3']);
  });

  it('validates the request: unpublished course, unknown class, past due date, bad semester and credits', async () => {
    const draft = (await mkCourse(admin, { title: 'LT Unpublished', status: 'draft' })).body.course;
    assert.equal((await assign(admin, { learningCourseId: draft.id })).status, 400);
    assert.equal((await assign(admin, { learningCourseId: course.id, courseId: '00000000-0000-4000-8000-000000000000', subject: 'Anything' })).status, 400);
    const c = (await mkCourse(admin, { title: 'LT Validation' })).body.course;
    assert.equal((await assign(admin, { learningCourseId: c.id, dueDate: toISO(addDays(new Date(), -2)) })).status, 400);
    assert.equal((await assign(admin, { learningCourseId: c.id, semester: 99 })).status, 400);
    assert.equal((await assign(admin, { learningCourseId: c.id, credits: 0.7 })).status, 400);
    assert.equal((await assign(admin, { learningCourseId: c.id, subject: '' })).status, 400);
    const ok = await assign(admin, { learningCourseId: c.id, credits: 3, mandatory: false });
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    assert.deepEqual([ok.body.assignment.credits, ok.body.assignment.mandatory], [3, false], 'the assignment can override the course\'s credits');
  });

  it('students who join the class later are added by "sync", once', async () => {
    const a = (await json('GET', '/api/admin/learning/assignments', { cookie: admin })).body.assignments.find((x) => x.courseTitle === 'LT Assign MOOC');
    await withTx({ tenantId }, () => q("insert into students (student_code, name, email, course_id, semester, section, status) values ('LRN-S6', 'Late Joiner', 'lrn-s6@lrntest.example', $1, 3, 'A', 'Active')", [courseId]));
    const first = await json('POST', `/api/admin/learning/assignments/${a.id}/sync`, { cookie: admin });
    assert.equal(first.body.added, 1);
    assert.equal((await json('POST', `/api/admin/learning/assignments/${a.id}/sync`, { cookie: admin })).body.added, 0, 'idempotent');
    assert.equal((await json('POST', `/api/employee/learning/assignments/${a.id}/sync`, { cookie: empB })).status, 404, 'not your assignment');
  });
});

describe('The student side', () => {
  it('shows a student only their own assignments, with credits required and earned', async () => {
    const mine = (await json('GET', '/api/student/learning', { cookie: st1 })).body;
    assert.ok(mine.items.length >= 3);
    assert.ok(mine.items.every((i) => i.title && i.subject && typeof i.credits === 'number'));
    assert.ok(mine.summary.required >= 2 && mine.summary.earned === 0);
    const other = await withTx({ tenantId }, async () => (await q("select count(*)::int as n from learning_enrollments where student_id = $1", [ids.s1])).rows[0].n);
    assert.equal(mine.items.length, other);
    const enr = mine.items[0].id;
    assert.equal((await json('GET', `/api/student/learning/${enr}`, { cookie: st2 })).status, 404, "cannot open another student's enrolment");
    assert.equal((await json('POST', `/api/student/learning/${enr}/start`, { cookie: st2 })).status, 404);
  });
});

describe('Completing an in-house course by lessons', () => {
  let a; let enr; let course;
  it('progress moves it to in-progress, and finishing every lesson completes it and awards the credits at once', async () => {
    course = (await mkCourse(admin, { title: 'LT Lessons Course', provider: 'Internal', completion: 'lessons', url: '', credits: 1.5, lessons: lessons(3) })).body.course;
    a = (await assign(admin, { learningCourseId: course.id, section: 'A' })).body.assignment;
    enr = await enrolmentOf(a.id, 's1');
    const [l1, l2, l3] = course.lessons;
    const put = (l, done) => json('PUT', `/api/student/learning/${enr.id}/lessons/${l.id}`, { cookie: st1, body: { done } });
    let r = await put(l1, true);
    assert.deepEqual([r.body.item.status, r.body.item.progress], ['in_progress', 33]);
    r = await put(l2, true); r = await put(l2, false);
    assert.equal(r.body.item.progress, 33, 'a lesson can be un-ticked before the course is finished');
    await put(l2, true);
    r = await put(l3, true);
    assert.deepEqual([r.body.item.status, r.body.item.creditsAwarded, r.body.item.progress], ['completed', 1.5, 100]);
    assert.equal((await put(l3, false)).status, 409, 'a completed course stays completed');
    const sum = (await json('GET', '/api/student/learning', { cookie: st1 })).body.summary;
    assert.ok(sum.earned >= 1.5);
  });
  it('a lesson of another course is not found, and a lessons course cannot be completed with a certificate', async () => {
    const other = (await mkCourse(admin, { title: 'LT Lessons Other', provider: 'Internal', completion: 'lessons', url: '', lessons: lessons(1) })).body.course;
    assert.equal((await json('PUT', `/api/student/learning/${(await enrolmentOf(a.id, 's2')).id}/lessons/${other.lessons[0].id}`, { cookie: st2, body: { done: true } })).status, 404);
    assert.equal((await json('POST', `/api/student/learning/${(await enrolmentOf(a.id, 's2')).id}/submit`, { cookie: st2, body: { evidenceUrl: 'https://x.example/c' } })).status, 409);
  });
});

describe('Completing an external MOOC with a certificate', () => {
  let a; let enr1; let enr2; let course;
  before(async () => {
    course = (await mkCourse(admin, { title: 'LT Cert MOOC', credits: 2 })).body.course;
    a = (await assign(empA, { learningCourseId: course.id, section: 'A' }, '/api/employee/learning/assignments')).body.assignment;
    enr1 = await enrolmentOf(a.id, 's1'); enr2 = await enrolmentOf(a.id, 's2');
  });
  const submit = (cookie, id, body) => json('POST', `/api/student/learning/${id}/submit`, { cookie, body });

  it('needs real evidence: a link or a file, a web address, a score in range, and only the student\'s own file', async () => {
    assert.equal((await submit(st1, enr1.id, {})).status, 400);
    assert.equal((await submit(st1, enr1.id, { evidenceUrl: 'javascript:alert(1)' })).status, 400);
    assert.equal((await submit(st1, enr1.id, { evidenceUrl: 'https://x.example/c', score: 140 })).status, 400);
    const theirs = await uploadPdf(st2);
    assert.equal((await submit(st1, enr1.id, { fileId: theirs })).status, 400, 'a file uploaded by someone else cannot be attached');
    assert.equal((await submit(st1, enr1.id, { fileId: '00000000-0000-4000-8000-000000000000' })).status, 400);
  });

  it('submit -> waiting for review; it cannot be submitted twice or reviewed by an unrelated teacher', async () => {
    const file = await uploadPdf(st1);
    const r = await submit(st1, enr1.id, { evidenceUrl: 'https://nptel.ac.in/verify/123', fileId: file, certificateId: 'NPTEL-123', score: 81.5, note: 'July term' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual([r.body.item.status, r.body.item.certificateId, r.body.item.score], ['submitted', 'NPTEL-123', 81.5]);
    assert.equal((await submit(st1, enr1.id, { evidenceUrl: 'https://x.example/again' })).status, 409);
    assert.equal((await json('POST', `/api/employee/learning/enrollments/${enr1.id}/review`, { cookie: empB, body: { decision: 'approve' } })).status, 404, 'a teacher outside this subject cannot review it');
    enr1.file = file;
  });

  it('the teacher sees it in the review queue and can open the certificate; nobody else can', async () => {
    const queue = (await json('GET', '/api/employee/learning/review', { cookie: empA })).body.queue;
    const item = queue.find((x) => x.id === enr1.id);
    assert.ok(item);
    assert.equal(item.evidenceFileId, enr1.file);
    assert.equal((await json('GET', '/api/employee/learning/review', { cookie: empB })).body.queue.some((x) => x.id === enr1.id), false);
    const open = (cookie) => fetch(`${base}/api/files/${enr1.file}`, { headers: { cookie } });
    assert.equal((await open(empA)).status, 200, 'the reviewing teacher can open it');
    assert.equal((await open(admin)).status, 200);
    assert.equal((await open(st1)).status, 200, 'and the student who uploaded it');
    assert.equal((await open(empB)).status, 404, 'a teacher with no link to it cannot');
    assert.equal((await open(st2)).status, 404, 'nor another student');
  });

  it('rejecting needs a reason and lets the student resubmit; the reason is shown to them', async () => {
    const noReason = await json('POST', `/api/employee/learning/enrollments/${enr1.id}/review`, { cookie: empA, body: { decision: 'reject' } });
    assert.equal(noReason.status, 400);
    const rej = await json('POST', `/api/employee/learning/enrollments/${enr1.id}/review`, { cookie: empA, body: { decision: 'reject', note: 'The certificate is not legible.' } });
    assert.equal(rej.status, 200, JSON.stringify(rej.body));
    const mine = (await json('GET', `/api/student/learning/${enr1.id}`, { cookie: st1 })).body.item;
    assert.deepEqual([mine.status, mine.reviewNote], ['rejected', 'The certificate is not legible.']);
    assert.equal((await submit(st1, enr1.id, { evidenceUrl: 'https://nptel.ac.in/verify/123-better' })).status, 200, 'a rejected submission can be redone');
  });

  it('approving awards the credits (never more than the course is worth), once', async () => {
    const tooMany = await json('POST', `/api/employee/learning/enrollments/${enr1.id}/review`, { cookie: empA, body: { decision: 'approve', credits: 3 } });
    assert.equal(tooMany.status, 400);
    const ok = await json('POST', `/api/employee/learning/enrollments/${enr1.id}/review`, { cookie: empA, body: { decision: 'approve', note: 'Verified on NPTEL.' } });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    const row = ok.body.students.find((s) => s.code === 'LRN-S1');
    assert.deepEqual([row.status, row.creditsAwarded], ['completed', 2]);
    assert.equal((await json('POST', `/api/employee/learning/enrollments/${enr1.id}/review`, { cookie: empA, body: { decision: 'approve' } })).status, 409, 'cannot be reviewed twice');
    assert.equal((await json('POST', `/api/employee/learning/enrollments/${enr2.id}/review`, { cookie: empA, body: { decision: 'approve' } })).status, 409, 'not submitted yet');
    assert.equal((await submit(st1, enr1.id, { evidenceUrl: 'https://x.example/more' })).status, 409, 'a completed course cannot be resubmitted');
  });

  it('a partial award is possible, and the credits cannot be changed once anyone has earned them', async () => {
    await submit(st2, enr2.id, { evidenceUrl: 'https://nptel.ac.in/verify/456' });
    const half = await json('POST', `/api/admin/learning/enrollments/${enr2.id}/review`, { cookie: admin, body: { decision: 'approve', credits: 1 } });
    assert.equal(half.body.students.find((s) => s.code === 'LRN-S2').creditsAwarded, 1);
    assert.equal((await json('PUT', `/api/employee/learning/assignments/${a.id}`, { cookie: empA, body: { credits: 4 } })).status, 409);
    const due = await json('PUT', `/api/employee/learning/assignments/${a.id}`, { cookie: empA, body: { mandatory: false, note: 'Now optional' } });
    assert.equal(due.status, 200);
    assert.equal(due.body.assignment.mandatory, false);
  });

  it('an assignment with submitted or completed work cannot be withdrawn; an untouched one can', async () => {
    assert.equal((await json('DELETE', `/api/admin/learning/assignments/${a.id}`, { cookie: admin })).status, 409);
    const c = (await mkCourse(admin, { title: 'LT Withdraw' })).body.course;
    const fresh = (await assign(admin, { learningCourseId: c.id })).body.assignment;
    assert.equal((await json('DELETE', `/api/admin/learning/assignments/${fresh.id}`, { cookie: admin })).status, 200);
  });
});

describe('Compulsory credits: who still owes what', () => {
  it('totals required, earned, pending and overdue per student, and flags those behind', async () => {
    const c = (await mkCourse(admin, { title: 'LT Overdue Course', credits: 1 })).body.course;
    const a = (await assign(admin, { learningCourseId: c.id, section: 'A' })).body.assignment;
    await withTx({ tenantId }, () => q('update learning_assignments set due_date = $2 where id = $1', [a.id, toISO(addDays(new Date(), -3))]));
    const rows = (await json('GET', `/api/admin/learning/compliance?courseId=${courseId}&semester=3`, { cookie: admin })).body.students;
    const by = Object.fromEntries(rows.map((r) => [r.code, r]));
    assert.ok(by['LRN-S1'].required >= by['LRN-S1'].earned);
    assert.ok(by['LRN-S3'].required >= 0);
    assert.equal(by['LRN-S2'].overdue >= 1, true, 'a compulsory course past its due date counts as overdue');
    assert.equal(by['LRN-S2'].standing, 'overdue');
    assert.equal(by['LRN-S1'].pending, Math.max(0, by['LRN-S1'].required - by['LRN-S1'].earned));
    const mine = (await json('GET', '/api/student/learning', { cookie: st2 })).body;
    assert.ok(mine.summary.overdue >= 1);
    assert.ok(mine.items.find((i) => i.title === 'LT Overdue Course').overdue);
    const teacher = (await json('GET', `/api/employee/learning/compliance?courseId=${courseId}`, { cookie: empB })).body.students;
    assert.equal(teacher.length, 0, 'a teacher with no link to these assignments sees nobody');
  });

  it('the Reports hub exports it', async () => {
    const r = await json('GET', `/api/admin/reports/learning-credits?courseId=${courseId}&semester=3&format=xlsx`, { cookie: admin });
    assert.equal(r.status, 200);
    assert.equal(Buffer.from(await r.res.arrayBuffer()).subarray(0, 2).toString(), 'PK');
    const j = await json('GET', `/api/admin/reports/learning-credits?courseId=${courseId}&semester=3`, { cookie: admin });
    assert.ok(j.body.rows.some((x) => x.code === 'LRN-S1'));
    assert.ok(j.body.columns.some((c) => c.header === 'Credits required'));
  });
});

describe('Institute isolation', () => {
  it('another institute sees none of it', async () => {
    assert.equal((await json('GET', '/api/admin/learning/assignments', { cookie: schoolAdmin })).body.assignments.some((x) => x.courseTitle.startsWith('LT ')), false);
    const c = (await json('GET', '/api/admin/learning/courses', { cookie: admin })).body.courses.find((x) => x.title === 'LT Valid MOOC');
    assert.equal((await json('GET', `/api/admin/learning/courses/${c.id}`, { cookie: schoolAdmin })).status, 404);
    const a = (await json('GET', '/api/admin/learning/assignments', { cookie: admin })).body.assignments[0];
    assert.equal((await json('GET', `/api/admin/learning/assignments/${a.id}`, { cookie: schoolAdmin })).status, 404);
  });
});

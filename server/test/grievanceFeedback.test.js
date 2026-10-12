/** Grievance and feedback (Phase 3) - run with `npm test` (needs `npm run db:setup` first). */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { env } from '../src/config/env.js';
import { createApp } from '../src/app.js';
import { closePool, q, withTx } from '../src/db/pool.js';
import { issueCaptchaToken } from '../src/services/captcha.service.js';
import { addDays, toISO } from '../src/utils/dates.js';

let server; let base; let tenantId; let admin; let student; let student2; let emp; let schoolAdmin; let courseId; let otherCourseId;

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
const cleanup = async () => withTx({ tenantId }, async () => {
  await q("delete from grievances where subject like 'GT %'");
  await q("delete from feedback_forms where title like 'GT %'");
  await q("delete from courses where code = 'GTX'");
  await q("delete from notifications where template = 'grievanceUpdate'");
});
const raise = (cookie, over = {}) => json('POST', '/api/student/grievances', { cookie, body: { category: 'Facilities', subject: 'GT broken fan', details: 'The fan in the library is broken.', ...over } });

before(async () => {
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  admin = await login('demo-college', 'admin', 'ADM001', 'Admin@123');
  student = await login('demo-college', 'student', 'STU2026001', 'Student@123');
  student2 = await login('demo-college', 'student', 'STU2026002', 'Student@123');
  emp = await login('demo-college', 'employee', 'EMP001', 'Employee@123');
  schoolAdmin = await login('demo-school', 'admin', 'ADM001', 'Admin@123');
  tenantId = (await withTx({ platform: true }, () => q("select id from tenants where code = 'demo-college'"))).rows[0].id;
  await cleanup();
  courseId = (await withTx({ tenantId }, () => q('select course_id from students where student_code = $1', ['STU2026001']))).rows[0].course_id;
  otherCourseId = (await withTx({ tenantId }, () => q(
    "insert into courses (code, name, full_name, department_id, years) select 'GTX', 'GT Other', 'GT Other course', department_id, 1 from courses limit 1 returning id",
  ))).rows[0].id;
});
after(async () => {
  await cleanup();
  await new Promise((r) => server.close(r));
  await closePool();
});

describe('Raising a grievance', () => {
  it('a student raises a ticket and gets a number', async () => {
    const r = await raise(student);
    assert.equal(r.status, 201);
    assert.match(r.body.grievance.ticketNo, /^GRV\d{4}-\d{5}$/);
    assert.equal(r.body.grievance.status, 'open');
    assert.equal(r.body.grievance.raiserRole, undefined, 'the raiser does not need their own role echoed');
  });
  it('checks category, subject and details', async () => {
    assert.equal((await raise(student, { category: 'Gossip' })).status, 400);
    assert.equal((await raise(student, { subject: '  ' })).status, 400);
    assert.equal((await raise(student, { details: '' })).status, 400);
    assert.equal((await raise(student, { subject: 'x'.repeat(151) })).status, 400);
  });
  it('an employee can raise one too', async () => {
    const r = await json('POST', '/api/employee/grievances', { cookie: emp, body: { category: 'Facilities', subject: 'GT staff room AC', details: 'It is too warm.' } });
    assert.equal(r.status, 201);
    const mine = await json('GET', '/api/employee/grievances', { cookie: emp });
    assert.equal(mine.body.grievances.length, 1);
  });
  it('people only see and open their own tickets', async () => {
    const mine = await json('GET', '/api/student/grievances', { cookie: student });
    assert.ok(mine.body.grievances.every((g) => g.subject.startsWith('GT ') || g.subject.startsWith('Projector')));
    const id = mine.body.grievances.find((g) => g.subject === 'GT broken fan').id;
    assert.equal((await json('GET', `/api/student/grievances/${id}`, { cookie: student })).status, 200);
    assert.equal((await json('GET', `/api/student/grievances/${id}`, { cookie: student2 })).status, 404);
    assert.equal((await json('POST', `/api/student/grievances/${id}/reply`, { cookie: student2, body: { body: 'hi' } })).status, 404);
    assert.equal((await json('POST', `/api/student/grievances/${id}/close`, { cookie: student2 })).status, 404);
  });
});

describe('Handling it (office)', () => {
  let id;
  before(async () => { id = (await json('GET', '/api/student/grievances', { cookie: student })).body.grievances.find((g) => g.subject === 'GT broken fan').id; });

  it('lists tickets with who raised them, counts and filters', async () => {
    const r = await json('GET', '/api/admin/grievances?status=active', { cookie: admin });
    assert.equal(r.status, 200);
    const t = r.body.grievances.find((g) => g.id === id);
    assert.match(t.from, /Aarav|Sharma/);
    assert.ok(r.body.counts.open >= 1);
    assert.ok(r.body.grievances.every((g) => ['open', 'in_progress'].includes(g.status)));
    assert.ok((await json('GET', '/api/admin/grievances?category=Fees', { cookie: admin })).body.grievances.every((g) => g.category === 'Fees'));
    assert.ok((await json('GET', '/api/admin/grievances?search=broken%20fan', { cookie: admin })).body.grievances.length >= 1);
  });
  it('a reply moves an open ticket to in progress and emails the person', async () => {
    const r = await json('POST', `/api/admin/grievances/${id}/reply`, { cookie: admin, body: { body: 'We will have it fixed on Monday.' } });
    assert.equal(r.status, 200);
    assert.equal(r.body.grievance.status, 'in_progress');
    assert.equal(r.body.messages.length, 1);
    assert.equal(r.body.messages[0].fromOffice, true);
    const mail = await withTx({ tenantId }, () => q("select count(*)::int as n from notifications where template = 'grievanceUpdate'"));
    assert.ok(mail.rows[0].n >= 1);
    const seen = await json('GET', `/api/student/grievances/${id}`, { cookie: student });
    assert.equal(seen.body.messages[0].body, 'We will have it fixed on Monday.');
  });
  it('needs something to say or a status to set', async () => {
    assert.equal((await json('POST', `/api/admin/grievances/${id}/reply`, { cookie: admin, body: {} })).status, 400);
    assert.equal((await json('POST', `/api/admin/grievances/${id}/reply`, { cookie: admin, body: { status: 'in_progress' } })).status, 400, 'same status and no words');
    assert.equal((await json('POST', `/api/admin/grievances/${id}/reply`, { cookie: admin, body: { status: 'sorted' } })).status, 400);
  });
  it('resolving, then the student replying, re-opens it', async () => {
    const done = await json('POST', `/api/admin/grievances/${id}/reply`, { cookie: admin, body: { body: 'Fan replaced.', status: 'resolved' } });
    assert.equal(done.body.grievance.status, 'resolved');
    assert.ok(done.body.grievance.resolvedAt);
    const again = await json('POST', `/api/student/grievances/${id}/reply`, { cookie: student, body: { body: 'It is still making noise.' } });
    assert.equal(again.status, 200);
    assert.equal(again.body.grievance.status, 'open');
    assert.equal(again.body.grievance.resolvedAt, null);
    assert.equal(again.body.messages.length, 3);
    assert.equal((await json('POST', `/api/student/grievances/${id}/reply`, { cookie: student, body: { body: '  ' } })).status, 400);
  });
  it('the student can close it, after which nobody replies without re-opening', async () => {
    const c = await json('POST', `/api/student/grievances/${id}/close`, { cookie: student });
    assert.equal(c.body.grievance.status, 'closed');
    assert.equal((await json('POST', `/api/student/grievances/${id}/close`, { cookie: student })).status, 409);
    assert.equal((await json('POST', `/api/student/grievances/${id}/reply`, { cookie: student, body: { body: 'more' } })).status, 409);
    assert.equal((await json('POST', `/api/admin/grievances/${id}/reply`, { cookie: admin, body: { body: 'more' } })).status, 409);
    const reopen = await json('POST', `/api/admin/grievances/${id}/reply`, { cookie: admin, body: { body: 'Re-opened for a check.', status: 'open' } });
    assert.equal(reopen.body.grievance.status, 'open');
  });
  it('an anonymous ticket hides the name from the office but not from the person', async () => {
    const r = await raise(student2, { subject: 'GT anonymous complaint', anonymous: true });
    const list = await json('GET', '/api/admin/grievances?search=GT%20anonymous', { cookie: admin });
    const t = list.body.grievances[0];
    assert.equal(t.from, 'Anonymous');
    assert.equal(t.raiserRole, null);
    assert.ok(!t.studentCode);
    const nm = (await withTx({ tenantId }, () => q("select name from students where student_code = 'STU2026002'"))).rows[0].name;
    assert.equal(JSON.stringify(t).includes(nm), false);
    const detail = await json('GET', `/api/admin/grievances/${t.id}`, { cookie: admin });
    assert.equal(detail.body.grievance.from, 'Anonymous');
    assert.equal(JSON.stringify(detail.body).includes('STU2026002'), false);
    const mine = await json('GET', `/api/student/grievances/${r.body.grievance.id}`, { cookie: student2 });
    assert.equal(mine.status, 200);
    // the office can still answer, and the person is told
    const rep = await json('POST', `/api/admin/grievances/${t.id}/reply`, { cookie: admin, body: { body: 'We are looking into it.' } });
    assert.equal(rep.status, 200);
    assert.equal((await json('GET', `/api/student/grievances/${r.body.grievance.id}`, { cookie: student2 })).body.messages.length, 1);
  });
  it('is closed to other roles and other institutes', async () => {
    assert.equal((await json('GET', '/api/admin/grievances', { cookie: student })).status, 403);
    assert.equal((await json('GET', '/api/admin/grievances', { cookie: emp })).status, 403);
    assert.equal((await json('GET', `/api/admin/grievances/${id}`, { cookie: schoolAdmin })).status, 404);
    assert.equal((await json('POST', `/api/admin/grievances/${id}/reply`, { cookie: schoolAdmin, body: { body: 'x' } })).status, 404);
    const list = await json('GET', '/api/admin/grievances', { cookie: schoolAdmin });
    assert.ok(list.body.grievances.every((g) => !g.subject.startsWith('GT ')));
  });
  it('the dashboard counts open tickets', async () => {
    const d = await json('GET', '/api/admin/dashboard', { cookie: admin });
    assert.ok(d.body.today.grievancesOpen >= 1);
  });
});

const makeForm = (over = {}) => json('POST', '/api/admin/feedback', {
  cookie: admin,
  body: {
    title: 'GT Teaching feedback', audience: 'students', status: 'open',
    questions: [{ text: 'Classes are clear', kind: 'rating' }, { text: 'Pace is right', kind: 'rating', required: false }, { text: 'Anything to improve?', kind: 'text', required: false }],
    ...over,
  },
});

describe('Feedback forms (office)', () => {
  it('creates a form with questions and lists it', async () => {
    const r = await makeForm();
    assert.equal(r.status, 201);
    assert.equal(r.body.questions.length, 3);
    assert.deepEqual(r.body.questions.map((x) => x.position), [1, 2, 3]);
    const list = await json('GET', '/api/admin/feedback', { cookie: admin });
    assert.ok(list.body.forms.some((f) => f.title === 'GT Teaching feedback' && f.questionCount === 3 && f.responses === 0));
  });
  it('checks the form and its questions', async () => {
    assert.equal((await makeForm({ questions: [] })).status, 400);
    assert.equal((await makeForm({ questions: [{ text: 'x', kind: 'stars' }] })).status, 400);
    assert.equal((await makeForm({ questions: [{ text: '  ', kind: 'text' }] })).status, 400);
    assert.equal((await makeForm({ title: '' })).status, 400);
    assert.equal((await makeForm({ audience: 'parents' })).status, 400);
    assert.equal((await makeForm({ audience: 'employees', courseId })).status, 400, 'a course only applies to students');
    assert.equal((await makeForm({ closesOn: 'tomorrow' })).status, 400);
    assert.equal((await makeForm({ courseId: '11111111-1111-4111-8111-111111111111' })).status, 400);
    assert.equal((await makeForm({ questions: Array.from({ length: 31 }, (_, i) => ({ text: `q${i}`, kind: 'rating' })) })).status, 400);
  });
  it('a draft is not shown to students until opened, and a closed form is not open', async () => {
    const f = (await makeForm({ title: 'GT Draft form', status: 'draft' })).body.form;
    assert.equal((await json('GET', '/api/student/feedback', { cookie: student })).body.forms.some((x) => x.id === f.id), false);
    assert.equal((await json('GET', `/api/student/feedback/${f.id}`, { cookie: student })).status, 404);
    const opened = await json('PUT', `/api/admin/feedback/${f.id}/status`, { cookie: admin, body: { status: 'open' } });
    assert.equal(opened.body.form.status, 'open');
    assert.equal((await json('GET', `/api/student/feedback/${f.id}`, { cookie: student })).status, 200);
    await json('PUT', `/api/admin/feedback/${f.id}/status`, { cookie: admin, body: { status: 'closed' } });
    assert.equal((await json('GET', `/api/student/feedback/${f.id}`, { cookie: student })).status, 404);
    assert.equal((await json('PUT', `/api/admin/feedback/${f.id}/status`, { cookie: admin, body: { status: 'paused' } })).status, 400);
  });
  it('a form whose closing date has passed stops accepting answers', async () => {
    const f = (await makeForm({ title: 'GT Expired form', closesOn: toISO(addDays(new Date(), -1)) })).body.form;
    assert.equal(f.accepting, false);
    assert.equal((await json('GET', `/api/student/feedback/${f.id}`, { cookie: student })).status, 404);
    const future = (await makeForm({ title: 'GT Future form', closesOn: toISO(addDays(new Date(), 5)) })).body.form;
    assert.equal((await json('GET', `/api/student/feedback/${future.id}`, { cookie: student })).status, 200);
  });
  it('cannot open a form with no questions', async () => {
    const f = (await makeForm({ title: 'GT Empty', status: 'draft' })).body.form;
    await withTx({ tenantId }, () => q('delete from feedback_questions where form_id = $1', [f.id]));
    assert.equal((await json('PUT', `/api/admin/feedback/${f.id}/status`, { cookie: admin, body: { status: 'open' } })).status, 400);
  });
});

describe('Answering feedback (anonymous)', () => {
  let form; let qs;
  before(async () => {
    const r = await makeForm({ title: 'GT Answer me' });
    form = r.body.form; qs = r.body.questions;
  });
  const answer = (cookie, answers) => json('POST', `/api/student/feedback/${form.id}`, { cookie, body: { answers } });

  it('students see the open form with their own done flag', async () => {
    const list = await json('GET', '/api/student/feedback', { cookie: student });
    const f = list.body.forms.find((x) => x.id === form.id);
    assert.equal(f.done, false);
    assert.equal(f.responses, undefined, 'the count of answers is for the office');
    const one = await json('GET', `/api/student/feedback/${form.id}`, { cookie: student });
    assert.equal(one.body.questions.length, 3);
  });
  it('requires the required questions and a rating from 1 to 5', async () => {
    assert.equal((await answer(student, [])).status, 400);
    assert.equal((await answer(student, [{ questionId: qs[0].id, rating: 6 }])).status, 400);
    assert.equal((await answer(student, [{ questionId: qs[0].id, rating: 0 }])).status, 400);
    assert.equal((await answer(student, [{ questionId: qs[0].id, rating: 2.5 }])).status, 400);
    assert.equal((await answer(student, [{ questionId: qs[0].id, rating: 4 }, { questionId: qs[2].id, comment: 'x'.repeat(1001) }])).status, 400);
  });
  it('accepts one answer per person', async () => {
    const ok = await answer(student, [{ questionId: qs[0].id, rating: 4 }, { questionId: qs[1].id, rating: 5 }, { questionId: qs[2].id, comment: 'More examples please' }]);
    assert.equal(ok.status, 201);
    assert.equal((await answer(student, [{ questionId: qs[0].id, rating: 1 }])).status, 409);
    assert.equal((await json('GET', '/api/student/feedback', { cookie: student })).body.forms.find((x) => x.id === form.id).done, true);
    assert.equal((await answer(student2, [{ questionId: qs[0].id, rating: 2 }, { questionId: qs[2].id, comment: 'Slides are hard to read' }])).status, 201);
  });
  it('keeps nothing in the answers that points to a person', async () => {
    const cols = await withTx({ tenantId }, () => q("select column_name from information_schema.columns where table_name = 'feedback_answers'"));
    assert.equal(cols.rows.some((c) => /user|student|employee|person/.test(c.column_name)), false);
    const subs = await withTx({ tenantId }, () => q('select count(*)::int as n from feedback_submissions where form_id = $1', [form.id]));
    assert.equal(subs.rows[0].n, 2);
  });
  it('shows the office the combined results, with the response rate', async () => {
    const r = await json('GET', `/api/admin/feedback/${form.id}/results`, { cookie: admin });
    assert.equal(r.status, 200);
    assert.equal(r.body.form.responses, 2);
    assert.ok(r.body.eligible >= 2);
    const q0 = r.body.questions[0];
    assert.equal(q0.average, 3);
    assert.deepEqual(q0.distribution, [0, 1, 0, 1, 0]);
    assert.equal(r.body.questions[1].answered, 1, 'the optional rating was answered once');
    assert.equal(r.body.questions[1].average, 5);
    assert.deepEqual(r.body.questions[2].comments.map((c) => c.text).sort(), ['More examples please', 'Slides are hard to read']);
    assert.equal(JSON.stringify(r.body).includes('STU2026'), false);
  });
  it('the questions are locked once someone has answered, but the form can still be closed', async () => {
    const edit = await json('PUT', `/api/admin/feedback/${form.id}`, { cookie: admin, body: { title: 'GT Answer me', audience: 'students', status: 'open', questions: [{ text: 'New', kind: 'rating' }] } });
    assert.equal(edit.status, 409);
    const rename = await json('PUT', `/api/admin/feedback/${form.id}`, { cookie: admin, body: { title: 'GT Answer me (renamed)', audience: 'students', status: 'closed' } });
    assert.equal(rename.status, 200);
    assert.equal(rename.body.form.status, 'closed');
    assert.equal(rename.body.questions.length, 3);
  });
});

describe('Who sees which form', () => {
  it('a form for staff is not shown to students, and the other way round', async () => {
    const staff = (await makeForm({ title: 'GT Staff survey', audience: 'employees' })).body;
    assert.equal((await json('GET', '/api/student/feedback', { cookie: student })).body.forms.some((x) => x.id === staff.form.id), false);
    assert.equal((await json('GET', `/api/student/feedback/${staff.form.id}`, { cookie: student })).status, 404);
    assert.equal((await json('GET', '/api/employee/feedback', { cookie: emp })).body.forms.some((x) => x.id === staff.form.id), true);
    const ok = await json('POST', `/api/employee/feedback/${staff.form.id}`, { cookie: emp, body: { answers: [{ questionId: staff.questions[0].id, rating: 5 }] } });
    assert.equal(ok.status, 201);
    const forStudents = (await makeForm({ title: 'GT Only students' })).body.form;
    assert.equal((await json('GET', `/api/employee/feedback/${forStudents.id}`, { cookie: emp })).status, 404);
  });
  it('a form limited to a course is shown only to that course', async () => {
    const mine = (await makeForm({ title: 'GT My course', courseId })).body.form;
    const other = (await makeForm({ title: 'GT Other course', courseId: otherCourseId })).body.form;
    const ids = (await json('GET', '/api/student/feedback', { cookie: student })).body.forms.map((x) => x.id);
    assert.ok(ids.includes(mine.id));
    assert.equal(ids.includes(other.id), false);
    assert.equal((await json('GET', `/api/student/feedback/${other.id}`, { cookie: student })).status, 404);
    assert.equal(mine.course !== null, true);
  });
  it('a form can be about one faculty member', async () => {
    const empRow = (await withTx({ tenantId }, () => q("select id, name from employees where emp_code = 'EMP002'"))).rows[0];
    const f = (await makeForm({ title: 'GT About faculty', aboutEmployeeId: empRow.id })).body.form;
    assert.equal(f.aboutName, empRow.name);
    const seen = (await json('GET', '/api/student/feedback', { cookie: student })).body.forms.find((x) => x.id === f.id);
    assert.equal(seen.aboutName, empRow.name);
  });
  it('another institute sees none of it and cannot touch it', async () => {
    const f = (await makeForm({ title: 'GT Private' })).body.form;
    const list = await json('GET', '/api/admin/feedback', { cookie: schoolAdmin });
    assert.ok(list.body.forms.every((x) => !x.title.startsWith('GT ')));
    assert.equal((await json('GET', `/api/admin/feedback/${f.id}/results`, { cookie: schoolAdmin })).status, 404);
    assert.equal((await json('PUT', `/api/admin/feedback/${f.id}/status`, { cookie: schoolAdmin, body: { status: 'closed' } })).status, 404);
    assert.equal((await json('DELETE', `/api/admin/feedback/${f.id}`, { cookie: schoolAdmin })).status, 404);
    assert.equal((await json('GET', '/api/admin/feedback', { cookie: student })).status, 403);
  });
  it('deleting a form removes its answers', async () => {
    const f = (await makeForm({ title: 'GT Delete me' })).body;
    await json('POST', `/api/student/feedback/${f.form.id}`, { cookie: student, body: { answers: [{ questionId: f.questions[0].id, rating: 3 }] } });
    assert.equal((await json('DELETE', `/api/admin/feedback/${f.form.id}`, { cookie: admin })).status, 200);
    const left = await withTx({ tenantId }, () => q('select count(*)::int as n from feedback_answers where form_id = $1', [f.form.id]));
    assert.equal(left.rows[0].n, 0);
    assert.equal((await json('DELETE', `/api/admin/feedback/${f.form.id}`, { cookie: admin })).status, 404);
  });
});

/** Day 4: the exam's step in "Exams and results", its checks, and publishing only when complete. Needs `npm run db:setup`. */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { env } from '../src/config/env.js';
import { createApp } from '../src/app.js';
import { closePool, q, withTx } from '../src/db/pool.js';
import { issueCaptchaToken } from '../src/services/captcha.service.js';
import { examProgress } from '../src/services/exams.service.js';

let server; let base; let admin; let tenantId; let courseId; let empAId;
const ids = {};
const json = async (method, path, { cookie, body } = {}) => {
  const r = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let b = null; try { b = await r.clone().json(); } catch { /* not json */ }
  return { status: r.status, body: b, res: r };
};
async function login(tenantCode, role, identifier, password) {
  const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tenantCode, role, identifier, password, captchaToken: issueCaptchaToken() }) });
  assert.equal(r.status, 200);
  return r.headers.getSetCookie().map((c) => c.split(';')[0]).find((c) => c.startsWith(`${env.COOKIE_NAME}=`));
}
const addStudent = (code, name, roll) => withTx({ tenantId }, async () => (await q(
  "insert into students (student_code, roll_no, name, email, course_id, status) values ($1, $2, $3, $4, $5, 'Active') returning id",
  [code, roll, name, `${code.toLowerCase()}@test.example`, courseId],
)).rows[0].id);

describe('examProgress (no database)', () => {
  const exam = { status: 'draft' };
  const roster = [{ id: 's1' }, { id: 's2' }];
  const paper = (id, marksStatus) => ({ id, subject: id.toUpperCase(), marksStatus, employeeName: 'T' });
  it('no papers: the step is Papers and dates, and nothing can be published', () => {
    const p = examProgress({ exam, papers: [], roster, byPaper: new Map() });
    assert.equal(p.step, 'papers');
    assert.equal(p.ready, false);
    assert.equal(p.checks.find((c) => c.key === 'papers').ok, false);
  });
  it('a paper still in draft keeps the exam at Marks entered, with its progress per paper', () => {
    const byPaper = new Map([['a', new Map([['s1', { marks: 5 }]])]]);
    const p = examProgress({ exam, papers: [paper('a', 'draft')], roster, byPaper });
    assert.equal(p.step, 'marks');
    assert.deepEqual([p.papers[0].entered, p.papers[0].missing, p.papers[0].pct], [1, 1, 50]);
    assert.match(p.checks.find((c) => c.key === 'submitted').text, /not submitted for: A/);
  });
  it('submitted but a student without a mark is held at Checked; complete is ready to publish; published moves to Report cards', () => {
    const half = new Map([['a', new Map([['s1', { marks: 5 }]])]]);
    const held = examProgress({ exam, papers: [paper('a', 'submitted')], roster, byPaper: half });
    assert.equal(held.step, 'checked');
    assert.match(held.checks.find((c) => c.key === 'complete').text, /1 student is missing a mark \(A: 1\)/);
    const full = new Map([['a', new Map([['s1', { marks: 5 }], ['s2', { absent: true }]])]]);
    const ready = examProgress({ exam, papers: [paper('a', 'submitted')], roster, byPaper: full });
    assert.deepEqual([ready.step, ready.ready], ['published', true]);
    assert.equal(examProgress({ exam: { status: 'published' }, papers: [paper('a', 'submitted')], roster, byPaper: full }).step, 'reports');
  });
});

describe('Publishing only when complete (API)', () => {
  before(async () => {
    server = createApp().listen(0);
    base = `http://127.0.0.1:${server.address().port}`;
    admin = await login('demo-college', 'admin', 'ADM001', 'Admin@123');
    tenantId = (await withTx({ platform: true }, () => q("select id from tenants where code = 'demo-college'"))).rows[0].id;
    await withTx({ tenantId }, async () => {
      empAId = (await q("select id from employees where emp_code = 'EMP001'")).rows[0].id;
      courseId = (await q("insert into courses (code, name) values ('EXPROG', 'Exam Progress Course') returning id")).rows[0].id;
    });
    ids.s1 = await addStudent('EXP-S1', 'Prog One', '1');
    ids.s2 = await addStudent('EXP-S2', 'Prog Two', '2');
  });
  after(async () => {
    try {
      await withTx({ tenantId }, async () => {
        await q("delete from students where student_code like 'EXP-S%'");
        await q("delete from courses where code = 'EXPROG'");
      });
    } finally {
      await new Promise((r) => server.close(r));
      await closePool();
    }
  });

  let examId; let paperId;
  it('the exam carries its progress; marks submitted for everyone make it ready', async () => {
    const e = await json('POST', '/api/admin/exams', { cookie: admin, body: { courseId, name: 'Progress test', semester: 1, papers: [{ subject: 'Maths', maxMarks: 50, passMarks: 20, employeeId: empAId }] } });
    assert.equal(e.status, 201, JSON.stringify(e.body));
    examId = e.body.exam.id; paperId = e.body.papers[0].id;
    assert.equal(e.body.progress.step, 'marks');
    const s = await json('PUT', `/api/admin/exams/${examId}/papers/${paperId}/marks`, { cookie: admin, body: { submit: true, entries: [{ studentId: ids.s1, marks: 40 }, { studentId: ids.s2, absent: true }] } });
    assert.equal(s.status, 200, JSON.stringify(s.body));
    const p = await json('GET', `/api/admin/exams/${examId}/progress`, { cookie: admin });
    assert.equal(p.status, 200);
    assert.deepEqual([p.body.step, p.body.ready, p.body.papers[0].pct], ['published', true, 100]);
  });

  it('a student who joins after the paper was submitted blocks Publish until their mark is in, and the error says how to fix it', async () => {
    ids.s3 = await addStudent('EXP-S3', 'Prog Three', '3');
    const p = await json('GET', `/api/admin/exams/${examId}/progress`, { cookie: admin });
    assert.deepEqual([p.body.step, p.body.ready], ['checked', false]);
    const blocked = await json('POST', `/api/admin/exams/${examId}/publish`, { cookie: admin });
    assert.equal(blocked.status, 400);
    assert.match(blocked.body.message, /1 student is missing a mark \(Maths: 1\)\. Open the paper and enter a mark or Absent/);
    const fix = await json('PUT', `/api/admin/exams/${examId}/papers/${paperId}/marks`, { cookie: admin, body: { submit: true, entries: [{ studentId: ids.s3, marks: 22 }] } });
    assert.equal(fix.status, 200, JSON.stringify(fix.body));
    const ok = await json('POST', `/api/admin/exams/${examId}/publish`, { cookie: admin });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.progress.step, 'reports');
  });

  it('the report cards still print as a PDF with the institute letterhead', async () => {
    const r = await fetch(`${base}/api/admin/exams/${examId}/report-cards.pdf`, { headers: { cookie: admin } });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'application/pdf');
    assert.equal(Buffer.from(await r.arrayBuffer()).subarray(0, 4).toString(), '%PDF');
  });
});

/** Exams & Results - run with `npm test` (needs `npm run db:setup` first). */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import bcrypt from 'bcryptjs';
import { env } from '../src/config/env.js';
import { createApp } from '../src/app.js';
import { closePool, q, withTx } from '../src/db/pool.js';
import { issueCaptchaToken } from '../src/services/captcha.service.js';
import {
  DEFAULT_BANDS, bandFor, cumulativeGpa, normaliseBands, paperOutcome, studentOutcome,
} from '../src/services/grading.js';

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
const pdfInfo = async (r) => {
  const buf = Buffer.from(await r.res.arrayBuffer());
  return { type: r.res.headers.get('content-type'), head: buf.subarray(0, 4).toString(), pages: (buf.toString('latin1').match(/\/Type \/Page(?!s)/g) || []).length };
};

/* ================================================================ pure grading maths */
describe('Grading arithmetic (no database)', () => {
  const paper = { id: 'p', subject: 'X', maxMarks: 100, passMarks: 40, credits: 4 };
  it('maps a percentage to the highest band it reaches', () => {
    assert.equal(bandFor(95, DEFAULT_BANDS).grade, 'O');
    assert.equal(bandFor(90, DEFAULT_BANDS).grade, 'O');
    assert.equal(bandFor(89.99, DEFAULT_BANDS).grade, 'A+');
    assert.equal(bandFor(40, DEFAULT_BANDS).grade, 'P');
    assert.equal(bandFor(0, DEFAULT_BANDS).grade, 'F');
  });
  it('a paper below the pass mark is F with 0 points, even if its percentage would earn a grade; absent is a fail', () => {
    const strict = { ...paper, passMarks: 60 };
    const f = paperOutcome(strict, { marks: 55, absent: false }, DEFAULT_BANDS);
    assert.deepEqual([f.passed, f.grade, f.points, f.status], [false, 'F', 0, 'fail']);
    const ok = paperOutcome(strict, { marks: 60, absent: false }, DEFAULT_BANDS);
    assert.deepEqual([ok.passed, ok.grade, ok.points], [true, 'B+', 7]);
    const ab = paperOutcome(paper, { marks: null, absent: true }, DEFAULT_BANDS);
    assert.deepEqual([ab.status, ab.passed, ab.grade, ab.points, ab.marks], ['absent', false, 'F', 0, null]);
    assert.equal(paperOutcome(paper, undefined, DEFAULT_BANDS).status, 'pending');
  });
  it('GPA is credit-weighted over every paper; credits earned count passed papers only', () => {
    const papers = [{ ...paper, id: 'a' }, { id: 'b', subject: 'Y', maxMarks: 50, passMarks: 20, credits: 2 }];
    const o = studentOutcome(papers, new Map([['a', { marks: 55, absent: false }], ['b', { marks: null, absent: true }]]), DEFAULT_BANDS);
    assert.deepEqual([o.gpa, o.creditsEarned, o.totalCredits, o.result, o.pct], [4, 4, 6, 'fail', 36.67]);
    assert.deepEqual(o.failedSubjects, ['Y']);
  });
  it('stays incomplete (no GPA, no percentage) until every paper has a mark or an absent', () => {
    const papers = [{ ...paper, id: 'a' }, { ...paper, id: 'b', subject: 'Y' }];
    const o = studentOutcome(papers, new Map([['a', { marks: 80, absent: false }]]), DEFAULT_BANDS);
    assert.deepEqual([o.complete, o.gpa, o.pct, o.result], [false, null, null, 'incomplete']);
    assert.equal(o.total, 80);
  });
  it('cumulative GPA weights by credits across exams and ignores incomplete ones', () => {
    const a = { complete: true, subjects: [{ points: 10, credits: 4 }] };
    const b = { complete: true, subjects: [{ points: 6, credits: 2 }] };
    const c = { complete: false, subjects: [{ points: 0, credits: 9 }] };
    assert.equal(cumulativeGpa([a, b, c]), 8.67);
    assert.equal(cumulativeGpa([c]), null);
  });
  it('rejects a bad grading scale with a clear reason', () => {
    const ok = [{ grade: 'A', min: 50, points: 10 }, { grade: 'B', min: 0, points: 5 }];
    assert.equal(normaliseBands(ok)[0].grade, 'A');
    assert.throws(() => normaliseBands([{ grade: 'A', min: 50, points: 10 }, { grade: 'B', min: 10, points: 5 }]), /start at 0%/);
    assert.throws(() => normaliseBands([{ grade: 'A', min: 0, points: 10 }, { grade: 'B', min: 0, points: 5 }]), /same percentage/);
    assert.throws(() => normaliseBands([{ grade: 'A', min: 50, points: 3 }, { grade: 'B', min: 0, points: 5 }]), /fewer grade points/);
    assert.throws(() => normaliseBands([{ grade: 'A', min: 50, points: 10 }, { grade: 'a', min: 0, points: 5 }]), /same grade name/);
    assert.throws(() => normaliseBands([{ grade: 'A', min: 0, points: 1 }]), /between 2 and 12/);
    assert.throws(() => normaliseBands([{ grade: '', min: 50, points: 10 }, { grade: 'B', min: 0, points: 5 }]), /name/);
  });
});

/* ============================================================== through the HTTP API */
let admin; let schoolAdmin; let empA; let empB; let studentE1; let studentE2; let schoolStudent; let tenantId;
let courseId; let empAId; let empBId; let examId; let paperA; let paperB;
const ids = {};

const adminMarks = (paperId) => `/api/admin/exams/${examId}/papers/${paperId}/marks`;
const empMarks = (paperId) => `/api/employee/exams/papers/${paperId}/marks`;
const put = (url, cookie, entries, submit = false) => json('PUT', url, { cookie, body: { entries, submit } });
const entriesA = () => [{ studentId: ids.e1, marks: 90 }, { studentId: ids.e2, marks: 55 }, { studentId: ids.e3, marks: 30 }];
const entriesB = () => [{ studentId: ids.e1, marks: 45 }, { studentId: ids.e2, absent: true }, { studentId: ids.e3, marks: 40 }];

before(async () => {
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  admin = await login('demo-college', 'admin', 'ADM001', 'Admin@123');
  schoolAdmin = await login('demo-school', 'admin', 'ADM001', 'Admin@123');
  empA = await login('demo-college', 'employee', 'EMP001', 'Employee@123');
  empB = await login('demo-college', 'employee', 'EMP002', 'Employee@123');
  schoolStudent = await login('demo-school', 'student', 'GPS2026001', 'Student@123');
  tenantId = (await withTx({ platform: true }, () => q("select id from tenants where code = 'demo-college'"))).rows[0].id;

  await withTx({ tenantId }, async () => {
    empAId = (await q("select id from employees where emp_code = 'EMP001'")).rows[0].id;
    empBId = (await q("select id from employees where emp_code = 'EMP002'")).rows[0].id;
    courseId = (await q("insert into courses (code, name) values ('EXMTEST', 'Exam Test Course') returning id")).rows[0].id;
    const hash = bcrypt.hashSync('Student@123', 10);
    for (const [key, code, name, roll, status] of [
      ['e1', 'EXM-S1', 'Asha Test One', '1', 'Active'], ['e2', 'EXM-S2', 'Binod Test Two', '2', 'Active'],
      ['e3', 'EXM-S3', '=Cara Test Three', '3', 'Active'], ['gone', 'EXM-S4', 'Dev Inactive', '4', 'Inactive'],
    ]) {
      ids[key] = (await q(
        'insert into students (student_code, roll_no, name, email, course_id, status) values ($1, $2, $3, $4, $5, $6) returning id',
        [code, roll, name, `${code.toLowerCase()}@test.example`, courseId, status],
      )).rows[0].id;
    }
    for (const [key, code, name] of [['e1', 'EXM-S1', 'Asha Test One'], ['e2', 'EXM-S2', 'Binod Test Two']]) {
      await q("insert into users (role, login_id, email, name, password_hash, student_id) values ('student', $1, $2, $3, $4, $5)",
        [code, `${code.toLowerCase()}@test.example`, name, hash, ids[key]]);
    }
    ids.outsider = (await q("select id from students where student_code = 'STU2026001'")).rows[0].id;
  });
  studentE1 = await login('demo-college', 'student', 'EXM-S1', 'Student@123');
  studentE2 = await login('demo-college', 'student', 'EXM-S2', 'Student@123');
});

after(async () => {
  try {
    await withTx({ tenantId }, async () => {
      await q("delete from users where login_id like 'EXM-S%'");
      await q("delete from students where student_code like 'EXM-S%'");
      await q("delete from courses where code = 'EXMTEST'"); // exams, papers, marks and slots go with it
      await q('delete from grading_scales');
    });
  } finally {
    await new Promise((r) => server.close(r));
    await closePool();
  }
});

describe('Row Level Security (database)', () => {
  it('exam tables are empty with no tenant context and invisible to another tenant', async () => {
    await withTx({}, async () => {
      for (const t of ['exams', 'exam_papers', 'exam_marks', 'grading_scales']) {
        assert.equal((await q(`select count(*)::int as n from ${t}`)).rows[0].n, 0, t);
      }
    });
    const schoolId = (await withTx({ platform: true }, () => q("select id from tenants where code = 'demo-school'"))).rows[0].id;
    const demoCollegeExams = await withTx({ tenantId }, async () => (await q('select count(*)::int as n from exams')).rows[0].n);
    assert.ok(demoCollegeExams >= 2, 'seeded demo exams exist');
    await withTx({ tenantId: schoolId }, async () => {
      assert.equal((await q("select count(*)::int as n from exams where name = 'End-Semester Examination'")).rows[0].n, 1, 'school sees only its own');
    });
  });
});

describe('Creating an exam and its papers', () => {
  it('validates the request', async () => {
    const post = (body) => json('POST', '/api/admin/exams', { cookie: admin, body });
    assert.equal((await post({ name: 'X' })).status, 400, 'no course');
    assert.equal((await post({ courseId, name: '' })).status, 400);
    assert.equal((await post({ courseId, name: 'X', kind: 'bogus' })).status, 400);
    assert.equal((await post({ courseId, name: 'X', semester: 0 })).status, 400);
    assert.equal((await post({ courseId, name: 'X', startDate: '2026-03-10', endDate: '2026-03-01' })).status, 400);
    assert.equal((await post({ courseId, name: 'X', papers: [{ subject: 'S', maxMarks: 50, passMarks: 60 }] })).status, 400, 'pass above max');
    assert.equal((await post({ courseId, name: 'X', papers: [{ subject: 'S', maxMarks: 0, passMarks: 0 }] })).status, 400);
    assert.equal((await post({ courseId: '00000000-0000-4000-8000-000000000000', name: 'X' })).status, 400, 'unknown course');
    assert.equal((await post({ courseId, name: 'X', papers: [{ subject: 'S', maxMarks: 50, passMarks: 20, employeeId: 'nope' }] })).status, 400);
  });

  it('creates an exam with papers, assigned to faculty', async () => {
    const r = await json('POST', '/api/admin/exams', {
      cookie: admin,
      body: {
        courseId, name: 'Test End-Sem', kind: 'term', semester: 1,
        papers: [
          { subject: 'Subject A', maxMarks: 100, passMarks: 40, credits: 4, employeeId: empAId },
          { subject: 'Subject B', maxMarks: 50, passMarks: 20, credits: 2, employeeId: empBId },
        ],
      },
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    examId = r.body.exam.id;
    assert.equal(r.body.exam.status, 'draft');
    assert.equal(r.body.roster, 3, 'inactive student is not on the roster');
    paperA = r.body.papers.find((p) => p.subject === 'Subject A').id;
    paperB = r.body.papers.find((p) => p.subject === 'Subject B').id;
    assert.deepEqual(r.body.papers.map((p) => p.employeeName).sort(), ['Amandeep Kaur', 'Rohit Verma']);
  });

  it('refuses a duplicate name in the same course and semester', async () => {
    const r = await json('POST', '/api/admin/exams', { cookie: admin, body: { courseId, name: 'test end-sem', semester: 1 } });
    assert.equal(r.status, 409);
  });

  it('can start from the course timetable: one paper per subject, defaulted to its teacher', async () => {
    const slot = await json('POST', '/api/admin/timetable/slots', {
      cookie: admin, body: { courseId, weekday: 1, start: '22:00', end: '22:30', subject: 'Timetable Subject', employeeId: empBId },
    });
    assert.equal(slot.status, 201);
    const r = await json('POST', '/api/admin/exams', { cookie: admin, body: { courseId, name: 'From timetable', semester: 2, fromTimetable: true } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.papers.length, 1);
    assert.deepEqual([r.body.papers[0].subject, r.body.papers[0].maxMarks, r.body.papers[0].passMarks, r.body.papers[0].employeeName], ['Timetable Subject', 100, 40, 'Rohit Verma']);
    assert.equal((await json('DELETE', `/api/admin/exams/${r.body.exam.id}`, { cookie: admin })).status, 200);
  });

  it('edits and removes papers while the exam is a draft, and rejects duplicates / lowering below entered marks', async () => {
    const add = await json('POST', `/api/admin/exams/${examId}/papers`, { cookie: admin, body: { subject: 'Subject C', maxMarks: 20, passMarks: 8 } });
    assert.equal(add.status, 201);
    const c = add.body.papers.find((p) => p.subject === 'Subject C').id;
    assert.equal((await json('POST', `/api/admin/exams/${examId}/papers`, { cookie: admin, body: { subject: 'subject c', maxMarks: 20, passMarks: 8 } })).status, 409);
    const upd = await json('PUT', `/api/admin/exams/${examId}/papers/${c}`, { cookie: admin, body: { passMarks: 10, credits: 3 } });
    assert.equal(upd.status, 200);
    assert.deepEqual(upd.body.papers.find((p) => p.id === c) && [upd.body.papers.find((p) => p.id === c).passMarks, upd.body.papers.find((p) => p.id === c).credits], [10, 3]);
    assert.equal((await json('DELETE', `/api/admin/exams/${examId}/papers/${c}`, { cookie: admin })).status, 200);
    assert.equal((await json('DELETE', `/api/admin/exams/${examId}/papers/${c}`, { cookie: admin })).status, 404);
  });
});

describe('Who can reach what', () => {
  it('keeps roles apart', async () => {
    assert.equal((await json('GET', '/api/admin/exams', { cookie: empA })).status, 403);
    assert.equal((await json('GET', '/api/admin/exams', { cookie: studentE1 })).status, 403);
    assert.equal((await json('GET', '/api/employee/exams/papers', { cookie: admin })).status, 403);
    assert.equal((await json('GET', '/api/employee/exams/papers', { cookie: studentE1 })).status, 403);
    assert.equal((await json('GET', '/api/student/results', { cookie: empA })).status, 403);
    assert.equal((await json('GET', '/api/student/results')).status, 401);
    assert.equal((await json('GET', '/api/admin/exams/not-a-uuid', { cookie: admin })).status, 404);
  });

  it('faculty see only the papers assigned to them', async () => {
    const a = await json('GET', '/api/employee/exams/papers', { cookie: empA });
    assert.deepEqual(a.body.papers.filter((p) => p.examId === examId).map((p) => p.subject), ['Subject A']);
    const b = await json('GET', '/api/employee/exams/papers', { cookie: empB });
    assert.deepEqual(b.body.papers.filter((p) => p.examId === examId).map((p) => p.subject), ['Subject B']);
    assert.equal((await json('GET', empMarks(paperB), { cookie: empA })).status, 404, "another teacher's paper looks nonexistent");
    assert.equal((await json('PUT', empMarks(paperB), { cookie: empA, body: { entries: entriesB() } })).status, 404);
  });
});

describe('Entering marks', () => {
  it('opens a sheet with the active roster, nothing entered, editable', async () => {
    const r = await json('GET', empMarks(paperA), { cookie: empA });
    assert.equal(r.status, 200);
    assert.equal(r.body.editable, true);
    assert.deepEqual(r.body.students.map((s) => s.code), ['EXM-S1', 'EXM-S2', 'EXM-S3']);
    assert.ok(r.body.students.every((s) => !s.entered && s.marks === null));
    assert.deepEqual([r.body.paper.maxMarks, r.body.paper.marksStatus], [100, 'draft']);
  });

  it('validates marks: over max, decimals, absent with marks, bad status, outsiders, duplicates', async () => {
    const bad = (entries) => put(empMarks(paperA), empA, entries);
    assert.equal((await bad([{ studentId: ids.e1, marks: 101 }])).status, 400);
    assert.equal((await bad([{ studentId: ids.e1, marks: -1 }])).status, 400);
    assert.equal((await bad([{ studentId: ids.e1, marks: 50.123 }])).status, 400);
    assert.equal((await bad([{ studentId: ids.e1, marks: 'abc' }])).status, 400);
    assert.equal((await bad([{ studentId: ids.e1, marks: 50, absent: true }])).status, 400);
    assert.equal((await bad([{ studentId: ids.outsider, marks: 50 }])).status, 400);
    assert.equal((await bad([{ studentId: ids.gone, marks: 50 }])).status, 400);
    assert.equal((await bad([{ studentId: ids.e1, marks: 50 }, { studentId: ids.e1, marks: 60 }])).status, 400);
    assert.equal((await bad('nope')).status, 400);
    assert.equal((await bad([])).status, 400);
    const ok = await bad([{ studentId: ids.e1, marks: '72.5' }]);
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.students.find((s) => s.id === ids.e1).marks, 72.5);
  });

  it('a draft keeps what was entered but the paper is not submitted; submitting needs every student', async () => {
    const r = await put(empMarks(paperA), empA, [{ studentId: ids.e2, marks: 55 }]);
    assert.equal(r.status, 200);
    assert.equal(r.body.paper.marksStatus, 'draft');
    const early = await put(empMarks(paperA), empA, [], true);
    assert.equal(early.status, 400);
    assert.match(early.body.message, /1 still empty/);
  });

  it('submits a complete sheet; faculty can still correct it until the exam is published, but cannot blank a mark', async () => {
    const r = await put(empMarks(paperA), empA, entriesA(), true);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.paper.marksStatus, 'submitted');
    const fix = await put(empMarks(paperA), empA, [{ studentId: ids.e1, marks: 90 }]);
    assert.equal(fix.status, 200);
    assert.equal(fix.body.paper.marksStatus, 'submitted');
    const clear = await put(empMarks(paperA), empA, [{ studentId: ids.e1, marks: null }]);
    assert.equal(clear.status, 400);
    assert.match(clear.body.message, /cannot be cleared/);
  });

  it('absent is a valid entry; another paper is submitted independently', async () => {
    const r = await put(empMarks(paperB), empB, entriesB(), true);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.students.find((s) => s.id === ids.e2).absent, true);
    assert.equal(r.body.students.find((s) => s.id === ids.e2).marks, null);
  });
});

describe('Results, before and after publishing', () => {
  it('admin sees computed results: grades, GPA, pass/fail and class statistics', async () => {
    const r = await json('GET', `/api/admin/exams/${examId}/results`, { cookie: admin });
    assert.equal(r.status, 200);
    const by = (code) => r.body.students.find((s) => s.code === code);
    assert.deepEqual([by('EXM-S1').gpa, by('EXM-S1').pct, by('EXM-S1').result], [10, 90, 'pass']);
    assert.deepEqual([by('EXM-S2').gpa, by('EXM-S2').pct, by('EXM-S2').result, by('EXM-S2').creditsEarned], [4, 36.67, 'fail', 4]);
    assert.deepEqual(by('EXM-S2').failedSubjects, ['Subject B']);
    assert.deepEqual([by('EXM-S3').gpa, by('EXM-S3').pct, by('EXM-S3').result], [3, 46.67, 'fail']);
    assert.deepEqual(by('EXM-S3').subjects.map((s) => s.grade), ['F', 'A+']);
    assert.deepEqual(r.body.stats, { students: 3, complete: 3, incomplete: 0, passed: 1, failed: 2, passRate: 33.33, average: 57.78, highest: 90, lowest: 36.67 });
  });

  it('students see nothing until the exam is published', async () => {
    const r = await json('GET', '/api/student/results', { cookie: studentE1 });
    assert.equal(r.status, 200);
    assert.ok(!r.body.exams.some((e) => e.id === examId));
    assert.equal((await json('GET', `/api/student/results/${examId}/report-card.pdf`, { cookie: studentE1 })).status, 404);
  });

  it('cannot publish while a paper is not submitted, or with no papers', async () => {
    const e = await json('POST', '/api/admin/exams', { cookie: admin, body: { courseId, name: 'Empty exam', semester: 3 } });
    assert.equal((await json('POST', `/api/admin/exams/${e.body.exam.id}/publish`, { cookie: admin })).status, 400);
    const p = await json('POST', `/api/admin/exams/${e.body.exam.id}/papers`, { cookie: admin, body: { subject: 'P', maxMarks: 10, passMarks: 4, employeeId: empAId } });
    assert.equal(p.status, 201);
    const r = await json('POST', `/api/admin/exams/${e.body.exam.id}/publish`, { cookie: admin });
    assert.equal(r.status, 400);
    assert.match(r.body.message, /not submitted yet for: P/);
    assert.equal((await json('DELETE', `/api/admin/exams/${e.body.exam.id}`, { cookie: admin })).status, 200);
  });

  it('the report card is refused for a student whose marks are incomplete, and works for one whose are complete', async () => {
    const e = await json('POST', '/api/admin/exams', { cookie: admin, body: { courseId, name: 'Half marked', semester: 1, papers: [{ subject: 'Q', maxMarks: 10, passMarks: 4, employeeId: empAId }] } });
    assert.equal(e.status, 201, JSON.stringify(e.body));
    const half = e.body.exam.id; const pid = e.body.papers[0].id;
    const save = await json('PUT', `/api/admin/exams/${half}/papers/${pid}/marks`, { cookie: admin, body: { entries: [{ studentId: ids.e1, marks: 7 }] } });
    assert.equal(save.status, 200, JSON.stringify(save.body));
    const incomplete = await json('GET', `/api/admin/exams/${half}/students/${ids.e2}/report-card.pdf`, { cookie: admin });
    assert.equal(incomplete.status, 409);
    assert.match(incomplete.body.message, /not complete/);
    const complete = await json('GET', `/api/admin/exams/${half}/students/${ids.e1}/report-card.pdf`, { cookie: admin });
    assert.equal(complete.status, 200);
    assert.equal((await pdfInfo(complete)).head, '%PDF');
    assert.equal((await json('DELETE', `/api/admin/exams/${half}`, { cookie: admin })).status, 200);
  });

  it('publishes; students then see their own result, grades and report card', async () => {
    const r = await json('POST', `/api/admin/exams/${examId}/publish`, { cookie: admin });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.exam.status, 'published');

    const mine = await json('GET', '/api/student/results', { cookie: studentE1 });
    const exam = mine.body.exams.find((e) => e.id === examId);
    assert.deepEqual([exam.gpa, exam.pct, exam.result, exam.total, exam.maxTotal], [10, 90, 'pass', 135, 150]);
    assert.deepEqual(exam.subjects.map((s) => [s.subject, s.marks, s.grade]), [['Subject A', 90, 'O'], ['Subject B', 45, 'O']]);
    assert.equal(mine.body.cgpa, 10);

    const other = await json('GET', '/api/student/results', { cookie: studentE2 });
    const e2 = other.body.exams.find((e) => e.id === examId);
    assert.deepEqual([e2.result, e2.subjects[1].status, e2.subjects[1].marks], ['fail', 'absent', null]);
    assert.equal(other.body.cgpa, 4);
  });

  it('faculty can no longer edit a published exam; the admin can, it is audited, and results follow', async () => {
    const blocked = await put(empMarks(paperA), empA, [{ studentId: ids.e1, marks: 91 }]);
    assert.equal(blocked.status, 403);
    assert.match(blocked.body.message, /published/);
    assert.equal((await json('GET', empMarks(paperA), { cookie: empA })).body.editable, false);

    const fix = await put(adminMarks(paperA), admin, [{ studentId: ids.e3, marks: 45 }]);
    assert.equal(fix.status, 200, JSON.stringify(fix.body));
    const r = await json('GET', `/api/admin/exams/${examId}/results`, { cookie: admin });
    const e3 = r.body.students.find((s) => s.code === 'EXM-S3');
    assert.deepEqual([e3.result, e3.gpa, e3.pct], ['pass', 6.33, 56.67]);
    const n = await withTx({ tenantId }, async () => (await q("select count(*)::int as n from audit_log where action = 'exam.marks_edit_published' and entity_id = $1", [paperA])).rows[0].n);
    assert.equal(n, 1);
  });

  it('a published exam cannot have its papers changed or be deleted; unpublishing hides it from students', async () => {
    assert.equal((await json('POST', `/api/admin/exams/${examId}/papers`, { cookie: admin, body: { subject: 'Late', maxMarks: 10, passMarks: 4 } })).status, 409);
    assert.equal((await json('DELETE', `/api/admin/exams/${examId}/papers/${paperA}`, { cookie: admin })).status, 409);
    assert.equal((await json('DELETE', `/api/admin/exams/${examId}`, { cookie: admin })).status, 409);
    assert.equal((await json('POST', `/api/admin/exams/${examId}/unpublish`, { cookie: admin })).status, 200);
    assert.ok(!(await json('GET', '/api/student/results', { cookie: studentE1 })).body.exams.some((e) => e.id === examId));
    assert.equal((await json('POST', `/api/admin/exams/${examId}/unpublish`, { cookie: admin })).status, 409);
    assert.equal((await json('POST', `/api/admin/exams/${examId}/publish`, { cookie: admin })).status, 200, 'marks stayed submitted, so it republishes');
  });
});

describe('Grading scale', () => {
  it('uses the built-in scale until the institute sets its own, and a custom scale changes every result', async () => {
    assert.equal((await json('GET', '/api/admin/exams/grading', { cookie: admin })).body.custom, false);
    const bad = await json('PUT', '/api/admin/exams/grading', { cookie: admin, body: { bands: [{ grade: 'A', min: 50, points: 10 }, { grade: 'B', min: 10, points: 5 }] } });
    assert.equal(bad.status, 400);
    assert.match(bad.body.message, /start at 0%/);
    const set = await json('PUT', '/api/admin/exams/grading', {
      cookie: admin, body: { bands: [{ grade: 'D', min: 0, points: 0 }, { grade: 'C', min: 50, points: 5 }, { grade: 'B', min: 75, points: 8 }, { grade: 'A', min: 95, points: 10 }] },
    });
    assert.equal(set.status, 200, JSON.stringify(set.body));
    assert.deepEqual(set.body.bands.map((b) => b.grade), ['A', 'B', 'C', 'D']);
    const mine = await json('GET', '/api/student/results', { cookie: studentE1 });
    assert.equal(mine.body.exams.find((e) => e.id === examId).gpa, 8);
    assert.equal((await json('GET', '/api/admin/exams/grading', { cookie: schoolAdmin })).body.custom, false, 'another institute is unaffected');
    const reset = await json('DELETE', '/api/admin/exams/grading', { cookie: admin });
    assert.equal(reset.body.custom, false);
    assert.equal((await json('GET', '/api/student/results', { cookie: studentE1 })).body.exams.find((e) => e.id === examId).gpa, 10);
  });
});

describe('Report cards (PDF)', () => {
  it('a student downloads their own; the admin can print one or the whole class', async () => {
    const mine = await json('GET', `/api/student/results/${examId}/report-card.pdf`, { cookie: studentE1 });
    assert.equal(mine.status, 200);
    assert.deepEqual(await pdfInfo(mine), { type: 'application/pdf', head: '%PDF', pages: 1 });

    const one = await json('GET', `/api/admin/exams/${examId}/students/${ids.e2}/report-card.pdf`, { cookie: admin });
    assert.equal((await pdfInfo(one)).head, '%PDF');

    const all = await json('GET', `/api/admin/exams/${examId}/report-cards.pdf`, { cookie: admin });
    assert.equal(all.status, 200);
    assert.equal((await pdfInfo(all)).pages, 3, 'one page per student');
  });

  it('an unpublished exam prints as PROVISIONAL for the admin only', async () => {
    await json('POST', `/api/admin/exams/${examId}/unpublish`, { cookie: admin });
    const adm = await json('GET', `/api/admin/exams/${examId}/students/${ids.e1}/report-card.pdf`, { cookie: admin });
    assert.equal(adm.status, 200);
    assert.equal((await json('GET', `/api/student/results/${examId}/report-card.pdf`, { cookie: studentE1 })).status, 404);
    await json('POST', `/api/admin/exams/${examId}/publish`, { cookie: admin });
  });

  it("another institute's student cannot reach this exam's report card", async () => {
    assert.equal((await json('GET', `/api/student/results/${examId}/report-card.pdf`, { cookie: schoolStudent })).status, 404);
  });
});

describe('Admin results sheet and CSV', () => {
  it('lists exams filtered by status and course, with progress counts', async () => {
    const r = await json('GET', `/api/admin/exams?courseId=${courseId}&status=published`, { cookie: admin });
    assert.equal(r.status, 200);
    const e = r.body.exams.find((x) => x.id === examId);
    assert.deepEqual([e.papers, e.submitted, e.students], [2, 2, 3]);
    assert.equal((await json('GET', '/api/admin/exams?status=bogus', { cookie: admin })).status, 400);
  });

  it('exports CSV with AB for absent and neutralised spreadsheet formulas', async () => {
    const r = await json('GET', `/api/admin/exams/${examId}/results.csv`, { cookie: admin });
    assert.equal(r.status, 200);
    assert.match(r.res.headers.get('content-type'), /text\/csv/);
    const text = await r.res.text();
    assert.match(text, /Roll no,Student ID,Name,Subject A \(\/100\),Subject B \(\/50\),Total,Out of,Percentage,GPA,Result/);
    assert.match(text, /EXM-S2,Binod Test Two,55,AB,55,150,36\.67,4,FAIL/);
    assert.ok(!/,=Cara/.test(text) && /'=Cara/.test(text));
  });
});

describe('Tenant isolation', () => {
  it("another institute cannot see, edit or publish this exam or its marks", async () => {
    assert.equal((await json('GET', `/api/admin/exams/${examId}`, { cookie: schoolAdmin })).status, 404);
    assert.equal((await json('GET', `/api/admin/exams/${examId}/results`, { cookie: schoolAdmin })).status, 404);
    assert.equal((await json('GET', adminMarks(paperA), { cookie: schoolAdmin })).status, 404);
    assert.equal((await json('PUT', adminMarks(paperA), { cookie: schoolAdmin, body: { entries: [{ studentId: ids.e1, marks: 1 }] } })).status, 404);
    assert.equal((await json('POST', `/api/admin/exams/${examId}/unpublish`, { cookie: schoolAdmin })).status, 404);
    assert.ok(!(await json('GET', '/api/admin/exams', { cookie: schoolAdmin })).body.exams.some((e) => e.id === examId));
  });
});

describe('Demo data', () => {
  it('the seeded published exam gives a demo student results with a CGPA; the failed paper shows for another', async () => {
    const aarav = await login('demo-college', 'student', 'STU2026001', 'Student@123');
    const a = await json('GET', '/api/student/results', { cookie: aarav });
    assert.equal(a.body.exams.length, 1);
    assert.equal(a.body.exams[0].name, 'End-Semester Examination');
    assert.equal(a.body.exams[0].result, 'pass');
    assert.ok(a.body.cgpa > 0);
    const karan = await login('demo-college', 'student', 'STU2026003', 'Student@123');
    const k = await json('GET', '/api/student/results', { cookie: karan });
    assert.equal(k.body.exams[0].result, 'fail');
    assert.deepEqual(k.body.exams[0].failedSubjects, ['Discrete Mathematics']);
  });

  it('the seeded draft Mid-Semester exam gives faculty papers waiting for marks', async () => {
    const r = await json('GET', '/api/employee/exams/papers', { cookie: empA });
    const open = r.body.papers.filter((p) => p.examName === 'Mid-Semester Examination');
    assert.ok(open.length >= 1);
    assert.ok(open.every((p) => p.examStatus === 'draft' && p.marksStatus === 'draft'));
  });
});

describe('Deleting a timetable slot or course keeps result history sensible', () => {
  it('deleting an exam removes its papers and marks', async () => {
    await json('POST', `/api/admin/exams/${examId}/unpublish`, { cookie: admin });
    assert.equal((await json('DELETE', `/api/admin/exams/${examId}`, { cookie: admin })).status, 200);
    await withTx({ tenantId }, async () => {
      assert.equal((await q('select count(*)::int as n from exam_papers where exam_id = $1', [examId])).rows[0].n, 0);
      assert.equal((await q('select count(*)::int as n from exam_marks where paper_id = $1', [paperA])).rows[0].n, 0);
    });
  });
});

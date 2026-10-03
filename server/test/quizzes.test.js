/** Quizzes for internal marks - run with `npm test` (needs `npm run db:setup` first). */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import bcrypt from 'bcryptjs';
import { env } from '../src/config/env.js';
import { createApp } from '../src/app.js';
import { closePool, q, withTx } from '../src/db/pool.js';
import { issueCaptchaToken } from '../src/services/captcha.service.js';
import * as g from '../src/services/quizGrading.js';

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

/* ================================================================ pure grading rules */
describe('Quiz grading (no database)', () => {
  const single = { id: 's', kind: 'single', marks: 2, options: [{ text: 'a', correct: false }, { text: 'b', correct: true }, { text: 'c', correct: false }], answers: [] };
  const multi = { id: 'm', kind: 'multiple', marks: 4, options: [{ text: '1', correct: true }, { text: '2', correct: true }, { text: '3', correct: false }, { text: '4', correct: false }], answers: [] };
  const tf = { id: 't', kind: 'truefalse', marks: 1, options: [{ text: 'True', correct: false }, { text: 'False', correct: true }], answers: [] };
  const short = { id: 'x', kind: 'short', marks: 3, options: [], answers: ['Paris', '1,000'] };

  it('single and true/false: full marks, or a penalty for a wrong answer, never for a blank one', () => {
    assert.deepEqual(g.gradeQuestion(single, 1, 0), { awarded: 2, correct: true });
    assert.deepEqual(g.gradeQuestion(single, 0, 0), { awarded: -0, correct: false });
    assert.deepEqual(g.gradeQuestion(single, 0, 0.25), { awarded: -0.5, correct: false });
    assert.deepEqual(g.gradeQuestion(single, undefined, 0.25), { awarded: 0, correct: null });
    assert.deepEqual(g.gradeQuestion(tf, 1, 1), { awarded: 1, correct: true });
    assert.deepEqual(g.gradeQuestion(tf, 0, 1), { awarded: -1, correct: false });
  });
  it('multiple choice: partial credit for right picks, wrong picks cancel them, never below zero', () => {
    assert.equal(g.gradeQuestion(multi, [0, 1]).awarded, 4);
    assert.equal(g.gradeQuestion(multi, [0]).awarded, 2);
    assert.equal(g.gradeQuestion(multi, [0, 2]).awarded, 0, 'one right, one wrong');
    assert.equal(g.gradeQuestion(multi, [2, 3]).awarded, 0);
    assert.equal(g.gradeQuestion(multi, [0, 1, 2]).awarded, 2, 'two right, one wrong: (2-1)/2');
    assert.equal(g.gradeQuestion(multi, [0, 1]).correct, true);
    assert.equal(g.gradeQuestion(multi, [0]).correct, 'partial');
    assert.equal(g.gradeQuestion(multi, []).correct, null);
  });
  it('short answers ignore case, spacing, a final full stop and number formatting', () => {
    for (const a of ['paris', '  PARIS. ', 'Paris']) assert.equal(g.gradeQuestion(short, a).awarded, 3, a);
    for (const a of ['1000', '1,000', '1000.0']) assert.equal(g.gradeQuestion(short, a).correct, true, a);
    assert.equal(g.gradeQuestion(short, 'London').awarded, 0);
    assert.equal(g.gradeQuestion(short, '   ').correct, null);
  });
  it('an attempt total never goes below zero, and the maximum is the sum of the marks', () => {
    const r = g.gradeAttempt([single, tf], { s: 0, t: 0 }, 1);
    assert.deepEqual([r.score, r.max], [0, 3]);
    const ok = g.gradeAttempt([single, multi, tf, short], { s: 1, m: [0, 1], t: 1, x: 'paris' }, 0.5);
    assert.deepEqual([ok.score, ok.max], [10, 10]);
  });
  it('scales a quiz score to the internal marks it is worth', () => {
    assert.equal(g.scaledMarks(17, 20, 10), 8.5);
    assert.equal(g.scaledMarks(5, 8, 10), 6.25);
    assert.equal(g.scaledMarks(0, 8, 10), 0);
    assert.equal(g.scaledMarks(3, 0, 10), 0);
  });
  it('counts the best or the latest attempt', () => {
    const at = (no, score) => ({ attemptNo: no, status: 'submitted', score, maxScore: 10 });
    const list = [at(1, 9), at(2, 4), { attemptNo: 3, status: 'in_progress', score: null, maxScore: null }];
    assert.equal(g.countedAttempt(list, 'best').attemptNo, 1);
    assert.equal(g.countedAttempt(list, 'latest').attemptNo, 2, 'an unfinished attempt is never counted');
    assert.equal(g.countedAttempt([], 'best'), null);
  });
  it('shuffling is repeatable for the same seed and differs between seeds', () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    assert.deepEqual(g.seededShuffle(items, 'abc'), g.seededShuffle(items, 'abc'));
    assert.notDeepEqual(g.seededShuffle(items, 'abc'), g.seededShuffle(items, 'xyz'));
    assert.deepEqual([...g.seededShuffle(items, 'abc')].sort(), items);
  });
  it('rejects a badly built question with a message a teacher can act on', () => {
    const bad = (q, re) => assert.throws(() => g.cleanQuestion(q, 2), re);
    bad({ kind: 'nope', text: 'x' }, /choose a question type/);
    bad({ kind: 'single', text: '' }, /write the question/);
    bad({ kind: 'single', text: 'q', marks: 0, options: [] }, /marks must be/);
    bad({ kind: 'single', text: 'q', options: [{ text: 'a', correct: true }] }, /at least two options/);
    bad({ kind: 'single', text: 'q', options: [{ text: 'a', correct: true }, { text: 'b', correct: true }] }, /exactly one/);
    bad({ kind: 'single', text: 'q', options: [{ text: 'a' }, { text: 'b' }] }, /exactly one/);
    bad({ kind: 'single', text: 'q', options: [{ text: 'a', correct: true }, { text: 'A', correct: false }] }, /two options are the same/);
    bad({ kind: 'single', text: 'q', options: [{ text: 'a', correct: true }, { text: '', correct: false }] }, /option is empty/);
    bad({ kind: 'multiple', text: 'q', options: [{ text: 'a' }, { text: 'b' }] }, /at least one option as correct/);
    bad({ kind: 'truefalse', text: 'q', options: [{ correct: true }, { correct: true }] }, /either True or False/);
    bad({ kind: 'short', text: 'q', answers: [] }, /accepted answer/);
    assert.deepEqual(g.cleanQuestion({ kind: 'truefalse', text: 'q', options: [{ correct: false }, { correct: true }] }, 1).options.map((o) => o.text), ['True', 'False']);
    assert.deepEqual(g.cleanQuestion({ kind: 'short', text: 'q', answers: 'Paris\nparis\n  \nFrance' }, 1).answers, ['Paris', 'paris', 'France']);
  });
  it('cleans a student\'s answer to the right shape and refuses nonsense', () => {
    assert.equal(g.cleanAnswer(single, 1), 1);
    assert.equal(g.cleanAnswer(single, null), undefined);
    assert.throws(() => g.cleanAnswer(single, 9), /not one of the options/);
    assert.throws(() => g.cleanAnswer(single, '1'), /not one of the options/);
    assert.deepEqual(g.cleanAnswer(multi, [2, 0, 2]), [0, 2]);
    assert.equal(g.cleanAnswer(multi, []), undefined);
    assert.throws(() => g.cleanAnswer(multi, 'x'), /Choose from the options/);
    assert.equal(g.cleanAnswer(short, 'x'.repeat(900)).length, 500);
  });
});

/* ================================================================ fixtures */
const SUBJ = 'Quiz Test Subject';
const SUBJ2 = 'Quiz Test Subject Two';
let admin; let schoolAdmin; let empA; let empB; let st1; let st2; let st3; let stOther; let tenantId; let courseId; let otherCourseId; let empAId;
const ids = {};
const ago = (min) => new Date(Date.now() - min * 60000).toISOString();
const ahead = (min) => new Date(Date.now() + min * 60000).toISOString();

before(async () => {
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  admin = await login('demo-college', 'admin', 'ADM001', 'Admin@123');
  schoolAdmin = await login('demo-school', 'admin', 'ADM001', 'Admin@123');
  empA = await login('demo-college', 'employee', 'EMP001', 'Employee@123');
  empB = await login('demo-college', 'employee', 'EMP002', 'Employee@123');
  tenantId = (await withTx({ platform: true }, () => q("select id from tenants where code = 'demo-college'"))).rows[0].id;
  await withTx({ tenantId }, async () => {
    empAId = (await q("select id from employees where emp_code = 'EMP001'")).rows[0].id;
    courseId = (await q("insert into courses (code, name) values ('QZTEST', 'Quiz Test Class') returning id")).rows[0].id;
    otherCourseId = (await q("insert into courses (code, name) values ('QZOTHER', 'Quiz Other Class') returning id")).rows[0].id;
    const hash = bcrypt.hashSync('Student@123', 8);
    for (const [key, code, name, roll, cid, sem, sec] of [
      ['s1', 'QZ-S1', 'Quiz One', '1', courseId, 3, 'A'], ['s2', 'QZ-S2', 'Quiz Two', '2', courseId, 3, 'A'], ['s3', 'QZ-S3', 'Quiz Three', '3', courseId, 3, 'B'], ['o', 'QZ-S4', 'Quiz Other', '4', otherCourseId, 3, 'A'],
    ]) {
      ids[key] = (await q('insert into students (student_code, roll_no, name, email, course_id, semester, section) values ($1,$2,$3,$4,$5,$6,$7) returning id', [code, roll, name, `${code.toLowerCase()}@qztest.example`, cid, sem, sec])).rows[0].id;
      await q("insert into users (role, login_id, email, name, password_hash, student_id) values ('student', $1, $2, $3, $4, $5)", [code, `${code.toLowerCase()}@qztest.example`, name, hash, ids[key]]);
    }
    await q("insert into timetable_slots (course_id, weekday, start_time, end_time, subject, employee_id) values ($1, 1, '20:00', '20:30', $2, $3), ($1, 2, '20:00', '20:30', $4, $3)", [courseId, SUBJ, empAId, SUBJ2]);
  });
  st1 = await login('demo-college', 'student', 'QZ-S1', 'Student@123');
  st2 = await login('demo-college', 'student', 'QZ-S2', 'Student@123');
  st3 = await login('demo-college', 'student', 'QZ-S3', 'Student@123');
  stOther = await login('demo-college', 'student', 'QZ-S4', 'Student@123');
});

after(async () => {
  try {
    await withTx({ tenantId }, async () => {
      await q("delete from users where login_id like 'QZ-S%'");
      await q("delete from students where student_code like 'QZ-S%'"); // their attempts go with them
      await q("delete from courses where code in ('QZTEST', 'QZOTHER')"); // quizzes, questions and timetable slots go with the class
    });
  } finally {
    await new Promise((r) => server.close(r));
    await closePool();
  }
});

const QS = () => [
  { kind: 'single', text: 'What is 2 + 2?', marks: 2, options: [{ text: '3' }, { text: '4', correct: true }, { text: '5' }, { text: '6' }] },
  { kind: 'multiple', text: 'Which are prime?', marks: 3, options: [{ text: '2', correct: true }, { text: '9' }, { text: '11', correct: true }, { text: '15' }] },
  { kind: 'truefalse', text: 'The Earth is round.', marks: 1, options: [{ correct: true }, { correct: false }] },
  { kind: 'short', text: 'Capital of France?', marks: 2, answers: ['Paris'] },
];
const quizBody = (o = {}) => ({
  title: 'QZ Quiz', subject: SUBJ, courseId, semester: 3, section: '', durationMinutes: 30, openAt: ago(60), closeAt: ahead(60 * 48), maxAttempts: 1, scoring: 'best',
  weightage: 10, negativeMarks: 0, shuffle: true, showResults: 'after_submit', questions: QS(), ...o,
});
async function makeQuiz(over = {}, { cookie = admin, prefix = 'admin', publish = true } = {}) {
  const c = await json('POST', `/api/${prefix}/quizzes`, { cookie, body: quizBody(over) });
  assert.equal(c.status, 201, JSON.stringify(c.body));
  if (publish) { const p = await json('POST', `/api/${prefix}/quizzes/${c.body.quiz.id}/publish`, { cookie }); assert.equal(p.status, 200, JSON.stringify(p.body)); return p.body.quiz; }
  return c.body.quiz;
}
const start = (cookie, id) => json('POST', `/api/student/quizzes/${id}/start`, { cookie });
const save = (cookie, id, answers) => json('PUT', `/api/student/quizzes/${id}/answers`, { cookie, body: { answers } });
const submit = (cookie, id, answers) => json('POST', `/api/student/quizzes/${id}/submit`, { cookie, body: answers ? { answers } : {} });
/** The original option index of the option with this text, in the question with this text (the screen shuffles them). */
const opt = (view, qtext, optText) => { const x = view.questions.find((k) => k.text === qtext); return x.options.find((o) => o.text === optText).i; };
const qid = (view, qtext) => view.questions.find((k) => k.text === qtext).id;
const perfect = (v) => ({ [qid(v, 'What is 2 + 2?')]: opt(v, 'What is 2 + 2?', '4'), [qid(v, 'Which are prime?')]: [opt(v, 'Which are prime?', '2'), opt(v, 'Which are prime?', '11')], [qid(v, 'The Earth is round.')]: opt(v, 'The Earth is round.', 'True'), [qid(v, 'Capital of France?')]: 'Paris' });
const mixed = (v) => ({ [qid(v, 'What is 2 + 2?')]: opt(v, 'What is 2 + 2?', '4'), [qid(v, 'Which are prime?')]: [opt(v, 'Which are prime?', '9')], [qid(v, 'The Earth is round.')]: opt(v, 'The Earth is round.', 'True'), [qid(v, 'Capital of France?')]: '  paris. ' });
const attemptsIn = async (quizId, key) => (await withTx({ tenantId }, () => q('select id, status, auto_submitted as auto, score::float8 as score, answers from quiz_attempts where quiz_id = $1 and student_id = $2 order by attempt_no', [quizId, ids[key]]))).rows;

/* ================================================================ building quizzes */
describe('Building a quiz', () => {
  it('keeps the roles apart', async () => {
    assert.equal((await json('GET', '/api/admin/quizzes', { cookie: st1 })).status, 403);
    assert.equal((await json('GET', '/api/employee/quizzes', { cookie: admin })).status, 403);
    assert.equal((await json('GET', '/api/student/quizzes', { cookie: empA })).status, 403);
    assert.equal((await json('GET', '/api/student/quizzes')).status, 401);
  });

  it('a teacher sets quizzes only for subjects they teach; an admin for any', async () => {
    const own = await json('POST', '/api/employee/quizzes', { cookie: empA, body: quizBody({ title: 'QZ Own' }) });
    assert.equal(own.status, 201, JSON.stringify(own.body));
    const no = await json('POST', '/api/employee/quizzes', { cookie: empB, body: quizBody() });
    assert.equal(no.status, 403);
    assert.match(no.body.message, /subject you teach/);
    assert.equal((await json('POST', '/api/employee/quizzes', { cookie: empA, body: quizBody({ subject: 'Not My Subject' }) })).status, 403);
    assert.equal((await json('POST', '/api/admin/quizzes', { cookie: admin, body: quizBody({ title: 'QZ Admin Any', subject: 'Anything At All' }) })).status, 201);
    const scope = (await json('GET', '/api/employee/quizzes/scope', { cookie: empA })).body.scope;
    assert.ok(scope.some((s) => s.subject === SUBJ) && scope.some((s) => s.subject === SUBJ2));
  });

  it('validates the settings', async () => {
    const bad = (o) => json('POST', '/api/admin/quizzes', { cookie: admin, body: quizBody(o) });
    assert.equal((await bad({ title: '' })).status, 400);
    assert.equal((await bad({ courseId: 'nope' })).status, 400);
    assert.equal((await bad({ semester: 0 })).status, 400);
    assert.equal((await bad({ durationMinutes: 0 })).status, 400);
    assert.equal((await bad({ durationMinutes: 999 })).status, 400);
    assert.equal((await bad({ maxAttempts: 0 })).status, 400);
    assert.equal((await bad({ weightage: 0 })).status, 400);
    assert.equal((await bad({ negativeMarks: 2 })).status, 400);
    assert.equal((await bad({ scoring: 'average' })).status, 400);
    assert.equal((await bad({ showResults: 'whenever' })).status, 400);
    assert.equal((await bad({ openAt: 'soon' })).status, 400);
    assert.equal((await bad({ openAt: ahead(60), closeAt: ahead(30) })).status, 400, 'it must close after it opens');
    const badQ = await bad({ questions: [{ kind: 'single', text: 'q', options: [{ text: 'a', correct: true }] }] });
    assert.equal(badQ.status, 400);
    assert.match(badQ.body.message, /Question 1: give at least two options/);
    assert.equal((await bad({ questions: Array.from({ length: 101 }, () => QS()[3]) })).status, 400);
  });

  it('cannot be published without questions or with a closing time already past', async () => {
    const empty = await makeQuiz({ title: 'QZ Empty', questions: [] }, { publish: false });
    const p = await json('POST', `/api/admin/quizzes/${empty.id}/publish`, { cookie: admin });
    assert.equal(p.status, 400);
    assert.match(p.body.message, /at least one question/);
    const past = await makeQuiz({ title: 'QZ Past', closeAt: ago(5), openAt: ago(60) }, { publish: false });
    assert.equal((await json('POST', `/api/admin/quizzes/${past.id}/publish`, { cookie: admin })).status, 400);
  });

  it('a teacher sees only the quizzes they made or teach; others look nonexistent', async () => {
    const mine = await makeQuiz({ title: 'QZ Mine' }, { cookie: empA, prefix: 'employee' });
    assert.equal((await json('GET', `/api/employee/quizzes/${mine.id}`, { cookie: empA })).status, 200);
    assert.equal((await json('GET', `/api/employee/quizzes/${mine.id}`, { cookie: empB })).status, 404);
    assert.equal((await json('PUT', `/api/employee/quizzes/${mine.id}`, { cookie: empB, body: { title: 'x' } })).status, 404);
    assert.equal((await json('GET', `/api/employee/quizzes/${mine.id}/results`, { cookie: empB })).status, 404);
    assert.ok(!(await json('GET', '/api/employee/quizzes', { cookie: empB })).body.quizzes.some((z) => z.id === mine.id));
    assert.ok((await json('GET', '/api/employee/quizzes', { cookie: empA })).body.quizzes.some((z) => z.id === mine.id));
  });
});

/* ================================================================ taking a quiz */
describe('Taking a quiz', () => {
  let quiz;
  before(async () => { quiz = await makeQuiz({ title: 'QZ Take', maxAttempts: 2 }); });

  it('only the right students see it: its class, semester and section; a draft is invisible', async () => {
    const draft = await makeQuiz({ title: 'QZ Draft Hidden' }, { publish: false });
    const list = async (c) => (await json('GET', '/api/student/quizzes', { cookie: c })).body.quizzes.map((z) => z.title);
    assert.ok((await list(st1)).includes('QZ Take') && (await list(st2)).includes('QZ Take') && (await list(st3)).includes('QZ Take'));
    assert.ok(!(await list(stOther)).includes('QZ Take'), 'a student of another class never sees it');
    assert.ok(!(await list(st1)).includes('QZ Draft Hidden'));
    assert.equal((await start(st1, draft.id)).status, 404);
    assert.equal((await start(stOther, quiz.id)).status, 404);
    const sectionA = await makeQuiz({ title: 'QZ Section A Only', section: 'A' });
    assert.ok((await list(st1)).includes('QZ Section A Only'));
    assert.ok(!(await list(st3)).includes('QZ Section A Only'), 'section B does not see a section A quiz');
    assert.equal((await start(st3, sectionA.id)).status, 404);
  });

  it('never sends a correct answer to a student - not in the list, not on starting, not while answering', async () => {
    const list = await json('GET', '/api/student/quizzes', { cookie: st1 });
    assert.ok(!JSON.stringify(list.body).includes('"correct"'));
    const s = await start(st1, quiz.id);
    assert.equal(s.status, 200, JSON.stringify(s.body));
    const raw = JSON.stringify(s.body);
    assert.ok(!raw.includes('"correct"') && !raw.includes('Paris') && !raw.includes('"explanation"'), 'no answer key in the question paper');
    assert.deepEqual(s.body.questions.map((k) => k.kind).sort(), ['multiple', 'short', 'single', 'truefalse']);
    assert.equal(s.body.questions.find((k) => k.kind === 'short').options.length, 0);
    assert.equal(s.body.quiz.totalMarks, 8);
    assert.ok(new Date(s.body.attempt.deadlineAt) > new Date(s.body.serverNow));
    assert.ok(!JSON.stringify((await save(st1, quiz.id, {})).body).includes('"correct"'));
  });

  it('resuming shows the same question order and the saved answers', async () => {
    const a = (await start(st1, quiz.id)).body;
    await save(st1, quiz.id, { [qid(a, 'Capital of France?')]: 'Par' });
    const b = (await start(st1, quiz.id)).body;
    assert.equal(b.attempt.id, a.attempt.id, 'the running attempt is resumed, not restarted');
    assert.deepEqual(b.questions.map((k) => k.id), a.questions.map((k) => k.id));
    assert.deepEqual(b.questions.map((k) => k.options.map((o) => o.i)), a.questions.map((k) => k.options.map((o) => o.i)));
    assert.equal(b.answers[qid(a, 'Capital of France?')], 'Par');
    assert.equal((await attemptsIn(quiz.id, 's1')).length, 1);
  });

  it('two simultaneous starts still produce exactly one attempt', async () => {
    const [a, b, c] = await Promise.all([start(st2, quiz.id), start(st2, quiz.id), start(st2, quiz.id)]);
    assert.deepEqual([a.status, b.status, c.status], [200, 200, 200]);
    assert.equal(new Set([a.body.attempt.id, b.body.attempt.id, c.body.attempt.id]).size, 1);
    assert.equal((await attemptsIn(quiz.id, 's2')).length, 1);
  });

  it('answers are checked: unknown questions, options that do not exist, and the wrong shape are refused', async () => {
    const v = (await start(st1, quiz.id)).body;
    assert.equal((await save(st1, quiz.id, { '00000000-0000-4000-8000-000000000000': 1 })).status, 400);
    assert.equal((await save(st1, quiz.id, { [qid(v, 'What is 2 + 2?')]: 9 })).status, 400);
    assert.equal((await save(st1, quiz.id, { [qid(v, 'What is 2 + 2?')]: 'four' })).status, 400);
    assert.equal((await save(st1, quiz.id, { [qid(v, 'Which are prime?')]: 2 })).status, 400);
    assert.equal((await save(st1, quiz.id, [1, 2])).status, 400);
    assert.equal((await save(st1, quiz.id, { [qid(v, 'Capital of France?')]: 'x'.repeat(900) })).status, 200, 'overlong text is trimmed, not an error');
  });

  it('autosave can change and clear answers; submitting grades from the server, ignoring any score the browser might send', async () => {
    const v = (await start(st1, quiz.id)).body;
    await save(st1, quiz.id, perfect(v));
    await save(st1, quiz.id, { [qid(v, 'Capital of France?')]: '' });
    assert.equal((await attemptsIn(quiz.id, 's1'))[0].answers[qid(v, 'Capital of France?')], undefined, 'a cleared answer is removed');
    const r = await json('POST', `/api/student/quizzes/${quiz.id}/submit`, { cookie: st1, body: { answers: perfect(v), score: 999, max: 1, status: 'submitted' } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual([r.body.counted.score, r.body.counted.max, r.body.counted.marks], [8, 8, 10]);
    const [row] = await attemptsIn(quiz.id, 's1');
    assert.deepEqual([row.status, row.score, row.auto], ['submitted', 8, false]);
  });

  it('pressing Submit twice is harmless, and a submitted attempt cannot be changed', async () => {
    const again = await submit(st1, quiz.id);
    assert.equal(again.status, 200);
    assert.equal(again.body.counted.score, 8);
    assert.equal((await save(st1, quiz.id, { x: 1 })).status, 409);
    assert.equal((await attemptsIn(quiz.id, 's1')).length, 1);
  });

  it('a second attempt is allowed up to the limit; the BEST attempt counts', async () => {
    const v = (await start(st1, quiz.id)).body;
    assert.equal(v.attempt.no, 2);
    await submit(st1, quiz.id, mixed(v));
    const res = (await json('GET', `/api/student/quizzes/${quiz.id}/result`, { cookie: st1 })).body;
    assert.equal(res.attempts.length, 2);
    assert.equal(res.counted.score, 8, 'the perfect first attempt still counts');
    assert.equal((await start(st1, quiz.id)).status, 409);
    assert.equal((await start(st1, quiz.id)).body.code, 'NO_ATTEMPTS');
  });

  it('shows the correct answers only once no attempts are left (so they cannot be copied into the next try)', async () => {
    const early = (await json('GET', `/api/student/quizzes/${quiz.id}/result`, { cookie: st2 }));
    assert.equal(early.status, 200, 'st2 has an attempt running from the earlier test');
    assert.deepEqual([early.body.counted, early.body.review, early.body.attempts[0].status], [null, null, 'in_progress'], 'nothing is counted or revealed until it is submitted');
    assert.equal((await json('GET', `/api/student/quizzes/${quiz.id}/result`, { cookie: st3 })).status, 404, 'st3 never started');
    const v = (await start(st2, quiz.id)).body;
    await submit(st2, quiz.id, mixed(v));
    const mid = (await json('GET', `/api/student/quizzes/${quiz.id}/result`, { cookie: st2 })).body;
    assert.equal(mid.review, null, 'one attempt left: no answer key yet');
    assert.deepEqual([mid.counted.score, mid.counted.max, mid.counted.marks], [5, 8, 6.25]);
    const v2 = (await start(st2, quiz.id)).body;
    await submit(st2, quiz.id, mixed(v2));
    const done = (await json('GET', `/api/student/quizzes/${quiz.id}/result`, { cookie: st2 })).body;
    assert.equal(done.review.length, 4);
    const prime = done.review.find((x) => x.text === 'Which are prime?');
    assert.deepEqual([prime.correct, prime.awarded], [false, 0]);
    assert.deepEqual(prime.options.filter((o) => o.correct).map((o) => o.text).sort(), ['11', '2']);
    assert.ok(prime.explanation !== undefined);
  });
});

/* ================================================================ the clock is the server's */
describe('Time limits', () => {
  it('the deadline is enforced by the server: a late save is refused and the attempt is graded from what was saved in time', async () => {
    const z = await makeQuiz({ title: 'QZ Timed', durationMinutes: 5 });
    const v = (await start(st1, z.id)).body;
    await save(st1, z.id, { [qid(v, 'What is 2 + 2?')]: opt(v, 'What is 2 + 2?', '4') });
    await withTx({ tenantId }, () => q("update quiz_attempts set deadline_at = now() - interval '1 minute' where quiz_id = $1", [z.id]));
    const late = await save(st1, z.id, perfect(v));
    assert.equal(late.status, 200, 'a normal reply, so that the automatic submission is really saved');
    assert.deepEqual([late.body.saved, late.body.timeUp, late.body.submitted], [false, true, true]);
    assert.match(late.body.message, /submitted automatically/);
    const [row] = await attemptsIn(z.id, 's1');
    assert.deepEqual([row.status, row.auto, row.score], ['submitted', true, 2], 'persisted, and graded from only the single question saved before time ran out');
    assert.equal((await save(st1, z.id, {})).status, 409, 'and a further save finds no attempt in progress');
  });

  it('answers sent along with a late Submit are not accepted', async () => {
    const z = await makeQuiz({ title: 'QZ Late Submit', durationMinutes: 5 });
    const v = (await start(st1, z.id)).body;
    await withTx({ tenantId }, () => q("update quiz_attempts set deadline_at = now() - interval '1 minute' where quiz_id = $1", [z.id]));
    const r = await submit(st1, z.id, perfect(v));
    assert.equal(r.status, 200);
    assert.equal(r.body.counted.score, 0, 'the perfect answers arrived after the deadline');
    assert.equal((await attemptsIn(z.id, 's1'))[0].auto, true);
  });

  it('an attempt nobody came back to is submitted automatically the next time anyone looks', async () => {
    const z = await makeQuiz({ title: 'QZ Abandoned', durationMinutes: 5 });
    const v = (await start(st1, z.id)).body;
    await save(st1, z.id, perfect(v));
    await withTx({ tenantId }, () => q("update quiz_attempts set deadline_at = now() - interval '2 minutes' where quiz_id = $1", [z.id]));
    const res = (await json('GET', `/api/admin/quizzes/${z.id}/results`, { cookie: admin })).body;
    assert.equal(res.students.find((s) => s.code === 'QZ-S1').score, 8, 'graded from what the student had saved');
    assert.equal((await attemptsIn(z.id, 's1'))[0].status, 'submitted');
  });

  it('the deadline can never be later than the closing time', async () => {
    const z = await makeQuiz({ title: 'QZ Capped', durationMinutes: 120, closeAt: ahead(10) });
    const v = (await start(st1, z.id)).body;
    const mins = (new Date(v.attempt.deadlineAt) - new Date(v.serverNow)) / 60000;
    assert.ok(mins > 9 && mins <= 10.1, `deadline is about 10 minutes away, got ${mins}`);
  });

  it('cannot be started before it opens or after it closes', async () => {
    const soon = await makeQuiz({ title: 'QZ Upcoming', openAt: ahead(60), closeAt: ahead(120) });
    const r = await start(st1, soon.id);
    assert.deepEqual([r.status, r.body.code], [409, 'NOT_OPEN']);
    const mine = (await json('GET', '/api/student/quizzes', { cookie: st1 })).body.quizzes.find((x) => x.id === soon.id);
    assert.equal(mine.state, 'upcoming');
    const over = await makeQuiz({ title: 'QZ Ended' });
    await withTx({ tenantId }, () => q("update quizzes set open_at = now() - interval '3 hours', close_at = now() - interval '1 hour' where id = $1", [over.id]));
    assert.deepEqual([(await start(st1, over.id)).status, (await start(st1, over.id)).body.code], [409, 'CLOSED']);
    assert.equal((await json('GET', '/api/student/quizzes', { cookie: st1 })).body.quizzes.find((x) => x.id === over.id).state, 'missed');
  });
});

/* ================================================================ negative marking */
describe('Negative marking', () => {
  it('a wrong single/true-false answer loses part of its marks, a blank one loses nothing, and the total stops at zero', async () => {
    const z = await makeQuiz({ title: 'QZ Negative', negativeMarks: 0.5 });
    const v = (await start(st1, z.id)).body;
    const wrong = { [qid(v, 'What is 2 + 2?')]: opt(v, 'What is 2 + 2?', '3'), [qid(v, 'The Earth is round.')]: opt(v, 'The Earth is round.', 'False'), [qid(v, 'Capital of France?')]: 'Paris' };
    const r = await submit(st1, z.id, wrong);
    assert.equal(r.body.counted.score, 0.5, 'single -1, true/false -0.5, short +2 = 0.5');
    const z2 = await makeQuiz({ title: 'QZ Negative Floor', negativeMarks: 1 });
    const v2 = (await start(st2, z2.id)).body;
    const r2 = await submit(st2, z2.id, { [qid(v2, 'What is 2 + 2?')]: opt(v2, 'What is 2 + 2?', '3'), [qid(v2, 'The Earth is round.')]: opt(v2, 'The Earth is round.', 'False') });
    assert.equal(r2.body.counted.score, 0, 'never below zero');
  });
});

/* ================================================================ who sees their score */
describe('When students see their results', () => {
  it('"never": the score stays hidden, in every view, including the internal-marks total', async () => {
    const z = await makeQuiz({ title: 'QZ Never', showResults: 'never', subject: SUBJ2 });
    const v = (await start(st1, z.id)).body;
    await submit(st1, z.id, perfect(v));
    const res = (await json('GET', `/api/student/quizzes/${z.id}/result`, { cookie: st1 })).body;
    assert.deepEqual([res.counted, res.review, res.attempts[0].score], [null, null, null]);
    const list = (await json('GET', '/api/student/quizzes', { cookie: st1 })).body.quizzes.find((x) => x.id === z.id);
    assert.deepEqual(list.result, { hidden: true });
    const marks = (await json('GET', '/api/student/internal-marks', { cookie: st1 })).body.subjects.find((s) => s.subject === SUBJ2);
    const row = marks.quizzes.find((x) => x.id === z.id);
    assert.deepEqual([row.hidden, row.marks, row.counted], [true, null, false]);
    assert.equal(marks.obtained, 0, 'a hidden score is not leaked through the total');
  });

  it('"after close": hidden while it is open, shown once the teacher closes it', async () => {
    const z = await makeQuiz({ title: 'QZ After Close', showResults: 'after_close' });
    const v = (await start(st1, z.id)).body;
    await submit(st1, z.id, perfect(v));
    assert.equal((await json('GET', `/api/student/quizzes/${z.id}/result`, { cookie: st1 })).body.counted, null);
    await json('POST', `/api/admin/quizzes/${z.id}/close`, { cookie: admin });
    const after = (await json('GET', `/api/student/quizzes/${z.id}/result`, { cookie: st1 })).body;
    assert.equal(after.counted.score, 8);
    assert.equal(after.review.length, 4, 'and the answer key too, now that nobody can use it');
  });
});

/* ================================================================ running a quiz as a teacher */
describe('Running a quiz', () => {
  it('closing a quiz submits every attempt still in progress, from what was saved', async () => {
    const z = await makeQuiz({ title: 'QZ Close Me' });
    const v = (await start(st1, z.id)).body;
    await save(st1, z.id, perfect(v));
    const closed = await json('POST', `/api/admin/quizzes/${z.id}/close`, { cookie: admin });
    assert.equal(closed.status, 200);
    assert.deepEqual([(await attemptsIn(z.id, 's1'))[0].status, (await attemptsIn(z.id, 's1'))[0].score], ['submitted', 8]);
    assert.equal((await start(st2, z.id)).body.code, 'CLOSED');
    assert.equal((await json('POST', `/api/admin/quizzes/${z.id}/close`, { cookie: admin })).status, 409);
    assert.equal((await json('POST', `/api/admin/quizzes/${z.id}/reopen`, { cookie: admin })).status, 200);
    assert.equal((await start(st2, z.id)).status, 200, 'reopened');
  });

  it('once students have attempted it, the questions and class are locked, but wording and timing can still be fixed', async () => {
    const z = await makeQuiz({ title: 'QZ Lock' });
    await start(st1, z.id);
    const edit = (body, cookie = admin) => json('PUT', `/api/admin/quizzes/${z.id}`, { cookie, body });
    assert.equal((await edit({ questions: QS().slice(0, 2) })).status, 409);
    assert.equal((await edit({ courseId: otherCourseId })).status, 409);
    assert.equal((await edit({ subject: 'Different' })).status, 409);
    const ok = await edit({ title: 'QZ Lock (renamed)', instructions: 'Read carefully', closeAt: ahead(60 * 72) });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.quiz.title, 'QZ Lock (renamed)');
    assert.equal(ok.body.quiz.questions.length, 4);
    assert.equal((await json('DELETE', `/api/admin/quizzes/${z.id}`, { cookie: admin })).status, 409, 'cannot delete a quiz that has been attempted');
  });

  it('before anyone attempts it, everything can change and it can be deleted', async () => {
    const z = await makeQuiz({ title: 'QZ Free Edit' });
    const r = await json('PUT', `/api/admin/quizzes/${z.id}`, { cookie: admin, body: { questions: QS().slice(0, 1), subject: SUBJ2 } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.quiz.questions.length, 1);
    assert.equal((await json('DELETE', `/api/admin/quizzes/${z.id}`, { cookie: admin })).status, 200);
  });

  it('a teacher can give one student another attempt', async () => {
    const z = await makeQuiz({ title: 'QZ Extra' });
    const v = (await start(st1, z.id)).body; await submit(st1, z.id, mixed(v));
    assert.equal((await start(st1, z.id)).body.code, 'NO_ATTEMPTS');
    assert.equal((await json('POST', `/api/employee/quizzes/${z.id}/extra-attempts`, { cookie: empB, body: { studentId: ids.s1 } })).status, 404, 'not their quiz');
    assert.equal((await json('POST', `/api/admin/quizzes/${z.id}/extra-attempts`, { cookie: admin, body: { studentId: ids.o } })).status, 404, 'a student outside the class');
    assert.equal((await json('POST', `/api/admin/quizzes/${z.id}/extra-attempts`, { cookie: admin, body: { studentId: 'x' } })).status, 400);
    const g1 = await json('POST', `/api/employee/quizzes/${z.id}/extra-attempts`, { cookie: empA, body: { studentId: ids.s1 } });
    assert.equal(g1.status, 200, JSON.stringify(g1.body));
    assert.equal((await start(st1, z.id)).status, 200);
    assert.equal((await start(st2, z.id)).status, 200, 'only the named student got the extra attempt; others still have their one');
  });
});

/* ================================================================ results and internal marks */
describe('Results and internal marks', () => {
  let z1; let z2;
  before(async () => {
    z1 = await makeQuiz({ title: 'QZ Marks One', subject: 'QZ Marks Subject', weightage: 10 }, { cookie: admin });
    z2 = await makeQuiz({ title: 'QZ Marks Two', subject: 'QZ Marks Subject', weightage: 5, scoring: 'latest', maxAttempts: 2 });
    const v1 = (await start(st1, z1.id)).body; await submit(st1, z1.id, perfect(v1));               // 8/8 -> 10
    const v2 = (await start(st2, z1.id)).body; await submit(st2, z1.id, mixed(v2));                 // 5/8 -> 6.25
    const a = (await start(st1, z2.id)).body; await submit(st1, z2.id, perfect(a));                 // first: 8/8
    const b = (await start(st1, z2.id)).body; await submit(st1, z2.id, mixed(b));                   // latest: 5/8 -> counts under "latest"
  });

  it('shows the teacher every student, their counted score, attempt history and the class statistics', async () => {
    const r = (await json('GET', `/api/admin/quizzes/${z1.id}/results`, { cookie: admin })).body;
    const by = Object.fromEntries(r.students.map((s) => [s.code, s]));
    assert.deepEqual([by['QZ-S1'].score, by['QZ-S1'].marks, by['QZ-S1'].pct, by['QZ-S1'].status], [8, 10, 100, 'done']);
    assert.deepEqual([by['QZ-S2'].score, by['QZ-S2'].marks], [5, 6.25]);
    assert.equal(by['QZ-S3'].status, 'not_attempted');
    assert.ok(!r.students.some((s) => s.code === 'QZ-S4'), 'another class is not on this roster');
    assert.deepEqual([r.stats.attempted, r.stats.highest, r.stats.lowest, r.stats.average], [2, 100, 62.5, 81.25]);
    assert.equal(r.quiz.totalMarks, 8);
  });

  it('says which questions were hardest', async () => {
    const r = (await json('GET', `/api/admin/quizzes/${z1.id}/results`, { cookie: admin })).body;
    const prime = r.analytics.find((x) => x.text === 'Which are prime?');
    assert.deepEqual([prime.asked, prime.right, prime.pctRight], [2, 1, 50]);
    assert.equal(r.analytics.find((x) => x.text === 'What is 2 + 2?').pctRight, 100);
  });

  it('adds the quizzes of a subject into internal marks, each scaled to what it is worth ("latest" counts the last attempt)', async () => {
    const m = (await json('GET', `/api/admin/quizzes/internal-marks?courseId=${courseId}&semester=3&subject=${encodeURIComponent('QZ Marks Subject')}`, { cookie: admin })).body;
    assert.deepEqual(m.quizzes.map((x) => [x.title, x.weightage]), [['QZ Marks One', 10], ['QZ Marks Two', 5]]);
    assert.equal(m.totalWeightage, 15);
    const by = Object.fromEntries(m.students.map((s) => [s.code, s]));
    assert.deepEqual([by['QZ-S1'].cells[0].marks, by['QZ-S1'].cells[1].marks, by['QZ-S1'].obtained, by['QZ-S1'].outOf], [10, 3.13, 13.13, 15]);
    assert.deepEqual([by['QZ-S2'].obtained, by['QZ-S2'].outOf, by['QZ-S2'].pct], [6.25, 10, 62.5], 'a quiz still open and not attempted is not in the total yet');
    assert.deepEqual([by['QZ-S3'].obtained, by['QZ-S3'].outOf], [0, 0], 'nobody is absent from a quiz that has not closed');
    assert.ok(by['QZ-S3'].cells.every((c) => c.pending && !c.attempted), 'it is pending, not absent');
    // Once the quiz closes, not attempting it counts: zero out of what it was worth
    await json('POST', `/api/admin/quizzes/${z1.id}/close`, { cookie: admin });
    const after = (await json('GET', `/api/admin/quizzes/internal-marks?courseId=${courseId}&semester=3&subject=${encodeURIComponent('QZ Marks Subject')}`, { cookie: admin })).body;
    const s3 = after.students.find((s) => s.code === 'QZ-S3');
    assert.deepEqual([s3.cells[0].pending, s3.cells[0].attempted, s3.obtained, s3.outOf], [false, false, 0, 10], 'absent from a closed 10-mark quiz');
    assert.deepEqual([s3.cells[1].pending, s3.outOf], [true, 10], 'the quiz still open stays out of the total');
  });

  it('a teacher can only open the internal marks of a subject they teach', async () => {
    const url = `/api/employee/quizzes/internal-marks?courseId=${courseId}&semester=3&subject=`;
    assert.equal((await json('GET', url + encodeURIComponent(SUBJ), { cookie: empA })).status, 200);
    assert.equal((await json('GET', url + encodeURIComponent(SUBJ), { cookie: empB })).status, 403);
    assert.equal((await json('GET', url + encodeURIComponent('QZ Marks Subject'), { cookie: empA })).status, 403, 'not on their timetable');
    assert.equal((await json('GET', `/api/admin/quizzes/internal-marks?semester=3&subject=x`, { cookie: admin })).status, 400);
  });

  it('the student sees their own internal marks by subject, quiz by quiz', async () => {
    const mine = (await json('GET', '/api/student/internal-marks', { cookie: st1 })).body.subjects.find((s) => s.subject === 'QZ Marks Subject');
    assert.deepEqual(mine.quizzes.map((x) => [x.title, x.marks]), [['QZ Marks One', 10], ['QZ Marks Two', 3.13]]);
    assert.deepEqual([mine.obtained, mine.outOf, mine.pct], [13.13, 15, 87.53]);
  });

  it('the Reports hub exports the internal marks', async () => {
    const url = `/api/admin/reports/internal-marks?courseId=${courseId}&semester=3&subject=${encodeURIComponent('QZ Marks Subject')}`;
    const j = (await json('GET', url, { cookie: admin })).body;
    assert.ok(j.columns.some((c) => c.header === 'QZ Marks One (/10)') && j.columns.some((c) => c.header === 'Internal marks'));
    assert.equal(j.rows.find((r) => r.code === 'QZ-S1').obtained, 13.13);
    assert.equal(Buffer.from(await (await json('GET', `${url}&format=xlsx`, { cookie: admin })).res.arrayBuffer()).subarray(0, 2).toString(), 'PK');
    assert.equal((await json('GET', `/api/admin/reports/internal-marks?courseId=${courseId}`, { cookie: admin })).status, 400, 'semester and subject are required');
  });
});

/* ================================================================ isolation and gating */
describe('Isolation and module gating', () => {
  it('another institute cannot see or touch these quizzes', async () => {
    const z = await makeQuiz({ title: 'QZ Isolated' });
    assert.equal((await json('GET', `/api/admin/quizzes/${z.id}`, { cookie: schoolAdmin })).status, 404);
    assert.equal((await json('GET', `/api/admin/quizzes/${z.id}/results`, { cookie: schoolAdmin })).status, 404);
    assert.equal((await json('POST', `/api/admin/quizzes/${z.id}/close`, { cookie: schoolAdmin })).status, 404);
    assert.ok(!(await json('GET', '/api/admin/quizzes', { cookie: schoolAdmin })).body.quizzes.some((x) => x.title.startsWith('QZ ')));
    assert.equal((await json('POST', '/api/admin/quizzes', { cookie: schoolAdmin, body: quizBody({ title: 'cross' }) })).status, 400, "another institute's class id is unknown there");
  });

  it('a student cannot attempt or read a quiz on behalf of another student', async () => {
    const z = await makeQuiz({ title: 'QZ Mine Only' });
    await start(st1, z.id);
    assert.equal((await json('GET', `/api/student/quizzes/${z.id}/result`, { cookie: st2 })).status, 404, 'st2 has no attempt and sees nothing of st1\'s');
    assert.equal((await save(st2, z.id, {})).status, 409, 'st2 has no attempt in progress of their own');
    assert.equal((await attemptsIn(z.id, 's2')).length, 0);
  });

  it('is blocked when the institute has the module switched off', async () => {
    const schoolId = (await withTx({ platform: true }, () => q("select id from tenants where code = 'demo-school'"))).rows[0].id;
    const original = (await withTx({ platform: true }, () => q('select modules from tenants where id = $1', [schoolId]))).rows[0].modules;
    try {
      await withTx({ platform: true }, () => q("update tenants set modules = array_remove(modules, 'quizzes') where id = $1", [schoolId]));
      assert.equal((await json('GET', '/api/admin/quizzes', { cookie: schoolAdmin })).status, 403);
    } finally {
      await withTx({ platform: true }, () => q('update tenants set modules = $1 where id = $2', [original, schoolId]));
    }
  });
});

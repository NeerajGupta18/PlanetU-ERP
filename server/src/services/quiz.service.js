/**
 * Quizzes for internal marks.
 *
 * A teacher sets a quiz for a class and subject: questions, a time limit, an open/close window, how many attempts,
 * and its WEIGHTAGE - the internal marks it is worth. A student's quiz score is scaled to that weightage, and the
 * scaled marks of every quiz in a subject add up to the subject's internal marks.
 *
 * Trust model: the server owns the clock and the answers.
 *  - the deadline is fixed when an attempt starts and enforced on every save and submit (with a few seconds' grace
 *    for a request already in flight); an attempt left past its deadline is submitted automatically from what was saved
 *  - correct answers never leave the server while a student can still use them
 *  - only one attempt per student can be open at a time, enforced by a database index
 */
import crypto from 'node:crypto';
import { q } from '../db/pool.js';
import { HttpError } from '../middleware/error.js';
import { audit } from '../db/audit.js';
import { isUuid } from '../db/pool.js';
import { assertCanTeach, formScope, teaches } from './teaching.service.js';
import * as g from './quizGrading.js';

export const GRACE_MS = 5000;
const SHOW = ['after_submit', 'after_close', 'never'];
const err = (status, message, code) => Object.assign(new HttpError(status, message), code ? { code } : {});

/* ================================================================== loading */

const QUIZ_COLS = `z.id, z.title, z.subject, z.course_id as "courseId", c.name as "className", z.semester, z.section, z.instructions,
  z.duration_minutes as "durationMinutes", z.open_at as "openAt", z.close_at as "closeAt", z.max_attempts as "maxAttempts", z.scoring,
  z.weightage::float8 as weightage, z.negative_marks::float8 as "negativeMarks", z.shuffle, z.show_results as "showResults", z.status,
  z.created_by_employee as "ownerId", z.published_at as "publishedAt", emp.name as "createdBy"`;
const QUIZ_FROM = 'from quizzes z join courses c on c.id = z.course_id left join employees emp on emp.id = z.created_by_employee';

const questionsOf = async (quizId) => (await q(
  `select id, position, kind, text, marks::float8 as marks, options, answers, explanation from quiz_questions where quiz_id = $1 order by position, id`, [quizId],
)).rows;

export function windowState(quiz, now = new Date()) {
  if (quiz.status === 'closed' || (quiz.closeAt && now > new Date(quiz.closeAt))) return 'closed';
  if (quiz.openAt && now < new Date(quiz.openAt)) return 'upcoming';
  return 'open';
}

async function quizOrThrow(id) {
  if (!isUuid(id)) throw err(404, 'Quiz not found.');
  const { rows: [z] } = await q(`select ${QUIZ_COLS} ${QUIZ_FROM} where z.id = $1`, [id]);
  if (!z) throw err(404, 'Quiz not found.');
  return z;
}
async function canManage(actor, z) {
  if (actor.role === 'admin') return true;
  return actor.role === 'employee' && ((z.ownerId && z.ownerId === actor.employeeId) || teaches(actor.employeeId, z.courseId, z.subject));
}
async function manageOrThrow(actor, id) {
  const z = await quizOrThrow(id);
  if (!(await canManage(actor, z))) throw err(404, 'Quiz not found.'); // not yours: it does not exist for you
  return z;
}
const attemptCount = async (quizId) => (await q('select count(*)::int as n from quiz_attempts where quiz_id = $1', [quizId])).rows[0].n;

export const scope = (actor) => formScope(actor);

/* ================================================================== teacher: build and run quizzes */

const dateTime = (v, label) => {
  if (v === null || v === undefined || v === '') return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw err(400, `${label} is not a valid date and time.`);
  return d.toISOString();
};
const str = (v, label, max, required = false) => {
  const s = String(v ?? '').trim();
  if (required && !s) throw err(400, `${label} is required.`);
  if (s.length > max) throw err(400, `${label} is too long (${max} characters at most).`);
  return s;
};

function cleanQuiz(b, cur) {
  const m = { ...(cur || {}), ...(b || {}) };
  const duration = Number(m.durationMinutes ?? 30);
  if (!Number.isInteger(duration) || duration < 1 || duration > 300) throw err(400, 'The time limit must be a whole number of minutes, 1 to 300.');
  const attempts = Number(m.maxAttempts ?? 1);
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 10) throw err(400, 'Attempts must be a whole number from 1 to 10.');
  const weightage = Number(m.weightage ?? 10);
  if (!Number.isFinite(weightage) || weightage <= 0 || weightage > 1000) throw err(400, 'Internal marks must be more than 0.');
  const negative = Number(m.negativeMarks ?? 0);
  if (!Number.isFinite(negative) || negative < 0 || negative > 1) throw err(400, 'Negative marking is a fraction from 0 to 1 (for example 0.25 loses a quarter of the marks).');
  const scoring = m.scoring ?? 'best';
  if (!['best', 'latest'].includes(scoring)) throw err(400, 'Scoring must be "best" or "latest".');
  const showResults = m.showResults ?? 'after_submit';
  if (!SHOW.includes(showResults)) throw err(400, `Show results must be one of: ${SHOW.join(', ')}.`);
  const semester = Number(m.semester);
  if (!Number.isInteger(semester) || semester < 1 || semester > 20) throw err(400, 'Semester must be a whole number from 1 to 20.');
  const openAt = dateTime(m.openAt, 'Opening time'); const closeAt = dateTime(m.closeAt, 'Closing time');
  if (openAt && closeAt && new Date(closeAt) <= new Date(openAt)) throw err(400, 'The quiz must close after it opens.');
  return {
    title: str(m.title, 'Title', 150, true), subject: str(m.subject, 'Subject', 80, true), courseId: m.courseId, semester,
    section: str(m.section, 'Section', 20), instructions: str(m.instructions, 'Instructions', 2000), durationMinutes: duration, openAt, closeAt,
    maxAttempts: attempts, scoring, weightage: g.round2(weightage), negativeMarks: g.round2(negative), shuffle: m.shuffle !== false, showResults,
  };
}

function cleanQuestions(list) {
  if (!Array.isArray(list)) throw err(400, 'Questions must be a list.');
  if (list.length > 100) throw err(400, 'A quiz can have at most 100 questions.');
  try { return list.map((x, i) => g.cleanQuestion(x, i + 1)); } catch (e) { throw err(400, e.message); }
}

async function writeQuestions(quizId, questions) {
  await q('delete from quiz_questions where quiz_id = $1', [quizId]);
  for (const [i, x] of questions.entries()) {
    await q(
      'insert into quiz_questions (quiz_id, position, kind, text, marks, options, answers, explanation) values ($1,$2,$3,$4,$5,$6,$7,$8)',
      [quizId, i + 1, x.kind, x.text, x.marks, JSON.stringify(x.options), JSON.stringify(x.answers), x.explanation],
    );
  }
}

export async function listQuizzes(actor) {
  const { rows } = await q(
    `select ${QUIZ_COLS},
            (select count(*)::int from quiz_questions k where k.quiz_id = z.id) as questions,
            (select coalesce(sum(k.marks), 0)::float8 from quiz_questions k where k.quiz_id = z.id) as "totalMarks",
            (select count(distinct a.student_id)::int from quiz_attempts a where a.quiz_id = z.id and a.status = 'submitted') as "submittedBy",
            (select count(*)::int from students s where s.status = 'Active' and s.course_id = z.course_id and s.semester = z.semester and (z.section = '' or s.section = z.section)) as eligible
     ${QUIZ_FROM}
     where ($1 or z.created_by_employee = $2 or exists (select 1 from timetable_slots t where t.employee_id = $2 and t.course_id = z.course_id and lower(trim(t.subject)) = lower(trim(z.subject))))
     order by z.created_at desc`,
    [actor.role === 'admin', actor.employeeId ?? null],
  );
  return rows.map((z) => ({ ...z, window: windowState(z) }));
}

export async function getQuiz(actor, id) {
  const z = await manageOrThrow(actor, id);
  const questions = await questionsOf(id);
  return { ...z, window: windowState(z), questions, totalMarks: g.round2(questions.reduce((a, x) => a + x.marks, 0)), attempts: await attemptCount(id) };
}

export async function saveQuiz(actor, id, body) {
  let cur = null;
  if (id) cur = await manageOrThrow(actor, id);
  const z = cleanQuiz(body, cur);
  if (!isUuid(z.courseId)) throw err(400, 'Choose the class.');
  if (!(await q('select 1 from courses where id = $1', [z.courseId])).rowCount) throw err(400, 'Choose the class.');
  await assertCanTeach(actor, z.courseId, z.subject);
  const questions = body?.questions !== undefined ? cleanQuestions(body.questions) : null;

  if (cur) {
    const n = await attemptCount(id);
    if (n) {
      if (questions) throw err(409, 'Students have already attempted this quiz, so its questions can no longer change.');
      if (z.courseId !== cur.courseId || z.semester !== cur.semester || z.section !== cur.section || z.subject !== cur.subject) {
        throw err(409, 'Students have already attempted this quiz, so its class and subject can no longer change.');
      }
    }
    await q(
      `update quizzes set title=$2, subject=$3, course_id=$4, semester=$5, section=$6, instructions=$7, duration_minutes=$8, open_at=$9, close_at=$10,
              max_attempts=$11, scoring=$12, weightage=$13, negative_marks=$14, shuffle=$15, show_results=$16 where id=$1`,
      [id, z.title, z.subject, z.courseId, z.semester, z.section, z.instructions, z.durationMinutes, z.openAt, z.closeAt, z.maxAttempts, z.scoring, z.weightage, z.negativeMarks, z.shuffle, z.showResults],
    );
    if (questions) await writeQuestions(id, questions);
    await audit(actor, 'quiz.update', 'quiz', id, { title: z.title });
    return getQuiz(actor, id);
  }
  const { rows: [row] } = await q(
    `insert into quizzes (title, subject, course_id, semester, section, instructions, duration_minutes, open_at, close_at, max_attempts, scoring, weightage, negative_marks, shuffle, show_results, created_by, created_by_employee)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) returning id`,
    [z.title, z.subject, z.courseId, z.semester, z.section, z.instructions, z.durationMinutes, z.openAt, z.closeAt, z.maxAttempts, z.scoring, z.weightage, z.negativeMarks, z.shuffle, z.showResults, actor.id, actor.employeeId ?? null],
  );
  if (questions?.length) await writeQuestions(row.id, questions);
  await audit(actor, 'quiz.create', 'quiz', row.id, { title: z.title, subject: z.subject });
  return getQuiz(actor, row.id);
}

export async function publishQuiz(actor, id) {
  const z = await manageOrThrow(actor, id);
  if (z.status === 'published') throw err(409, 'This quiz is already published.');
  const qs = await questionsOf(id);
  if (!qs.length) throw err(400, 'Add at least one question before publishing.');
  if (z.closeAt && new Date(z.closeAt) <= new Date()) throw err(400, 'The closing time has already passed. Change it before publishing.');
  await q("update quizzes set status = 'published', published_at = coalesce(published_at, now()) where id = $1", [id]);
  await audit(actor, 'quiz.publish', 'quiz', id, { title: z.title });
  return getQuiz(actor, id);
}

export async function closeQuiz(actor, id) {
  const z = await manageOrThrow(actor, id);
  if (z.status !== 'published') throw err(409, 'Only a published quiz can be closed.');
  await q("update quizzes set status = 'closed' where id = $1", [id]);
  // Closing ends every attempt still running: each is graded from what the student had saved
  const open = (await q("select id from quiz_attempts where quiz_id = $1 and status = 'in_progress'", [id])).rows;
  const questions = await questionsOf(id);
  for (const a of open) await finalize(a.id, z, questions, { auto: true });
  await audit(actor, 'quiz.close', 'quiz', id, { autoSubmitted: open.length });
  return getQuiz(actor, id);
}

export async function reopenQuiz(actor, id) {
  const z = await manageOrThrow(actor, id);
  if (z.status !== 'closed') throw err(409, 'Only a closed quiz can be reopened.');
  await q("update quizzes set status = 'published' where id = $1", [id]);
  await audit(actor, 'quiz.reopen', 'quiz', id, {});
  return getQuiz(actor, id);
}

export async function deleteQuiz(actor, id) {
  const z = await manageOrThrow(actor, id);
  if (await attemptCount(id)) throw err(409, 'Students have attempted this quiz, so it cannot be deleted. Close it instead.');
  await q('delete from quizzes where id = $1', [id]);
  await audit(actor, 'quiz.delete', 'quiz', id, { title: z.title });
}

export async function grantExtraAttempt(actor, quizId, studentId) {
  const z = await manageOrThrow(actor, quizId);
  if (!isUuid(studentId)) throw err(400, 'Choose a student.');
  const { rows: [s] } = await q("select id from students where id = $1 and course_id = $2 and semester = $3 and status = 'Active'", [studentId, z.courseId, z.semester]);
  if (!s) throw err(404, 'That student is not in this quiz\'s class.');
  const { rows: [r] } = await q(
    `insert into quiz_extra_attempts (quiz_id, student_id, extra, granted_by) values ($1,$2,1,$3)
     on conflict (quiz_id, student_id) do update set extra = least(quiz_extra_attempts.extra + 1, 10), granted_by = excluded.granted_by returning extra`,
    [quizId, studentId, actor.id],
  );
  await audit(actor, 'quiz.extra_attempt', 'quiz', quizId, { student: studentId, extra: r.extra });
  return { extra: r.extra };
}

/* ================================================================== grading an attempt */

const attemptRow = `id, quiz_id as "quizId", student_id as "studentId", attempt_no as "attemptNo", status, started_at as "startedAt", deadline_at as "deadlineAt",
  submitted_at as "submittedAt", auto_submitted as "autoSubmitted", question_order as "questionOrder", option_orders as "optionOrders", answers,
  score::float8 as score, max_score::float8 as "maxScore"`;

async function finalize(attemptId, quiz, questions, { auto = false, answers = null, replace = false } = {}) {
  const { rows: [a] } = await q(`select ${attemptRow} from quiz_attempts where id = $1 for update`, [attemptId]);
  if (!a || a.status !== 'in_progress') return a;
  // `replace`: the caller already merged (and removed cleared answers); otherwise just add to what was saved
  const final = answers ? (replace ? answers : { ...a.answers, ...answers }) : a.answers;
  const r = g.gradeAttempt(questions, final, quiz.negativeMarks);
  await q(
    `update quiz_attempts set status = 'submitted', submitted_at = now(), auto_submitted = $2, answers = $3, score = $4, max_score = $5 where id = $1`,
    [attemptId, auto, JSON.stringify(final), r.score, r.max],
  );
  return { ...a, status: 'submitted', score: r.score, maxScore: r.max, answers: final };
}

/** Attempts left running past their deadline are submitted from what was saved. */
async function finalizeExpired(quizId, studentId = null) {
  const { rows } = await q(
    `select id from quiz_attempts where quiz_id = $1 and status = 'in_progress' and deadline_at + ($3 || ' milliseconds')::interval < now() and ($2::uuid is null or student_id = $2)`,
    [quizId, studentId, String(GRACE_MS)],
  );
  if (!rows.length) return 0;
  const z = await quizOrThrow(quizId); const questions = await questionsOf(quizId);
  for (const a of rows) await finalize(a.id, z, questions, { auto: true });
  return rows.length;
}

/* ================================================================== results for the teacher */

const rosterOf = (z) => q(
  `select s.id, s.student_code as code, s.roll_no as "rollNo", s.name, s.section from students s
   where (s.status = 'Active' and s.course_id = $1 and s.semester = $2 and ($3 = '' or s.section = $3))
      or exists (select 1 from quiz_attempts a where a.quiz_id = $4 and a.student_id = s.id)
   order by nullif(regexp_replace(s.roll_no, '\\D', '', 'g'), '')::numeric nulls last, s.roll_no, s.name`,
  [z.courseId, z.semester, z.section, z.id],
);

export async function results(actor, id) {
  const z = await manageOrThrow(actor, id);
  await finalizeExpired(id);
  const questions = await questionsOf(id);
  const { rows: students } = await rosterOf(z);
  const { rows: attempts } = await q(`select ${attemptRow} from quiz_attempts where quiz_id = $1 order by attempt_no`, [id]);
  const { rows: extras } = await q('select student_id as "studentId", extra from quiz_extra_attempts where quiz_id = $1', [id]);
  const extraOf = new Map(extras.map((e) => [e.studentId, e.extra]));

  const rows = students.map((s) => {
    const mine = attempts.filter((a) => a.studentId === s.id);
    const counted = g.countedAttempt(mine, z.scoring);
    const running = mine.find((a) => a.status === 'in_progress');
    return {
      ...s, extra: extraOf.get(s.id) || 0, attempts: mine.map((a) => ({ no: a.attemptNo, status: a.status, score: a.score, max: a.maxScore, submittedAt: a.submittedAt, auto: a.autoSubmitted })),
      status: counted ? 'done' : running ? 'in_progress' : 'not_attempted',
      score: counted?.score ?? null, max: counted?.maxScore ?? null, pct: counted && counted.maxScore ? g.round2((counted.score / counted.maxScore) * 100) : null,
      marks: counted ? g.scaledMarks(counted.score, counted.maxScore, z.weightage) : null,
    };
  });
  const done = rows.filter((r) => r.status === 'done');
  const stats = {
    eligible: rows.length, attempted: done.length, notAttempted: rows.filter((r) => r.status === 'not_attempted').length, inProgress: rows.filter((r) => r.status === 'in_progress').length,
    average: done.length ? g.round2(done.reduce((a, r) => a + r.pct, 0) / done.length) : null, highest: done.length ? Math.max(...done.map((r) => r.pct)) : null,
    lowest: done.length ? Math.min(...done.map((r) => r.pct)) : null,
  };

  // Which questions were hardest: how many of the counted attempts got each one fully right
  const analytics = questions.map((x) => {
    let asked = 0; let right = 0; let skipped = 0;
    for (const r of done) {
      const a = g.countedAttempt(attempts.filter((t) => t.studentId === r.id), z.scoring);
      const res = g.gradeQuestion(x, a?.answers?.[x.id], z.negativeMarks);
      asked += 1; if (res.correct === true) right += 1; if (res.correct === null) skipped += 1;
    }
    return { id: x.id, position: x.position, text: x.text, kind: x.kind, marks: x.marks, asked, right, skipped, pctRight: asked ? Math.round((right / asked) * 100) : null };
  });
  return { quiz: { ...z, window: windowState(z), totalMarks: g.round2(questions.reduce((a, x) => a + x.marks, 0)) }, students: rows, stats, analytics };
}

/** Subject internal marks for a class: one column per quiz, scaled to its weightage. */
export async function internalMarks(actor, { courseId, semester, subject }) {
  if (!isUuid(courseId)) throw err(400, 'Choose the class.');
  const sem = Number(semester);
  if (!Number.isInteger(sem) || sem < 1 || sem > 20) throw err(400, 'Choose the semester.');
  const sub = str(subject, 'Subject', 80, true);
  await assertCanTeach(actor, courseId, sub);
  const { rows: quizzes } = await q(
    `select z.id, z.title, z.section, z.scoring, z.weightage::float8 as weightage, z.status, z.close_at as "closeAt" from quizzes z
     where z.course_id = $1 and z.semester = $2 and lower(trim(z.subject)) = lower(trim($3)) and z.status in ('published', 'closed') order by z.created_at`,
    [courseId, sem, sub],
  );
  for (const z of quizzes) await finalizeExpired(z.id);
  const { rows: students } = await q(
    `select s.id, s.student_code as code, s.roll_no as "rollNo", s.name, s.section from students s where s.status = 'Active' and s.course_id = $1 and s.semester = $2
     order by nullif(regexp_replace(s.roll_no, '\\D', '', 'g'), '')::numeric nulls last, s.roll_no, s.name`, [courseId, sem],
  );
  const { rows: attempts } = quizzes.length ? await q(`select ${attemptRow} from quiz_attempts where quiz_id = any($1::uuid[])`, [quizzes.map((z) => z.id)]) : { rows: [] };
  const now = new Date();
  const finished = (z) => z.status === 'closed' || (z.closeAt && new Date(z.closeAt) < now);
  const rows = students.map((s) => {
    const cells = quizzes.map((z) => {
      if (z.section && z.section !== s.section) return { eligible: false, marks: null };
      const mine = attempts.filter((a) => a.quizId === z.id && a.studentId === s.id);
      const c = g.countedAttempt(mine, z.scoring);
      // A quiz that is still open has no absentees yet: until it closes (or the student submits) it is pending, and not in the total
      return { eligible: true, marks: c ? g.scaledMarks(c.score, c.maxScore, z.weightage) : 0, attempted: Boolean(c), pending: !c && !finished(z), counts: Boolean(c) || finished(z) };
    });
    const outOf = g.round2(quizzes.reduce((a, z, i) => a + (cells[i].eligible && cells[i].counts ? z.weightage : 0), 0));
    const obtained = g.round2(cells.reduce((a, c) => a + (c.marks || 0), 0));
    return { ...s, cells, obtained, outOf, pct: outOf ? g.round2((obtained / outOf) * 100) : null };
  });
  return { subject: sub, quizzes: quizzes.map(({ id, title, weightage, scoring, status }) => ({ id, title, weightage, scoring, status })), students: rows, totalWeightage: g.round2(quizzes.reduce((a, z) => a + z.weightage, 0)) };
}

/* ================================================================== the student's side */

async function studentOrThrow(studentId) {
  const { rows: [s] } = await q('select id, course_id as "courseId", semester, section, status from students where id = $1', [studentId]);
  if (!s) throw err(404, 'Student not found.');
  return s;
}

/** A quiz the student may see: published or closed, for their class, semester and section. */
async function eligibleQuiz(student, quizId) {
  const z = await quizOrThrow(quizId);
  const ok = ['published', 'closed'].includes(z.status) && z.courseId === student.courseId && z.semester === student.semester && (!z.section || z.section === student.section);
  if (!ok) throw err(404, 'Quiz not found.');
  return z;
}

const attemptsOf = async (quizId, studentId) => (await q(`select ${attemptRow} from quiz_attempts where quiz_id = $1 and student_id = $2 order by attempt_no`, [quizId, studentId])).rows;
const extraFor = async (quizId, studentId) => (await q('select extra from quiz_extra_attempts where quiz_id = $1 and student_id = $2', [quizId, studentId])).rows[0]?.extra || 0;

/** What a student may see of their own result, depending on how the teacher set the quiz up. */
export function visibility(z, win, attemptsLeft) {
  const score = z.showResults === 'after_submit' || (z.showResults === 'after_close' && win === 'closed');
  const review = (z.showResults === 'after_submit' && (attemptsLeft <= 0 || win === 'closed')) || (z.showResults === 'after_close' && win === 'closed');
  return { score, review };
}

function stateOf(z, win, attempts, allowed) {
  const running = attempts.find((a) => a.status === 'in_progress' && new Date(a.deadlineAt).getTime() + GRACE_MS > Date.now());
  const used = attempts.length;
  if (running) return 'in_progress';
  if (win === 'upcoming') return 'upcoming';
  if (win === 'open' && used < allowed) return used ? 'retry' : 'open';
  return attempts.some((a) => a.status === 'submitted') ? 'done' : 'missed';
}

export async function myQuizzes(studentId) {
  const s = await studentOrThrow(studentId);
  const { rows } = await q(
    `select ${QUIZ_COLS}, (select count(*)::int from quiz_questions k where k.quiz_id = z.id) as questions, (select coalesce(sum(k.marks), 0)::float8 from quiz_questions k where k.quiz_id = z.id) as "totalMarks"
     ${QUIZ_FROM} where z.status in ('published', 'closed') and z.course_id = $1 and z.semester = $2 and (z.section = '' or z.section = $3) order by z.close_at nulls last, z.created_at desc`,
    [s.courseId, s.semester, s.section],
  );
  const out = [];
  for (const z of rows) {
    await finalizeExpired(z.id, studentId);
    const attempts = await attemptsOf(z.id, studentId);
    const allowed = z.maxAttempts + await extraFor(z.id, studentId);
    const win = windowState(z);
    const vis = visibility(z, win, allowed - attempts.length);
    const counted = g.countedAttempt(attempts, z.scoring);
    out.push({
      id: z.id, title: z.title, subject: z.subject, instructions: z.instructions, durationMinutes: z.durationMinutes, openAt: z.openAt, closeAt: z.closeAt, weightage: z.weightage,
      questions: z.questions, totalMarks: z.totalMarks, maxAttempts: allowed, attemptsUsed: attempts.length, window: win, state: stateOf(z, win, attempts, allowed), createdBy: z.createdBy,
      showResults: z.showResults, scoring: z.scoring,
      result: counted ? (vis.score ? { score: counted.score, max: counted.maxScore, marks: g.scaledMarks(counted.score, counted.maxScore, z.weightage) } : { hidden: true }) : null,
    });
  }
  return { quizzes: out };
}

function attemptView(z, attempt, questions) {
  const byId = new Map(questions.map((x) => [x.id, x]));
  const ordered = (attempt.questionOrder.length ? attempt.questionOrder : questions.map((x) => x.id)).map((id) => byId.get(id)).filter(Boolean);
  return {
    quiz: { id: z.id, title: z.title, subject: z.subject, instructions: z.instructions, durationMinutes: z.durationMinutes, negativeMarks: z.negativeMarks, totalMarks: g.round2(questions.reduce((a, x) => a + x.marks, 0)), weightage: z.weightage },
    attempt: { id: attempt.id, no: attempt.attemptNo, deadlineAt: attempt.deadlineAt, startedAt: attempt.startedAt },
    serverNow: new Date().toISOString(),
    answers: attempt.answers,
    // The correct flags are NEVER sent while a quiz is running
    questions: ordered.map((x) => {
      const order = attempt.optionOrders[x.id] || x.options.map((_, i) => i);
      return { id: x.id, kind: x.kind, text: x.text, marks: x.marks, options: x.kind === 'short' ? [] : order.map((i) => ({ i, text: x.options[i].text })) };
    }),
  };
}

export async function startAttempt(studentId, quizId) {
  const s = await studentOrThrow(studentId);
  if (s.status !== 'Active') throw err(403, 'Only active students can attempt a quiz.');
  const z = await eligibleQuiz(s, quizId);
  await finalizeExpired(quizId, studentId);
  const questions = await questionsOf(quizId);
  const attempts = await attemptsOf(quizId, studentId);
  const running = attempts.find((a) => a.status === 'in_progress');
  if (running) return attemptView(z, running, questions);

  const win = windowState(z);
  if (win === 'upcoming') throw err(409, `This quiz opens on ${new Date(z.openAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}.`, 'NOT_OPEN');
  if (win === 'closed') throw err(409, 'This quiz is closed.', 'CLOSED');
  const allowed = z.maxAttempts + await extraFor(quizId, studentId);
  if (attempts.length >= allowed) throw err(409, 'You have used all your attempts.', 'NO_ATTEMPTS');
  if (!questions.length) throw err(409, 'This quiz has no questions yet.');

  const id = crypto.randomUUID();
  const order = z.shuffle ? g.seededShuffle(questions.map((x) => x.id), id) : questions.map((x) => x.id);
  const optionOrders = {};
  for (const x of questions) if (z.shuffle && (x.kind === 'single' || x.kind === 'multiple')) optionOrders[x.id] = g.seededShuffle(x.options.map((_, i) => i), `${id}:${x.id}`);
  const deadline = new Date(Math.min(Date.now() + z.durationMinutes * 60000, z.closeAt ? new Date(z.closeAt).getTime() : Infinity));
  try {
    await q(
      `insert into quiz_attempts (id, quiz_id, student_id, attempt_no, deadline_at, question_order, option_orders)
       values ($1,$2,$3,$4,$5,$6,$7)`,
      [id, quizId, studentId, (attempts[attempts.length - 1]?.attemptNo || 0) + 1, deadline.toISOString(), JSON.stringify(order), JSON.stringify(optionOrders)],
    );
  } catch (e) {
    if (e.code === '23505') { // two requests at once: the second simply resumes the first
      const again = (await attemptsOf(quizId, studentId)).find((a) => a.status === 'in_progress');
      if (again) return attemptView(z, again, questions);
    }
    throw e;
  }
  const fresh = (await attemptsOf(quizId, studentId)).find((a) => a.id === id);
  return attemptView(z, fresh, questions);
}

function cleanAnswers(questions, raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw err(400, 'Send the answers as an object keyed by question.');
  const byId = new Map(questions.map((x) => [x.id, x]));
  const out = {};
  for (const [qid, value] of Object.entries(raw)) {
    const question = byId.get(qid);
    if (!question) throw err(400, 'One of the answers is for a question that is not in this quiz.');
    try { out[qid] = g.cleanAnswer(question, value); } catch (e) { throw err(400, e.message); }
  }
  return out;
}

const running = async (quizId, studentId) => (await attemptsOf(quizId, studentId)).find((a) => a.status === 'in_progress');

export async function saveAnswers(studentId, quizId, raw) {
  const s = await studentOrThrow(studentId); const z = await eligibleQuiz(s, quizId);
  const a = await running(quizId, studentId);
  if (!a) throw err(409, 'You do not have a quiz attempt in progress.', 'NO_ATTEMPT');
  if (Date.now() > new Date(a.deadlineAt).getTime() + GRACE_MS) {
    await finalize(a.id, z, await questionsOf(quizId), { auto: true });
    // Deliberately NOT an error response: an error rolls the request's transaction back, which would undo the very
    // submission this reply is announcing. A normal reply commits it.
    return { saved: false, timeUp: true, submitted: true, message: 'Time is up. Your answers were submitted automatically.' };
  }
  const questions = await questionsOf(quizId);
  const clean = cleanAnswers(questions, raw);
  const merged = { ...a.answers };
  for (const [k, v] of Object.entries(clean)) { if (v === undefined) delete merged[k]; else merged[k] = v; }
  await q('update quiz_attempts set answers = $2 where id = $1', [a.id, JSON.stringify(merged)]);
  return { saved: true, deadlineAt: a.deadlineAt, serverNow: new Date().toISOString() };
}

export async function submitAttempt(studentId, quizId, raw) {
  const s = await studentOrThrow(studentId); const z = await eligibleQuiz(s, quizId);
  const a = await running(quizId, studentId);
  if (!a) {
    // Pressing Submit twice (or a timer and a click at once) is harmless: show the result of the attempt that was submitted
    if ((await attemptsOf(quizId, studentId)).some((t) => t.status === 'submitted')) return myResult(studentId, quizId);
    throw err(409, 'You do not have a quiz attempt in progress.', 'NO_ATTEMPT');
  }
  const questions = await questionsOf(quizId);
  const late = Date.now() > new Date(a.deadlineAt).getTime() + GRACE_MS;
  // Answers that arrive after the deadline are not accepted; the attempt is graded from what was saved in time
  let merged = null;
  if (raw && !late) {
    merged = { ...a.answers };
    for (const [k, v] of Object.entries(cleanAnswers(questions, raw))) { if (v === undefined) delete merged[k]; else merged[k] = v; }
  }
  await finalize(a.id, z, questions, { auto: late || Date.now() > new Date(a.deadlineAt).getTime(), answers: merged, replace: true });
  return myResult(studentId, quizId);
}

export async function myResult(studentId, quizId) {
  const s = await studentOrThrow(studentId); const z = await eligibleQuiz(s, quizId);
  await finalizeExpired(quizId, studentId);
  const attempts = await attemptsOf(quizId, studentId);
  if (!attempts.length) throw err(404, 'You have not attempted this quiz.');
  const allowed = z.maxAttempts + await extraFor(quizId, studentId);
  const win = windowState(z); const left = allowed - attempts.length;
  const vis = visibility(z, win, left);
  const questions = await questionsOf(quizId);
  const counted = g.countedAttempt(attempts, z.scoring);
  const base = {
    quiz: { id: z.id, title: z.title, subject: z.subject, weightage: z.weightage, showResults: z.showResults, maxAttempts: allowed, attemptsLeft: Math.max(0, left), window: win, scoring: z.scoring },
    attempts: attempts.map((a) => ({ no: a.attemptNo, status: a.status, submittedAt: a.submittedAt, auto: a.autoSubmitted, score: vis.score && a.status === 'submitted' ? a.score : null, max: vis.score && a.status === 'submitted' ? a.maxScore : null })),
    visible: vis,
    counted: counted && vis.score ? { no: counted.attemptNo, score: counted.score, max: counted.maxScore, marks: g.scaledMarks(counted.score, counted.maxScore, z.weightage), pct: counted.maxScore ? g.round2((counted.score / counted.maxScore) * 100) : 0 } : null,
    canRetry: win === 'open' && left > 0,
    review: null,
  };
  if (vis.review && counted) {
    const per = g.gradeAttempt(questions, counted.answers, z.negativeMarks).per;
    base.review = questions.map((x) => ({
      id: x.id, kind: x.kind, text: x.text, marks: x.marks, explanation: x.explanation, awarded: per[x.id].awarded, correct: per[x.id].correct,
      options: x.options.map((o, i) => ({ text: o.text, correct: o.correct, chosen: Array.isArray(counted.answers[x.id]) ? counted.answers[x.id].includes(i) : counted.answers[x.id] === i })),
      answer: x.kind === 'short' ? (counted.answers[x.id] ?? null) : null, accepted: x.kind === 'short' ? x.answers : null,
    }));
  }
  return base;
}

/** The student's internal marks by subject: every quiz, its scaled marks, and the total so far. */
export async function myInternalMarks(studentId) {
  const { quizzes } = await myQuizzes(studentId);
  const bySubject = new Map();
  for (const z of quizzes) {
    if (!bySubject.has(z.subject)) bySubject.set(z.subject, []);
    bySubject.get(z.subject).push(z);
  }
  const subjects = [...bySubject.entries()].map(([subject, list]) => {
    const rows = list.map((z) => {
      const counts = z.result && !z.result.hidden; // a hidden score is not revealed through the total either
      const finished = z.window === 'closed' || z.state === 'done';
      return { id: z.id, title: z.title, weightage: z.weightage, state: z.state, marks: counts ? z.result.marks : null, score: counts ? z.result.score : null, max: counts ? z.result.max : null, hidden: Boolean(z.result?.hidden), counted: Boolean(counts || (finished && !z.result)) };
    });
    const outOf = g.round2(rows.filter((r) => r.counted).reduce((a, r) => a + r.weightage, 0));
    const obtained = g.round2(rows.reduce((a, r) => a + (r.marks || 0), 0));
    return { subject, quizzes: rows, obtained, outOf, pct: outOf ? g.round2((obtained / outOf) * 100) : null };
  }).sort((a, b) => a.subject.localeCompare(b.subject));
  return { subjects };
}

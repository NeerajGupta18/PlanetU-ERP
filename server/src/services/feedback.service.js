/**
 * Feedback. The office builds a form of rating (1 to 5) and comment questions for students or staff, optionally about
 * one faculty member or limited to one course, opens it, and reads the combined results.
 * Answers are anonymous: the people who have answered are remembered only so nobody answers twice; the answers
 * themselves carry no link to a person.
 */
import crypto from 'node:crypto';
import { isUuid, q } from '../db/pool.js';
import { audit } from '../db/audit.js';
import { HttpError } from '../middleware/error.js';
import { isISO, toISO } from '../utils/dates.js';

const MAX_QUESTIONS = 30;

const str = (v, max, label, required = false) => {
  const s = typeof v === 'string' ? v.trim() : '';
  if (required && !s) throw new HttpError(400, `${label} is required.`);
  if (s.length > max) throw new HttpError(400, `${label} is too long (${max} characters at most).`);
  return s;
};

function cleanForm(b = {}) {
  const audience = b.audience ?? 'students';
  if (!['students', 'employees'].includes(audience)) throw new HttpError(400, 'Choose who answers: students or staff.');
  const status = b.status ?? 'draft';
  if (!['draft', 'open', 'closed'].includes(status)) throw new HttpError(400, 'Status must be draft, open or closed.');
  const closesOn = b.closesOn || null;
  if (closesOn && !isISO(closesOn)) throw new HttpError(400, 'Enter a valid closing date.');
  const courseId = b.courseId || null;
  if (courseId && (!isUuid(courseId) || audience !== 'students')) throw new HttpError(400, 'Only a form for students can be limited to one course.');
  const aboutEmployeeId = b.aboutEmployeeId || null;
  if (aboutEmployeeId && !isUuid(aboutEmployeeId)) throw new HttpError(400, 'Choose a valid faculty member.');
  return { title: str(b.title, 150, 'Title', true), description: str(b.description, 1000, 'Description'), audience, status, closesOn, courseId, aboutEmployeeId };
}

function cleanQuestions(list) {
  if (!Array.isArray(list) || list.length === 0) throw new HttpError(400, 'Add at least one question.');
  if (list.length > MAX_QUESTIONS) throw new HttpError(400, `A form can have ${MAX_QUESTIONS} questions at most.`);
  return list.map((x, i) => {
    if (!['rating', 'text'].includes(x?.kind)) throw new HttpError(400, `Question ${i + 1}: choose rating or comment.`);
    return { text: str(x.text, 300, `Question ${i + 1}`, true), kind: x.kind, required: x.required !== false };
  });
}

async function checkRefs(f) {
  if (f.courseId && !(await q('select 1 from courses where id = $1', [f.courseId])).rowCount) throw new HttpError(400, 'Choose a valid course.');
  if (f.aboutEmployeeId && !(await q('select 1 from employees where id = $1', [f.aboutEmployeeId])).rowCount) throw new HttpError(400, 'Choose a valid faculty member.');
}

const FORM_SELECT = `
  select f.id, f.title, f.description, f.audience, f.status, f.closes_on::text as "closesOn", f.course_id as "courseId", c.name as course,
         f.about_employee_id as "aboutEmployeeId", e.name as "aboutName", f.created_at as "createdAt",
         (select count(*) from feedback_questions x where x.form_id = f.id)::int as "questionCount",
         (select count(*) from feedback_submissions s where s.form_id = f.id)::int as responses,
         (f.status = 'open' and (f.closes_on is null or f.closes_on >= current_date)) as accepting
  from feedback_forms f
  left join courses c on c.id = f.course_id
  left join employees e on e.id = f.about_employee_id`;

const questionsOf = async (id) => (await q(
  'select id, position, text, kind, required from feedback_questions where form_id = $1 order by position', [id],
)).rows;

async function writeQuestions(formId, questions) {
  await q('delete from feedback_questions where form_id = $1', [formId]);
  for (const [i, x] of questions.entries()) {
    await q('insert into feedback_questions (form_id, position, text, kind, required) values ($1, $2, $3, $4, $5)', [formId, i + 1, x.text, x.kind, x.required]);
  }
}

/* ---------------- the office ---------------- */

export async function listForms() {
  const { rows } = await q(`${FORM_SELECT} order by (f.status = 'open') desc, f.created_at desc limit 200`);
  return { forms: rows };
}

export async function getForm(id) {
  const { rows: [f] } = await q(`${FORM_SELECT} where f.id = $1`, [id]);
  if (!f) throw new HttpError(404, 'Form not found.');
  return { form: f, questions: await questionsOf(id) };
}

export async function createForm(body, admin) {
  const f = cleanForm(body);
  const questions = cleanQuestions(body.questions);
  await checkRefs(f);
  const { rows: [r] } = await q(
    `insert into feedback_forms (title, description, audience, course_id, about_employee_id, status, closes_on, created_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
    [f.title, f.description, f.audience, f.courseId, f.aboutEmployeeId, f.status, f.closesOn, admin.id],
  );
  await writeQuestions(r.id, questions);
  await audit(admin, 'feedback.create', 'feedback', r.id, { title: f.title });
  return getForm(r.id);
}

export async function updateForm(id, body, admin) {
  const { rows: [old] } = await q('select id, (select count(*) from feedback_submissions s where s.form_id = f.id)::int as n from feedback_forms f where f.id = $1 for update', [id]);
  if (!old) throw new HttpError(404, 'Form not found.');
  const f = cleanForm(body);
  await checkRefs(f);
  if (body.questions !== undefined) {
    if (old.n > 0) throw new HttpError(409, 'People have already answered, so the questions can no longer change. Create a new form instead.');
    await writeQuestions(id, cleanQuestions(body.questions));
  }
  const { rows: [{ n: qn }] } = await q('select count(*)::int as n from feedback_questions where form_id = $1', [id]);
  if (f.status === 'open' && qn === 0) throw new HttpError(400, 'Add at least one question before opening the form.');
  await q(
    `update feedback_forms set title = $2, description = $3, audience = $4, course_id = $5, about_employee_id = $6, status = $7, closes_on = $8 where id = $1`,
    [id, f.title, f.description, f.audience, f.courseId, f.aboutEmployeeId, f.status, f.closesOn],
  );
  await audit(admin, 'feedback.update', 'feedback', id, { status: f.status });
  return getForm(id);
}

export async function setStatus(id, status, admin) {
  if (!['draft', 'open', 'closed'].includes(status)) throw new HttpError(400, 'Status must be draft, open or closed.');
  const { rows: [f] } = await q('select id from feedback_forms where id = $1 for update', [id]);
  if (!f) throw new HttpError(404, 'Form not found.');
  const { rows: [{ n }] } = await q('select count(*)::int as n from feedback_questions where form_id = $1', [id]);
  if (status === 'open' && n === 0) throw new HttpError(400, 'Add at least one question before opening the form.');
  await q('update feedback_forms set status = $2 where id = $1', [id, status]);
  await audit(admin, 'feedback.status', 'feedback', id, { status });
  return getForm(id);
}

export async function removeForm(id, admin) {
  const { rowCount } = await q('delete from feedback_forms where id = $1', [id]);
  if (!rowCount) throw new HttpError(404, 'Form not found.');
  await audit(admin, 'feedback.delete', 'feedback', id);
}

/** Combined, anonymous results: for each question the average and spread of ratings, or the comments. */
export async function results(id) {
  const { form, questions } = await getForm(id);
  const { rows: answers } = await q('select question_id as qid, rating, comment, answered_on::text as day from feedback_answers where form_id = $1 order by answered_on desc, id', [id]);
  let eligible = null;
  if (form.audience === 'students') {
    eligible = (await q(`select count(*)::int as n from students where status = 'Active' ${form.courseId ? 'and course_id = $1' : ''}`, form.courseId ? [form.courseId] : [])).rows[0].n;
  } else {
    eligible = (await q('select count(*)::int as n from employees')).rows[0].n;
  }
  const out = questions.map((x) => {
    const mine = answers.filter((a) => a.qid === x.id);
    if (x.kind === 'rating') {
      const rated = mine.filter((a) => a.rating !== null);
      const dist = [1, 2, 3, 4, 5].map((n) => rated.filter((a) => a.rating === n).length);
      const avg = rated.length ? Math.round((rated.reduce((s, a) => s + a.rating, 0) / rated.length) * 10) / 10 : null;
      return { ...x, answered: rated.length, average: avg, distribution: dist };
    }
    const comments = mine.filter((a) => a.comment).map((a) => ({ text: a.comment, day: a.day }));
    return { ...x, answered: comments.length, comments };
  });
  return { form, eligible, questions: out };
}

/* ---------------- students and staff ---------------- */

async function viewer(user) {
  if (user.role === 'employee') return { audience: 'employees', courseId: null };
  const { rows: [s] } = await q('select course_id from students where id = $1', [user.studentId]);
  return { audience: 'students', courseId: s?.course_id ?? null };
}

const OPEN_FOR = `${FORM_SELECT}
  where f.status = 'open' and (f.closes_on is null or f.closes_on >= current_date) and f.audience = $1 and (f.course_id is null or f.course_id = $2)`;

export async function listForUser(user) {
  const v = await viewer(user);
  const { rows } = await q(`${OPEN_FOR} order by f.created_at desc`, [v.audience, v.courseId]);
  const { rows: done } = await q('select form_id from feedback_submissions where user_id = $1', [user.id]);
  const doneIds = new Set(done.map((d) => d.form_id));
  return { forms: rows.map(({ responses, ...f }) => ({ ...f, done: doneIds.has(f.id) })) };
}

export async function formForUser(user, id) {
  const v = await viewer(user);
  const { rows: [f] } = await q(`${OPEN_FOR} and f.id = $3`, [v.audience, v.courseId, id]);
  if (!f) throw new HttpError(404, 'This feedback form is not open for you.');
  const { rowCount } = await q('select 1 from feedback_submissions where form_id = $1 and user_id = $2', [id, user.id]);
  const { responses, ...form } = f;
  return { form: { ...form, done: rowCount > 0 }, questions: await questionsOf(id) };
}

/** answers: [{ questionId, rating?, comment? }] */
export async function submit(user, id, body = {}) {
  const { form, questions } = await formForUser(user, id);
  if (form.done) throw new HttpError(409, 'You have already answered this form. Thank you!');
  const given = new Map((Array.isArray(body.answers) ? body.answers : []).map((a) => [a?.questionId, a]));
  const rows = [];
  for (const x of questions) {
    const a = given.get(x.id) || {};
    if (x.kind === 'rating') {
      const rating = a.rating === undefined || a.rating === null || a.rating === '' ? null : Number(a.rating);
      if (rating !== null && (!Number.isInteger(rating) || rating < 1 || rating > 5)) throw new HttpError(400, `"${x.text}": choose a rating from 1 to 5.`);
      if (rating === null && x.required) throw new HttpError(400, `Please answer: ${x.text}`);
      if (rating !== null) rows.push({ qid: x.id, rating, comment: null });
    } else {
      const comment = str(a.comment, 1000, `"${x.text}"`);
      if (!comment && x.required) throw new HttpError(400, `Please answer: ${x.text}`);
      if (comment) rows.push({ qid: x.id, rating: null, comment });
    }
  }
  const responseId = crypto.randomUUID();
  await q('insert into feedback_submissions (form_id, user_id) values ($1, $2)', [id, user.id]);
  for (const r of rows) {
    await q('insert into feedback_answers (form_id, question_id, response_id, rating, comment) values ($1, $2, $3, $4, $5)', [id, r.qid, responseId, r.rating, r.comment]);
  }
  return { success: true };
}

export async function openFormsCount(user) {
  const { forms } = await listForUser(user);
  return forms.filter((f) => !f.done).length;
}

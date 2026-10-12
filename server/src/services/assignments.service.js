/**
 * Assignments. A teacher sets work for a class and subject (optionally one section) with a due date and maximum
 * marks; students send an answer and/or a file; the teacher grades it with feedback or sends it back to be redone.
 * A teacher works with the subjects on their own timetable, an admin with all of them.
 */
import { env } from '../config/env.js';
import { isUuid, q } from '../db/pool.js';
import { audit } from '../db/audit.js';
import { HttpError } from '../middleware/error.js';
import { assertCanTeach, formScope, teaches } from './teaching.service.js';
import { queueEmail, tenantInfo } from './notifications.service.js';

const str = (v, max, label, required = false) => {
  const s = typeof v === 'string' ? v.trim() : '';
  if (required && !s) throw new HttpError(400, `${label} is required.`);
  if (s.length > max) throw new HttpError(400, `${label} is too long (${max} characters at most).`);
  return s;
};
const r1 = (n) => Math.round(Number(n) * 10) / 10;

export const scope = (actor) => formScope(actor);

const COLS = `a.id, a.title, a.subject, a.section, a.description, a.due_at as "dueAt", a.max_marks::float8 as "maxMarks", a.allow_late as "allowLate",
  a.status, a.course_id as "courseId", c.name as "className", a.attachment_file_id as "attachmentFileId", a.created_by_employee as "ownerId",
  emp.name as "createdBy", a.published_at as "publishedAt"`;
const FROM = 'from assignments a join courses c on c.id = a.course_id left join employees emp on emp.id = a.created_by_employee';

async function load(id) {
  if (!isUuid(id)) throw new HttpError(404, 'Assignment not found.');
  const { rows: [a] } = await q(`select ${COLS} ${FROM} where a.id = $1`, [id]);
  if (!a) throw new HttpError(404, 'Assignment not found.');
  return a;
}
async function canManage(actor, a) {
  if (actor.role === 'admin') return true;
  return actor.role === 'employee' && ((a.ownerId && a.ownerId === actor.employeeId) || (await teaches(actor.employeeId, a.courseId, a.subject)));
}
async function manage(actor, id) {
  const a = await load(id);
  if (!(await canManage(actor, a))) throw new HttpError(404, 'Assignment not found.'); // not yours: it does not exist for you
  return a;
}

/* ================================================================== teacher / office */

export async function list(actor, { courseId, status } = {}) {
  const { rows } = await q(
    `select ${COLS},
       (select count(*) from students s where s.course_id = a.course_id and s.status = 'Active' and (a.section = '' or s.section = a.section))::int as roster,
       (select count(*) from assignment_submissions x where x.assignment_id = a.id)::int as submitted,
       (select count(*) from assignment_submissions x where x.assignment_id = a.id and x.status = 'submitted')::int as "toGrade"
     ${FROM}
     where ($1::uuid is null or a.course_id = $1) and ($2::text is null or a.status = $2)
       and ($3::uuid is null or a.created_by_employee = $3 or exists (
             select 1 from timetable_slots t where t.employee_id = $3 and t.course_id = a.course_id and lower(trim(t.subject)) = lower(trim(a.subject))))
     order by a.due_at desc limit 300`,
    [courseId || null, status || null, actor.role === 'admin' ? null : actor.employeeId],
  );
  return rows;
}

function clean(b = {}) {
  const dueAt = new Date(b.dueAt);
  if (!b.dueAt || Number.isNaN(dueAt.getTime())) throw new HttpError(400, 'Choose a valid due date and time.');
  const max = Number(b.maxMarks ?? 10);
  if (!Number.isFinite(max) || max <= 0 || max > 1000) throw new HttpError(400, 'Maximum marks must be more than 0 and at most 1000.');
  return {
    title: str(b.title, 150, 'Title', true), description: str(b.description, 5000, 'Instructions'), subject: str(b.subject, 100, 'Subject', true),
    section: str(b.section, 20, 'Section'), dueAt: dueAt.toISOString(), maxMarks: r1(max), allowLate: b.allowLate !== false,
  };
}

async function checkFile(fileId) {
  if (!fileId) return null;
  if (!isUuid(fileId) || !(await q('select 1 from files where id = $1', [fileId])).rowCount) throw new HttpError(400, 'The attached file was not found. Upload it again.');
  return fileId;
}

export async function create(actor, body = {}) {
  if (!isUuid(body.courseId)) throw new HttpError(400, 'Choose a class.');
  const a = clean(body);
  if (!(await q('select 1 from courses where id = $1', [body.courseId])).rowCount) throw new HttpError(400, 'Choose a valid class.');
  await assertCanTeach(actor, body.courseId, a.subject);
  const file = await checkFile(body.attachmentFileId);
  const publish = body.publish === true;
  const { rows: [r] } = await q(
    `insert into assignments (course_id, subject, section, title, description, due_at, max_marks, allow_late, status, attachment_file_id,
                              created_by_employee, created_by, published_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, case when $9 = 'published' then now() end) returning id`,
    [body.courseId, a.subject, a.section, a.title, a.description, a.dueAt, a.maxMarks, a.allowLate, publish ? 'published' : 'draft', file,
      actor.employeeId || null, actor.id],
  );
  await audit(actor, 'assignment.create', 'assignment', r.id, { title: a.title });
  return load(r.id);
}

export async function update(actor, id, body = {}) {
  const cur = await manage(actor, id);
  const a = clean({ ...cur, ...body, subject: cur.subject, dueAt: body.dueAt ?? cur.dueAt });
  const subs = (await q('select count(*)::int as n from assignment_submissions where assignment_id = $1', [id])).rows[0].n;
  if (a.section !== cur.section && subs) throw new HttpError(409, 'Students have already submitted, so the section cannot change.');
  const file = body.attachmentFileId === undefined ? cur.attachmentFileId : await checkFile(body.attachmentFileId);
  await q(
    `update assignments set title = $2, description = $3, section = $4, due_at = $5, max_marks = $6, allow_late = $7, attachment_file_id = $8 where id = $1`,
    [id, a.title, a.description, a.section, a.dueAt, a.maxMarks, a.allowLate, file],
  );
  if (a.maxMarks < cur.maxMarks && (await q('select 1 from assignment_submissions where assignment_id = $1 and marks > $2', [id, a.maxMarks])).rowCount) {
    throw new HttpError(409, 'Some students already have more marks than that. Change their marks first.');
  }
  await audit(actor, 'assignment.update', 'assignment', id);
  return load(id);
}

async function setStatus(actor, id, to, from) {
  const a = await manage(actor, id);
  if (!from.includes(a.status)) throw new HttpError(409, `This assignment is ${a.status}.`);
  await q("update assignments set status = $2, published_at = case when $2 = 'published' then coalesce(published_at, now()) else published_at end where id = $1", [id, to]);
  await audit(actor, `assignment.${to}`, 'assignment', id);
  return load(id);
}
export const publish = (actor, id) => setStatus(actor, id, 'published', ['draft']);
export const close = (actor, id) => setStatus(actor, id, 'closed', ['published']);
export const reopen = (actor, id) => setStatus(actor, id, 'published', ['closed']);

export async function remove(actor, id) {
  await manage(actor, id);
  if ((await q('select 1 from assignment_submissions where assignment_id = $1', [id])).rowCount) throw new HttpError(409, 'Students have submitted work. Close the assignment instead of deleting it.');
  await q('delete from assignments where id = $1', [id]);
  await audit(actor, 'assignment.delete', 'assignment', id);
}

/** The assignment with every student of the class: what they sent (if anything) and its state. */
export async function detail(actor, id) {
  const a = await manage(actor, id);
  const { rows: students } = await q(
    `select s.id as "studentId", s.student_code as "studentCode", s.roll_no as "rollNo", s.name, s.section,
            x.id as "submissionId", x.status, x.answer, x.file_id as "fileId", x.late, x.marks::float8 as marks, x.feedback, x.submitted_at as "submittedAt"
     from students s
     left join assignment_submissions x on x.student_id = s.id and x.assignment_id = $1
     where s.course_id = $2 and (s.status = 'Active' or x.id is not null) and ($3 = '' or s.section = $3)
     order by nullif(regexp_replace(s.roll_no, '\\D', '', 'g'), '')::numeric nulls last, s.roll_no, s.name`,
    [id, a.courseId, a.section],
  );
  return { assignment: a, students: students.map((s) => ({ ...s, status: s.status || 'pending' })) };
}

export async function grade(actor, id, studentId, body = {}) {
  const a = await manage(actor, id);
  const { rows: [sub] } = await q(
    `select x.id, x.status, st.name, st.email from assignment_submissions x join students st on st.id = x.student_id
     where x.assignment_id = $1 and x.student_id = $2 for update of x`, [id, studentId],
  );
  if (!sub) throw new HttpError(404, 'This student has not submitted anything.');
  const feedback = str(body.feedback, 2000, 'Feedback');
  const action = body.action === 'return' ? 'return' : 'grade';
  let marks = null;
  if (action === 'grade') {
    marks = Number(body.marks);
    if (body.marks === '' || body.marks == null || !Number.isFinite(marks) || marks < 0 || marks > a.maxMarks) throw new HttpError(400, `Marks must be from 0 to ${a.maxMarks}.`);
    marks = r1(marks);
  } else if (!feedback) throw new HttpError(400, 'Tell the student what to change before sending it back.');
  await q(
    `update assignment_submissions set status = $2, marks = $3, feedback = $4, graded_by = $5, graded_at = now() where id = $1`,
    [sub.id, action === 'grade' ? 'graded' : 'returned', marks, feedback, actor.id],
  );
  if (sub.email) {
    const info = await tenantInfo();
    await queueEmail(sub.email, 'assignmentGraded', {
      institute: info.name, name: sub.name, title: a.title, returned: action === 'return', marks, maxMarks: a.maxMarks, feedback, url: `${env.APP_URL}/login`,
    });
  }
  await audit(actor, `assignment.${action}`, 'assignment', id, { student: studentId });
  return (await detail(actor, id)).students.find((s) => s.studentId === studentId);
}

/* ================================================================== student */

async function studentRow(studentId) {
  const { rows: [s] } = await q('select id, course_id, section from students where id = $1', [studentId]);
  if (!s) throw new HttpError(404, 'Student not found.');
  return s;
}

const stateOf = (a, sub, now = new Date()) => {
  if (sub) return sub.status; // submitted | graded | returned
  if (a.status === 'closed') return 'missed';
  return new Date(a.dueAt) < now ? 'overdue' : 'pending';
};

const MINE_SELECT = `
  select ${COLS}, x.id as "submissionId", x.status as "submissionStatus", x.marks::float8 as marks, x.feedback, x.answer, x.file_id as "fileId",
         x.late, x.submitted_at as "submittedAt"
  ${FROM}
  left join assignment_submissions x on x.assignment_id = a.id and x.student_id = $1`;

export async function listMine(studentId) {
  const s = await studentRow(studentId);
  const { rows } = await q(
    `${MINE_SELECT} where a.course_id = $2 and a.status in ('published', 'closed') and (a.section = '' or a.section = $3) order by a.due_at desc limit 200`,
    [studentId, s.course_id, s.section],
  );
  return { assignments: rows.map((a) => ({ ...a, state: stateOf(a, a.submissionStatus && { status: a.submissionStatus }) })) };
}

export async function getMine(studentId, id) {
  const s = await studentRow(studentId);
  if (!isUuid(id)) throw new HttpError(404, 'Assignment not found.');
  const { rows: [a] } = await q(
    `${MINE_SELECT} where a.id = $2 and a.course_id = $3 and a.status in ('published', 'closed') and (a.section = '' or a.section = $4)`,
    [studentId, id, s.course_id, s.section],
  );
  if (!a) throw new HttpError(404, 'Assignment not found.');
  return { assignment: { ...a, state: stateOf(a, a.submissionStatus && { status: a.submissionStatus }) } };
}

export async function submit(actor, id, body = {}) {
  const { assignment: a } = await getMine(actor.studentId, id);
  if (a.status === 'closed') throw new HttpError(409, 'This assignment is closed.');
  if (a.submissionStatus === 'graded') throw new HttpError(409, 'This has been graded, so it cannot be changed.');
  const late = new Date(a.dueAt) < new Date();
  if (late && !a.allowLate) throw new HttpError(409, 'The due date has passed and late work is not accepted.');
  const answer = str(body.answer, 10000, 'Answer');
  let fileId = null;
  if (body.fileId) {
    if (!isUuid(body.fileId)) throw new HttpError(400, 'The attached file was not found. Upload it again.');
    const { rowCount } = await q('select 1 from files where id = $1 and created_by = $2', [body.fileId, actor.id]);
    if (!rowCount) throw new HttpError(400, 'The attached file was not found. Upload it again.');
    fileId = body.fileId;
  }
  if (!answer && !fileId) throw new HttpError(400, 'Write an answer or attach a file.');
  await q(
    `insert into assignment_submissions (assignment_id, student_id, answer, file_id, late) values ($1, $2, $3, $4, $5)
     on conflict (tenant_id, assignment_id, student_id) do update
       set answer = excluded.answer, file_id = coalesce(excluded.file_id, assignment_submissions.file_id), late = excluded.late,
           status = 'submitted', submitted_at = now()`,
    [id, actor.studentId, answer, fileId, late],
  );
  await audit(actor, 'assignment.submit', 'assignment', id);
  return getMine(actor.studentId, id);
}

/** Open work still waiting for the student, for the dashboard. */
export async function pendingCount(studentId) {
  const s = await studentRow(studentId);
  const { rows: [r] } = await q(
    `select count(*)::int as n from assignments a
     where a.course_id = $2 and a.status = 'published' and (a.section = '' or a.section = $3) and a.due_at > now()
       and not exists (select 1 from assignment_submissions x where x.assignment_id = a.id and x.student_id = $1)`,
    [studentId, s.course_id, s.section],
  );
  return r.n;
}

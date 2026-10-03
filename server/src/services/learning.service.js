/**
 * Learning platform: MOOC / online courses that students must complete for credits.
 *
 *   Catalogue   courses (external MOOC with a link, or in-house with lessons) kept by admins and faculty
 *   Assignment  a course given to a class (programme + semester [+ section]) for a SUBJECT, for N credits, due on a
 *               date, compulsory or optional. A teacher can only assign for subjects on their own timetable.
 *   Enrollment  one row per student. It finishes one of two ways:
 *                 in-house course ('lessons')   completing every lesson finishes it and awards the credits at once
 *                 external MOOC   ('evidence')  the student submits the certificate; the teacher approves or sends it back
 *   Credits     awarded only on completion; "required" is the total of the compulsory assignments
 */
import { q } from '../db/pool.js';
import { HttpError } from '../middleware/error.js';
import { audit } from '../db/audit.js';
import { isISO, toISO } from '../utils/dates.js';
import { assertCanTeach, formScope, sameSubject, teaches, teachingScope } from './teaching.service.js';

export const PROVIDERS = ['NPTEL', 'SWAYAM', 'Coursera', 'edX', 'Udemy', 'Internal', 'Other'];
export const LEVELS = ['beginner', 'intermediate', 'advanced'];
const LESSON_KINDS = ['video', 'reading', 'link'];
const today = () => toISO(new Date());
const r1 = (n) => Math.round(Number(n) * 10) / 10;

const url = (v, label, { required = false } = {}) => {
  const s = String(v ?? '').trim();
  if (!s) { if (required) throw new HttpError(400, `${label} is required.`); return ''; }
  if (s.length > 500 || !/^https?:\/\/[^\s]+$/i.test(s)) throw new HttpError(400, `${label} must be a web address starting with http:// or https://.`);
  return s;
};
const text = (v, label, max, { required = false } = {}) => {
  const s = String(v ?? '').trim();
  if (required && !s) throw new HttpError(400, `${label} is required.`);
  if (s.length > max) throw new HttpError(400, `${label} is too long (${max} characters at most).`);
  return s;
};
const credits = (v, label = 'Credits') => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 20 || Math.abs(n * 2 - Math.round(n * 2)) > 1e-9) throw new HttpError(400, `${label} must be from 0 to 20, in steps of 0.5.`);
  return n;
};

/* ============================================================== catalogue */

const COURSE_COLS = `c.id, c.title, c.description, c.provider, c.url, c.subject, c.credits::float8 as credits, c.duration_hours::float8 as "durationHours",
  c.level, c.completion, c.status, c.created_by_employee as "ownerId", c.created_at as "createdAt"`;

const canEditCourse = (actor, c) => actor.role === 'admin' || (actor.role === 'employee' && c.ownerId && c.ownerId === actor.employeeId);

export async function listCourses(actor, { status } = {}) {
  const { rows } = await q(
    `select ${COURSE_COLS}, emp.name as "ownerName",
            (select count(*)::int from learning_lessons l where l.course_id = c.id) as lessons,
            (select count(*)::int from learning_assignments a where a.learning_course_id = c.id) as assignments
     from learning_courses c left join employees emp on emp.id = c.created_by_employee
     where ($1::text is null or c.status = $1)
       and ($2 or c.status <> 'draft' or c.created_by_employee = $3)
     order by c.status = 'published' desc, c.title`,
    [status || null, actor.role === 'admin', actor.employeeId ?? null],
  );
  return rows.map((c) => ({ ...c, canEdit: canEditCourse(actor, c) }));
}

async function lessonsOf(courseId) {
  return (await q(
    `select id, position, title, kind, url, body, duration_min as "durationMin" from learning_lessons where course_id = $1 order by position, id`, [courseId],
  )).rows;
}

export async function getCourse(actor, id) {
  const { rows: [c] } = await q(`select ${COURSE_COLS} from learning_courses c where c.id = $1`, [id]);
  if (!c || (c.status === 'draft' && !canEditCourse(actor, c))) throw new HttpError(404, 'Course not found.');
  return { ...c, canEdit: canEditCourse(actor, c), lessons: await lessonsOf(id) };
}

function cleanCourse(b, cur) {
  const merged = { ...(cur || {}), ...(b || {}) };
  const provider = merged.provider ?? 'Internal';
  if (!PROVIDERS.includes(provider)) throw new HttpError(400, `Provider must be one of: ${PROVIDERS.join(', ')}.`);
  const level = merged.level ?? 'beginner';
  if (!LEVELS.includes(level)) throw new HttpError(400, `Level must be one of: ${LEVELS.join(', ')}.`);
  const completion = merged.completion ?? (provider === 'Internal' ? 'lessons' : 'evidence');
  if (!['lessons', 'evidence'].includes(completion)) throw new HttpError(400, 'Completion must be "lessons" or "evidence".');
  const status = merged.status ?? 'draft';
  if (!['draft', 'published', 'archived'].includes(status)) throw new HttpError(400, 'Status must be draft, published or archived.');
  const hours = Number(merged.durationHours ?? 0);
  if (!Number.isFinite(hours) || hours < 0 || hours > 1000) throw new HttpError(400, 'Duration must be from 0 to 1000 hours.');
  return {
    title: text(merged.title, 'Title', 150, { required: true }), description: text(merged.description, 'Description', 2000),
    provider, url: url(merged.url, 'Course link'), subject: text(merged.subject, 'Subject', 80), credits: credits(merged.credits ?? 1),
    durationHours: r1(hours), level, completion, status,
  };
}

function cleanLessons(list) {
  if (!Array.isArray(list)) throw new HttpError(400, 'Lessons must be a list.');
  if (list.length > 100) throw new HttpError(400, 'A course can have at most 100 lessons.');
  return list.map((l, i) => {
    const n = i + 1; const kind = l?.kind ?? 'reading';
    if (!LESSON_KINDS.includes(kind)) throw new HttpError(400, `Lesson ${n}: choose video, reading or link.`);
    const title = text(l?.title, `Lesson ${n} title`, 150, { required: true });
    const link = url(l?.url, `Lesson ${n} link`, { required: kind !== 'reading' });
    const body = text(l?.body, `Lesson ${n} text`, 20000, { required: kind === 'reading' });
    const dur = Number(l?.durationMin ?? 0);
    if (!Number.isInteger(dur) || dur < 0 || dur > 1000) throw new HttpError(400, `Lesson ${n}: minutes must be a whole number from 0 to 1000.`);
    return { id: typeof l?.id === 'string' ? l.id : null, title, kind, url: link, body, durationMin: dur };
  });
}

export async function saveCourse(actor, id, body) {
  let cur = null;
  if (id) {
    const { rows: [c] } = await q(`select ${COURSE_COLS} from learning_courses c where c.id = $1`, [id]);
    if (!c) throw new HttpError(404, 'Course not found.');
    if (!canEditCourse(actor, c)) throw new HttpError(403, 'Only the person who created this course, or an admin, can change it.');
    cur = c;
  }
  const c = cleanCourse(body, cur);
  const lessons = body?.lessons !== undefined ? cleanLessons(body.lessons) : null;

  if (cur) {
    const { rows: [n] } = await q('select count(*)::int as n from learning_assignments where learning_course_id = $1', [id]);
    if (n.n && c.completion !== cur.completion) throw new HttpError(409, 'This course is already assigned to students, so how it is completed cannot change.');
  }
  const finalLessons = lessons ?? (cur ? await lessonsOf(id) : []);
  if (c.status === 'published') {
    if (c.completion === 'lessons' && finalLessons.length === 0) throw new HttpError(400, 'Add at least one lesson before publishing a course completed by lessons.');
    if (c.completion === 'evidence' && !c.url) throw new HttpError(400, 'Add the link to the online course before publishing, so students know where to take it.');
  }
  if (c.completion === 'evidence' && lessons?.length) throw new HttpError(400, 'A course completed by certificate has no lessons: students take it on the provider\'s site.');

  let courseId = id;
  if (id) {
    await q(
      `update learning_courses set title=$2, description=$3, provider=$4, url=$5, subject=$6, credits=$7, duration_hours=$8, level=$9, completion=$10, status=$11, updated_at=now() where id=$1`,
      [id, c.title, c.description, c.provider, c.url, c.subject, c.credits, c.durationHours, c.level, c.completion, c.status],
    );
  } else {
    ({ rows: [{ id: courseId }] } = await q(
      `insert into learning_courses (title, description, provider, url, subject, credits, duration_hours, level, completion, status, created_by, created_by_employee)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id`,
      [c.title, c.description, c.provider, c.url, c.subject, c.credits, c.durationHours, c.level, c.completion, c.status, actor.id, actor.employeeId ?? null],
    ));
  }
  if (lessons) {
    // Keep a lesson's id (and so every student's progress on it) when it is edited; remove only the ones taken out
    const have = new Set((await lessonsOf(courseId)).map((l) => l.id));
    const keep = new Set(lessons.filter((l) => l.id && have.has(l.id)).map((l) => l.id));
    const drop = [...have].filter((x) => !keep.has(x));
    if (drop.length) await q('delete from learning_lessons where id = any($1::uuid[])', [drop]);
    for (const [i, l] of lessons.entries()) {
      if (l.id && have.has(l.id)) {
        await q('update learning_lessons set position=$2, title=$3, kind=$4, url=$5, body=$6, duration_min=$7 where id=$1', [l.id, i + 1, l.title, l.kind, l.url, l.body, l.durationMin]);
      } else {
        await q('insert into learning_lessons (course_id, position, title, kind, url, body, duration_min) values ($1,$2,$3,$4,$5,$6,$7)', [courseId, i + 1, l.title, l.kind, l.url, l.body, l.durationMin]);
      }
    }
  }
  await audit(actor, id ? 'learning.course_update' : 'learning.course_create', 'learning_course', courseId, { title: c.title });
  return getCourse(actor, courseId);
}

export async function deleteCourse(actor, id) {
  const c = await getCourse(actor, id);
  if (!c.canEdit) throw new HttpError(403, 'Only the person who created this course, or an admin, can delete it.');
  const { rows: [n] } = await q('select count(*)::int as n from learning_assignments where learning_course_id = $1', [id]);
  if (n.n) throw new HttpError(409, 'This course has been assigned to students, so it cannot be deleted. Archive it instead.');
  await q('delete from learning_courses where id = $1', [id]);
  await audit(actor, 'learning.course_delete', 'learning_course', id, { title: c.title });
}

/* ============================================================== assignments */

const ASSIGN_COLS = `a.id, a.learning_course_id as "learningCourseId", lc.title as "courseTitle", lc.provider, lc.completion, lc.url as "courseUrl",
  a.target_course_id as "targetCourseId", tc.name as "className", a.target_semester as semester, a.target_section as section, a.subject,
  a.credits::float8 as credits, a.mandatory, a.due_date as "dueDate", a.note, a.created_at as "createdAt", a.created_by_employee as "ownerId", emp.name as "assignedBy"`;
const ASSIGN_FROM = `from learning_assignments a join learning_courses lc on lc.id = a.learning_course_id join courses tc on tc.id = a.target_course_id
  left join employees emp on emp.id = a.created_by_employee`;

async function assignmentOrThrow(id) {
  const { rows: [a] } = await q(`select ${ASSIGN_COLS} ${ASSIGN_FROM} where a.id = $1`, [id]);
  if (!a) throw new HttpError(404, 'Assignment not found.');
  return a;
}

/** Admin: always. Faculty: assignments they created, or for a subject they teach in that class. */
async function canManage(actor, a) {
  if (actor.role === 'admin') return true;
  if (actor.role !== 'employee') return false;
  return (a.ownerId && a.ownerId === actor.employeeId) || teaches(actor.employeeId, a.targetCourseId, a.subject);
}
async function manageOrThrow(actor, id) {
  const a = await assignmentOrThrow(id);
  // Not yours: look nonexistent rather than forbidden
  if (!(await canManage(actor, a))) throw new HttpError(404, 'Assignment not found.');
  return a;
}

async function enrol(assignment) {
  const { rowCount } = await q(
    `insert into learning_enrollments (assignment_id, student_id)
     select $1, s.id from students s
     where s.course_id = $2 and s.semester = $3 and s.status = 'Active' and ($4 = '' or s.section = $4)
     on conflict (assignment_id, student_id) do nothing`,
    [assignment.id, assignment.targetCourseId, assignment.semester, assignment.section],
  );
  return rowCount;
}

export const scope = (actor) => formScope(actor);

export async function createAssignment(actor, b) {
  const body = b || {};
  const { rows: [lc] } = await q('select id, status, credits::float8 as credits, title from learning_courses where id = $1', [body.learningCourseId]);
  if (!lc) throw new HttpError(400, 'Choose a course from the catalogue.');
  if (lc.status !== 'published') throw new HttpError(400, 'Only a published course can be assigned.');
  const { rows: [cls] } = await q('select id from courses where id = $1', [body.courseId]);
  if (!cls) throw new HttpError(400, 'Choose the class.');
  const semester = Number(body.semester);
  if (!Number.isInteger(semester) || semester < 1 || semester > 20) throw new HttpError(400, 'Semester must be a whole number from 1 to 20.');
  const subject = text(body.subject, 'Subject', 80, { required: true });
  await assertCanTeach(actor, body.courseId, subject);
  const section = text(body.section, 'Section', 20);
  const cr = body.credits === undefined || body.credits === '' ? lc.credits : credits(body.credits);
  let dueDate = null;
  if (body.dueDate) {
    if (!isISO(body.dueDate)) throw new HttpError(400, 'Due date must look like YYYY-MM-DD.');
    if (body.dueDate < today()) throw new HttpError(400, 'The due date cannot be in the past.');
    dueDate = body.dueDate;
  }
  let a;
  try {
    ({ rows: [a] } = await q(
      `insert into learning_assignments (learning_course_id, target_course_id, target_semester, target_section, subject, credits, mandatory, due_date, note, created_by, created_by_employee)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id`,
      [lc.id, body.courseId, semester, section, subject, cr, body.mandatory !== false, dueDate, text(body.note, 'Note', 300), actor.id, actor.employeeId ?? null],
    ));
  } catch (err) {
    if (err.code === '23505') throw new HttpError(409, 'This course is already assigned to that class for that subject.');
    throw err;
  }
  const full = await assignmentOrThrow(a.id);
  const enrolled = await enrol(full);
  await audit(actor, 'learning.assign', 'learning_assignment', a.id, { course: lc.title, subject, semester, enrolled, mandatory: full.mandatory });
  return { ...(await getAssignment(actor, a.id)), enrolled };
}

export async function syncAssignment(actor, id) {
  const a = await manageOrThrow(actor, id);
  const added = await enrol(a);
  await audit(actor, 'learning.sync', 'learning_assignment', id, { added });
  return { added, ...(await getAssignment(actor, id)) };
}

export async function updateAssignment(actor, id, b) {
  const a = await manageOrThrow(actor, id);
  const body = b || {};
  let dueDate = a.dueDate; let cr = a.credits;
  if (body.dueDate !== undefined) {
    if (body.dueDate === null || body.dueDate === '') dueDate = null;
    else if (!isISO(body.dueDate)) throw new HttpError(400, 'Due date must look like YYYY-MM-DD.');
    else dueDate = body.dueDate;
  }
  if (body.credits !== undefined) {
    cr = credits(body.credits);
    if (cr !== a.credits) {
      const { rows: [n] } = await q("select count(*)::int as n from learning_enrollments where assignment_id = $1 and status = 'completed'", [id]);
      if (n.n) throw new HttpError(409, 'Some students have already earned these credits, so they can no longer be changed.');
    }
  }
  await q('update learning_assignments set due_date=$2, credits=$3, mandatory=$4, note=$5 where id=$1',
    [id, dueDate, cr, body.mandatory === undefined ? a.mandatory : body.mandatory === true, body.note === undefined ? a.note : text(body.note, 'Note', 300)]);
  await audit(actor, 'learning.assignment_update', 'learning_assignment', id, {});
  return getAssignment(actor, id);
}

export async function deleteAssignment(actor, id) {
  const a = await manageOrThrow(actor, id);
  const { rows: [n] } = await q("select count(*)::int as n from learning_enrollments where assignment_id = $1 and status in ('submitted', 'completed')", [id]);
  if (n.n) throw new HttpError(409, 'Students have already submitted or completed this, so it cannot be withdrawn.');
  await q('delete from learning_assignments where id = $1', [id]);
  await audit(actor, 'learning.assignment_delete', 'learning_assignment', id, { course: a.courseTitle, subject: a.subject });
}

const COUNTS = `count(*)::int as total,
  count(*) filter (where e.status = 'completed')::int as completed, count(*) filter (where e.status = 'submitted')::int as submitted,
  count(*) filter (where e.status = 'in_progress')::int as "inProgress", count(*) filter (where e.status = 'assigned')::int as assigned,
  count(*) filter (where e.status = 'rejected')::int as rejected,
  count(*) filter (where e.status <> 'completed' and a.due_date < current_date)::int as overdue`;

export async function listAssignments(actor) {
  const { rows } = await q(
    `select ${ASSIGN_COLS}, ${COUNTS} ${ASSIGN_FROM} left join learning_enrollments e on e.assignment_id = a.id
     where ($1 or a.created_by_employee = $2 or exists (select 1 from timetable_slots s where s.employee_id = $2 and s.course_id = a.target_course_id and lower(trim(s.subject)) = lower(trim(a.subject))))
     group by a.id, lc.id, tc.id, emp.id order by a.created_at desc`,
    [actor.role === 'admin', actor.employeeId ?? null],
  );
  return rows;
}

function progressOf(done, total) { return total ? Math.round((done / total) * 100) : 0; }

export async function getAssignment(actor, id) {
  const a = await manageOrThrow(actor, id);
  const { rows: [lessons] } = await q('select count(*)::int as n from learning_lessons where course_id = $1', [a.learningCourseId]);
  const { rows } = await q(
    `select e.id, e.status, e.started_at as "startedAt", e.submitted_at as "submittedAt", e.completed_at as "completedAt", e.credits_awarded::float8 as "creditsAwarded",
            e.evidence_url as "evidenceUrl", e.evidence_file_id as "evidenceFileId", e.evidence_note as "evidenceNote", e.certificate_id as "certificateId",
            e.score::float8 as score, e.review_note as "reviewNote", s.id as "studentId", s.student_code as code, s.roll_no as "rollNo", s.name,
            (select count(*)::int from learning_progress p where p.enrollment_id = e.id) as done
     from learning_enrollments e join students s on s.id = e.student_id where e.assignment_id = $1
     order by nullif(regexp_replace(s.roll_no, '\\D', '', 'g'), '')::numeric nulls last, s.roll_no, s.name`, [id],
  );
  const dueOver = a.dueDate && a.dueDate < today();
  const students = rows.map((e) => ({ ...e, lessons: lessons.n, progress: progressOf(e.done, lessons.n), overdue: Boolean(dueOver && e.status !== 'completed') }));
  const tally = (st) => students.filter((s) => s.status === st).length;
  return {
    assignment: a, students,
    counts: { total: students.length, completed: tally('completed'), submitted: tally('submitted'), inProgress: tally('in_progress'), assigned: tally('assigned'), rejected: tally('rejected'), overdue: students.filter((s) => s.overdue).length },
  };
}

/* ============================================================== review */

export async function reviewQueue(actor) {
  const { rows } = await q(
    `select e.id, e.submitted_at as "submittedAt", e.evidence_url as "evidenceUrl", e.evidence_file_id as "evidenceFileId", e.certificate_id as "certificateId",
            e.score::float8 as score, e.evidence_note as "evidenceNote", s.name as student, s.student_code as code, a.id as "assignmentId", lc.title as "courseTitle",
            a.subject, tc.name as "className", a.credits::float8 as credits
     from learning_enrollments e join learning_assignments a on a.id = e.assignment_id join learning_courses lc on lc.id = a.learning_course_id
       join courses tc on tc.id = a.target_course_id join students s on s.id = e.student_id
     where e.status = 'submitted'
       and ($1 or a.created_by_employee = $2 or exists (select 1 from timetable_slots t where t.employee_id = $2 and t.course_id = a.target_course_id and lower(trim(t.subject)) = lower(trim(a.subject))))
     order by e.submitted_at`,
    [actor.role === 'admin', actor.employeeId ?? null],
  );
  return rows;
}

export async function reviewEnrollment(actor, enrollmentId, b) {
  const body = b || {};
  const { rows: [e] } = await q('select e.id, e.status, e.assignment_id, e.student_id from learning_enrollments e where e.id = $1 for update', [enrollmentId]);
  if (!e) throw new HttpError(404, 'Submission not found.');
  const a = await manageOrThrow(actor, e.assignment_id);
  if (e.status !== 'submitted') throw new HttpError(409, 'This is not waiting for review.');
  if (body.decision === 'approve') {
    let award = a.credits;
    if (body.credits !== undefined && body.credits !== '') {
      award = credits(body.credits, 'Credits awarded');
      if (award > a.credits) throw new HttpError(400, `You cannot award more than the ${a.credits} credits this is worth.`);
    }
    await q(
      `update learning_enrollments set status='completed', completed_at=now(), credits_awarded=$2, reviewed_by=$3, reviewed_at=now(), review_note=$4 where id=$1`,
      [enrollmentId, award, actor.id, text(body.note, 'Note', 500)],
    );
  } else if (body.decision === 'reject') {
    const note = text(body.note, 'Reason', 500, { required: true });
    await q(`update learning_enrollments set status='rejected', reviewed_by=$2, reviewed_at=now(), review_note=$3 where id=$1`, [enrollmentId, actor.id, note]);
  } else throw new HttpError(400, 'Decision must be "approve" or "reject".');
  await audit(actor, `learning.${body.decision}`, 'learning_enrollment', enrollmentId, { assignment: a.id, student: e.student_id, credits: body.decision === 'approve' ? body.credits ?? a.credits : 0 });
  return getAssignment(actor, a.id);
}

/* ============================================================== compliance (who still owes credits) */

export async function compliance(actor, { courseId, semester, subject } = {}) {
  const { rows } = await q(
    `select s.id as "studentId", s.student_code as code, s.roll_no as "rollNo", s.name, c.name as class, s.semester,
            coalesce(sum(a.credits) filter (where a.mandatory), 0)::float8 as required,
            coalesce(sum(e.credits_awarded) filter (where a.mandatory and e.status = 'completed'), 0)::float8 as earned,
            coalesce(sum(e.credits_awarded) filter (where not a.mandatory and e.status = 'completed'), 0)::float8 as bonus,
            count(*) filter (where e.status = 'submitted')::int as "pendingReview",
            count(*) filter (where a.mandatory and e.status <> 'completed' and a.due_date < current_date)::int as overdue,
            count(*) filter (where a.mandatory)::int as compulsory,
            count(*) filter (where a.mandatory and e.status = 'completed')::int as "compulsoryDone"
     from students s join learning_enrollments e on e.student_id = s.id join learning_assignments a on a.id = e.assignment_id
       left join courses c on c.id = s.course_id
     where s.status = 'Active'
       and ($1::uuid is null or s.course_id = $1) and ($2::int is null or s.semester = $2) and ($3::text = '' or lower(a.subject) = lower($3))
       and ($4 or a.created_by_employee = $5 or exists (select 1 from timetable_slots t where t.employee_id = $5 and t.course_id = a.target_course_id and lower(trim(t.subject)) = lower(trim(a.subject))))
     group by s.id, c.name order by c.name, nullif(regexp_replace(s.roll_no, '\\D', '', 'g'), '')::numeric nulls last, s.name`,
    [courseId || null, semester ? Number(semester) : null, subject || '', actor.role === 'admin', actor.employeeId ?? null],
  );
  return rows.map((r) => ({
    ...r, pending: r1(Math.max(0, r.required - r.earned)),
    standing: r.required === 0 ? 'none' : r.earned >= r.required ? 'complete' : r.overdue ? 'overdue' : 'on_track',
  }));
}

/* ============================================================== the student's side */

const MINE = `select e.id, e.status, e.started_at as "startedAt", e.submitted_at as "submittedAt", e.completed_at as "completedAt", e.credits_awarded::float8 as "creditsAwarded",
  e.evidence_url as "evidenceUrl", e.evidence_file_id as "evidenceFileId", e.evidence_note as "evidenceNote", e.certificate_id as "certificateId", e.score::float8 as score,
  e.review_note as "reviewNote", a.id as "assignmentId", a.subject, a.credits::float8 as credits, a.mandatory, a.due_date as "dueDate", a.note,
  lc.id as "courseId", lc.title, lc.description, lc.provider, lc.url, lc.completion, lc.level, lc.duration_hours::float8 as "durationHours",
  (select count(*)::int from learning_lessons l where l.course_id = lc.id) as lessons,
  (select count(*)::int from learning_progress p where p.enrollment_id = e.id) as done,
  emp.name as "assignedBy"
  from learning_enrollments e join learning_assignments a on a.id = e.assignment_id join learning_courses lc on lc.id = a.learning_course_id
  left join employees emp on emp.id = a.created_by_employee`;

const decorate = (r) => ({ ...r, progress: r.completion === 'lessons' ? progressOf(r.done, r.lessons) : (r.status === 'completed' ? 100 : r.status === 'submitted' ? 90 : 0), overdue: Boolean(r.dueDate && r.dueDate < today() && r.status !== 'completed') });

export async function myLearning(studentId) {
  const { rows } = await q(`${MINE} where e.student_id = $1 order by (e.status = 'completed'), a.due_date nulls last, lc.title`, [studentId]);
  const items = rows.map(decorate);
  const req = items.filter((i) => i.mandatory);
  const summary = {
    required: r1(req.reduce((a, i) => a + i.credits, 0)), earned: r1(req.filter((i) => i.status === 'completed').reduce((a, i) => a + i.creditsAwarded, 0)),
    bonus: r1(items.filter((i) => !i.mandatory && i.status === 'completed').reduce((a, i) => a + i.creditsAwarded, 0)),
    pendingReview: items.filter((i) => i.status === 'submitted').length, overdue: items.filter((i) => i.overdue && i.mandatory).length,
    completed: items.filter((i) => i.status === 'completed').length, total: items.length,
  };
  return { summary, items };
}

async function mineOrThrow(studentId, id, { lock = false } = {}) {
  const { rows: [e] } = await q(`${MINE} where e.id = $1 and e.student_id = $2 ${lock ? 'for update of e' : ''}`, [id, studentId]);
  if (!e) throw new HttpError(404, 'Course not found.');
  return e;
}

export async function myEnrollment(studentId, id) {
  const e = decorate(await mineOrThrow(studentId, id));
  const lessons = (await q(
    `select l.id, l.position, l.title, l.kind, l.url, l.body, l.duration_min as "durationMin", p.completed_at is not null as done
     from learning_lessons l left join learning_progress p on p.lesson_id = l.id and p.enrollment_id = $1 where l.course_id = $2 order by l.position, l.id`, [id, e.courseId],
  )).rows;
  return { ...e, lessonList: lessons };
}

async function awardIfDone(studentId, id) {
  const e = await mineOrThrow(studentId, id, { lock: true });
  if (e.completion === 'lessons' && e.lessons > 0 && e.done >= e.lessons && e.status !== 'completed') {
    await q("update learning_enrollments set status = 'completed', completed_at = now(), credits_awarded = $2 where id = $1", [id, e.credits]);
  } else if (e.status === 'assigned' && e.done > 0) {
    await q("update learning_enrollments set status = 'in_progress', started_at = coalesce(started_at, now()) where id = $1", [id]);
  }
}

export async function startCourse(studentId, id) {
  const e = await mineOrThrow(studentId, id, { lock: true });
  if (e.status === 'assigned') await q("update learning_enrollments set status = 'in_progress', started_at = now() where id = $1", [id]);
  return myEnrollment(studentId, id);
}

export async function setLesson(studentId, id, lessonId, done) {
  const e = await mineOrThrow(studentId, id, { lock: true });
  if (e.status === 'completed') throw new HttpError(409, 'You have already completed this course.');
  const { rowCount } = await q('select 1 from learning_lessons where id = $1 and course_id = $2', [lessonId, e.courseId]);
  if (!rowCount) throw new HttpError(404, 'Lesson not found.');
  if (done) await q('insert into learning_progress (enrollment_id, lesson_id) values ($1, $2) on conflict do nothing', [id, lessonId]);
  else await q('delete from learning_progress where enrollment_id = $1 and lesson_id = $2', [id, lessonId]);
  await awardIfDone(studentId, id);
  return myEnrollment(studentId, id);
}

export async function submitEvidence(user, id, b) {
  const body = b || {};
  const e = await mineOrThrow(user.studentId, id, { lock: true });
  if (e.completion !== 'evidence') throw new HttpError(409, 'This course is completed by finishing its lessons, not by uploading a certificate.');
  if (!['assigned', 'in_progress', 'rejected'].includes(e.status)) throw new HttpError(409, e.status === 'completed' ? 'You have already completed this course.' : 'Your certificate is already waiting for review.');
  const evidenceUrl = url(body.evidenceUrl, 'Certificate link');
  let fileId = null;
  if (body.fileId) {
    const { rows: [f] } = await q('select id from files where id = $1 and created_by = $2', [body.fileId, user.id]);
    if (!f) throw new HttpError(400, 'That file was not uploaded by you.');
    fileId = f.id;
  }
  if (!evidenceUrl && !fileId) throw new HttpError(400, 'Attach your certificate or paste its verification link.');
  let score = null;
  if (body.score !== undefined && body.score !== '' && body.score !== null) {
    score = Number(body.score);
    if (!Number.isFinite(score) || score < 0 || score > 100) throw new HttpError(400, 'Score must be from 0 to 100.');
  }
  await q(
    `update learning_enrollments set status='submitted', submitted_at=now(), evidence_url=$2, evidence_file_id=$3, evidence_note=$4, certificate_id=$5, score=$6,
            started_at = coalesce(started_at, now()) where id=$1`,
    [id, evidenceUrl, fileId, text(body.note, 'Note', 500), text(body.certificateId, 'Certificate / roll number', 80), score],
  );
  return myEnrollment(user.studentId, id);
}

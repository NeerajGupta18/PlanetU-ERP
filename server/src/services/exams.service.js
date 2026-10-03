/**
 * Exams & Results.
 *
 *   Admin    creates an exam for a course + semester, defines its papers (subject, max/pass marks,
 *            credits, who enters the marks), publishes it once every paper is submitted.
 *   Faculty  enters marks for the papers they are assigned (draft, then submit).
 *   Student  sees published exams only: marks, grade, GPA, and a printable report card.
 *
 * Marks are the only stored fact; percentage, grade and GPA are computed by ./grading.js every time.
 */
import { isUuid, q } from '../db/pool.js';
import { HttpError } from '../middleware/error.js';
import { audit } from '../db/audit.js';
import { isISO } from '../utils/dates.js';
import { csvCell } from '../utils/csv.js';
import {
  DEFAULT_BANDS, cumulativeGpa, normaliseBands, round2, studentOutcome,
} from './grading.js';

export const KINDS = ['unit', 'mid_term', 'term', 'practical', 'other'];

/* ------------------------------------------------------------------ helpers */

const guard = async (fn, { unique, foreign } = {}) => {
  try { return await fn(); } catch (err) {
    if (err.code === '23505' && unique) throw new HttpError(409, unique);
    if (err.code === '23503' && foreign) throw new HttpError(400, foreign);
    throw err;
  }
};

const numberIn = (v, label, { min, max, minExclusive = false }) => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n)) throw new HttpError(400, `${label} must be a number.`);
  if (minExclusive ? n <= min : n < min) throw new HttpError(400, `${label} must be ${minExclusive ? 'more than' : 'at least'} ${min}.`);
  if (n > max) throw new HttpError(400, `${label} cannot be more than ${max}.`);
  return n;
};

const cleanText = (v, label, max) => {
  if (typeof v !== 'string' || !v.trim()) throw new HttpError(400, `${label} is required.`);
  if (v.trim().length > max) throw new HttpError(400, `${label} is too long (${max} characters at most).`);
  return v.trim();
};

const optionalDate = (v, label) => {
  if (v === undefined || v === null || v === '') return null;
  if (!isISO(v)) throw new HttpError(400, `${label} must look like YYYY-MM-DD.`);
  return v;
};

/* ------------------------------------------------------------ grading scale */

export async function getGrading() {
  const { rows: [r] } = await q('select bands from grading_scales');
  return r ? { bands: r.bands, custom: true } : { bands: DEFAULT_BANDS, custom: false };
}

const loadBands = async () => (await getGrading()).bands;

export async function setGrading(input, actor) {
  let bands;
  try { bands = normaliseBands(input?.bands); } catch (err) { throw new HttpError(400, err.message); }
  await q(
    `insert into grading_scales (bands) values ($1)
     on conflict (tenant_id) do update set bands = excluded.bands, updated_at = now()`,
    [JSON.stringify(bands)],
  );
  await audit(actor, 'exam.grading_update', 'grading_scale', null, { bands: bands.length });
  return { bands, custom: true };
}

export async function resetGrading(actor) {
  await q('delete from grading_scales');
  await audit(actor, 'exam.grading_reset', 'grading_scale', null, {});
  return { bands: DEFAULT_BANDS, custom: false };
}

/* ------------------------------------------------------------------- loaders */

const EXAM_SQL = `
  select e.id, e.course_id as "courseId", c.name as course, e.semester, e.name, e.kind,
         e.start_date as "startDate", e.end_date as "endDate", e.status, e.published_at as "publishedAt"
  from exams e join courses c on c.id = e.course_id`;

const PAPER_SQL = `
  select p.id, p.exam_id as "examId", p.subject, p.max_marks::float8 as "maxMarks", p.pass_marks::float8 as "passMarks",
         p.credits::float8 as credits, p.employee_id as "employeeId", emp.name as "employeeName",
         p.marks_status as "marksStatus", p.submitted_at as "submittedAt"
  from exam_papers p left join employees emp on emp.id = p.employee_id`;

const examById = async (id) => (await q(`${EXAM_SQL} where e.id = $1`, [id])).rows[0];
const papersOf = async (examId) => (await q(`${PAPER_SQL} where p.exam_id = $1 order by lower(p.subject)`, [examId])).rows;

async function mustExam(id) {
  const e = await examById(id);
  if (!e) throw new HttpError(404, 'Exam not found.');
  return e;
}

const ROSTER_SQL = `
  select s.id, s.student_code as code, s.roll_no as "rollNo", s.name
  from students s
  where (s.course_id = $1 and s.semester = $2 and s.status = 'Active')
     or exists (select 1 from exam_marks m join exam_papers p on p.id = m.paper_id where p.exam_id = $3 and m.student_id = s.id)
  order by nullif(regexp_replace(s.roll_no, '\\D', '', 'g'), '')::numeric nulls last, s.roll_no, s.name`;

/** The students an exam is for: the course's active students of that semester, plus anyone who already has a mark in it. */
const rosterOf = async (exam) => (await q(ROSTER_SQL, [exam.courseId, exam.semester, exam.id])).rows;

/** Map paperId -> Map(studentId -> { marks, absent }) for one exam. */
async function entriesOf(examId) {
  const { rows } = await q(
    `select m.paper_id as "paperId", m.student_id as "studentId", m.marks::float8 as marks, m.absent
     from exam_marks m join exam_papers p on p.id = m.paper_id where p.exam_id = $1`,
    [examId],
  );
  const byPaper = new Map();
  for (const r of rows) {
    if (!byPaper.has(r.paperId)) byPaper.set(r.paperId, new Map());
    byPaper.get(r.paperId).set(r.studentId, { marks: r.marks, absent: r.absent });
  }
  return byPaper;
}

/** The marks of one student across the papers of one exam: Map(paperId -> entry). */
const entriesForStudent = (byPaper, studentId) => {
  const m = new Map();
  for (const [paperId, students] of byPaper) if (students.has(studentId)) m.set(paperId, students.get(studentId));
  return m;
};

/* ------------------------------------------------------------- exam CRUD */

export async function listExams({ courseId, status } = {}) {
  const params = []; const where = [];
  if (courseId) { params.push(courseId); where.push(`e.course_id = $${params.length}`); }
  if (status) { params.push(status); where.push(`e.status = $${params.length}`); }
  const { rows } = await q(
    `${EXAM_SQL.replace('c.name as course,', `c.name as course,
         (select count(*)::int from exam_papers p where p.exam_id = e.id) as papers,
         (select count(*)::int from exam_papers p where p.exam_id = e.id and p.marks_status = 'submitted') as submitted,
         (select count(*)::int from students s where s.course_id = e.course_id and s.semester = e.semester and s.status = 'Active') as students,`)}
     ${where.length ? `where ${where.join(' and ')}` : ''}
     order by (e.status = 'draft') desc, coalesce(e.start_date, e.created_at::date) desc, e.name`,
    params,
  );
  return rows;
}

function cleanPaper(p) {
  const maxMarks = numberIn(p.maxMarks, 'Maximum marks', { min: 0, max: 9999, minExclusive: true });
  const passMarks = numberIn(p.passMarks, 'Pass marks', { min: 0, max: 9999 });
  if (passMarks > maxMarks) throw new HttpError(400, 'Pass marks cannot be more than the maximum marks.');
  const credits = numberIn(p.credits ?? 1, 'Credits', { min: 0, max: 20, minExclusive: true });
  if (p.employeeId && !isUuid(p.employeeId)) throw new HttpError(400, 'Invalid faculty member.');
  return { subject: cleanText(p.subject, 'Subject', 80), maxMarks, passMarks, credits, employeeId: p.employeeId || null };
}

const insertPaper = (examId, p) => guard(
  () => q(
    `insert into exam_papers (exam_id, subject, max_marks, pass_marks, credits, employee_id)
     values ($1, $2, $3, $4, $5, $6) returning id`,
    [examId, p.subject, p.maxMarks, p.passMarks, p.credits, p.employeeId],
  ),
  { unique: `There is already a paper for "${p.subject}" in this exam.`, foreign: 'Unknown faculty member.' },
);

export async function createExam(body, actor) {
  const b = body || {};
  if (!isUuid(b.courseId)) throw new HttpError(400, 'Choose a course.');
  const semester = numberIn(b.semester ?? 1, 'Semester', { min: 1, max: 20 });
  if (!Number.isInteger(semester)) throw new HttpError(400, 'Semester must be a whole number.');
  const kind = b.kind ?? 'term';
  if (!KINDS.includes(kind)) throw new HttpError(400, `Type must be one of: ${KINDS.join(', ')}.`);
  const startDate = optionalDate(b.startDate, 'Start date');
  const endDate = optionalDate(b.endDate, 'End date');
  if (startDate && endDate && endDate < startDate) throw new HttpError(400, 'The end date cannot be before the start date.');
  const name = cleanText(b.name, 'Exam name', 80);
  if (b.papers !== undefined && !Array.isArray(b.papers)) throw new HttpError(400, 'Papers must be a list.');
  const papers = (b.papers || []).map(cleanPaper);

  if (!(await q('select 1 from courses where id = $1', [b.courseId])).rowCount) throw new HttpError(400, 'Unknown course.');

  const { rows: [exam] } = await guard(
    () => q(
      `insert into exams (course_id, semester, name, kind, start_date, end_date, created_by)
       values ($1, $2, $3, $4, $5, $6, $7) returning id`,
      [b.courseId, semester, name, kind, startDate, endDate, actor.id],
    ),
    { unique: 'An exam with that name already exists for this course and semester.' },
  );

  if (b.fromTimetable === true) {
    // One paper per subject on the course's timetable, defaulting to the teacher of that subject
    const { rows } = await q(
      `select subject, (array_agg(employee_id order by start_time))[1] as "employeeId"
       from timetable_slots where course_id = $1 group by subject order by subject`,
      [b.courseId],
    );
    const have = new Set(papers.map((p) => p.subject.toLowerCase()));
    for (const r of rows) {
      if (!have.has(r.subject.toLowerCase())) papers.push({ subject: r.subject, maxMarks: 100, passMarks: 40, credits: 1, employeeId: r.employeeId });
    }
  }
  for (const p of papers) await insertPaper(exam.id, p);

  await audit(actor, 'exam.create', 'exam', exam.id, { name, papers: papers.length });
  return getExam(exam.id);
}

export async function getExam(id) {
  const exam = await mustExam(id);
  const papers = await papersOf(id);
  const roster = await rosterOf(exam);
  const byPaper = await entriesOf(id);
  return {
    exam,
    roster: roster.length,
    papers: papers.map((p) => ({ ...p, entered: [...(byPaper.get(p.id)?.keys() || [])].length })),
  };
}

export async function updateExam(id, body, actor) {
  const cur = await mustExam(id);
  const b = body || {};
  const name = b.name !== undefined ? cleanText(b.name, 'Exam name', 80) : cur.name;
  const kind = b.kind ?? cur.kind;
  if (!KINDS.includes(kind)) throw new HttpError(400, `Type must be one of: ${KINDS.join(', ')}.`);
  const startDate = b.startDate !== undefined ? optionalDate(b.startDate, 'Start date') : cur.startDate;
  const endDate = b.endDate !== undefined ? optionalDate(b.endDate, 'End date') : cur.endDate;
  if (startDate && endDate && endDate < startDate) throw new HttpError(400, 'The end date cannot be before the start date.');
  await guard(
    () => q('update exams set name = $1, kind = $2, start_date = $3, end_date = $4 where id = $5', [name, kind, startDate, endDate, id]),
    { unique: 'An exam with that name already exists for this course and semester.' },
  );
  await audit(actor, 'exam.update', 'exam', id, {});
  return getExam(id);
}

export async function deleteExam(id, actor) {
  const exam = await mustExam(id);
  if (exam.status === 'published') throw new HttpError(409, 'Unpublish this exam before deleting it.');
  await q('delete from exams where id = $1', [id]);
  await audit(actor, 'exam.delete', 'exam', id, { name: exam.name });
}

/* ---------------------------------------------------------------- papers */

async function draftExamOf(examId) {
  const exam = await mustExam(examId);
  if (exam.status === 'published') throw new HttpError(409, 'This exam is published. Unpublish it to change its papers.');
  return exam;
}

export async function addPaper(examId, body, actor) {
  await draftExamOf(examId);
  const p = cleanPaper(body || {});
  const { rows: [r] } = await insertPaper(examId, p);
  await audit(actor, 'exam.paper_add', 'exam', examId, { subject: p.subject });
  return { paperId: r.id, ...(await getExam(examId)) };
}

export async function updatePaper(examId, paperId, body, actor) {
  await draftExamOf(examId);
  const cur = (await q(`${PAPER_SQL} where p.id = $1 and p.exam_id = $2`, [paperId, examId])).rows[0];
  if (!cur) throw new HttpError(404, 'Paper not found.');
  const p = cleanPaper({ ...cur, ...(body || {}) });
  const { rows: [over] } = await q('select count(*)::int as n from exam_marks where paper_id = $1 and marks > $2', [paperId, p.maxMarks]);
  if (over.n) throw new HttpError(400, `${over.n} entered mark${over.n === 1 ? ' is' : 's are'} higher than ${p.maxMarks}. Correct those marks first.`);
  await guard(
    () => q(
      'update exam_papers set subject = $1, max_marks = $2, pass_marks = $3, credits = $4, employee_id = $5 where id = $6',
      [p.subject, p.maxMarks, p.passMarks, p.credits, p.employeeId, paperId],
    ),
    { unique: `There is already a paper for "${p.subject}" in this exam.`, foreign: 'Unknown faculty member.' },
  );
  await audit(actor, 'exam.paper_update', 'exam', examId, { paperId });
  return getExam(examId);
}

export async function deletePaper(examId, paperId, actor) {
  await draftExamOf(examId);
  const { rowCount } = await q('delete from exam_papers where id = $1 and exam_id = $2', [paperId, examId]);
  if (!rowCount) throw new HttpError(404, 'Paper not found.');
  await audit(actor, 'exam.paper_delete', 'exam', examId, { paperId });
  return getExam(examId);
}

/* --------------------------------------------------------------- publishing */

export async function publishExam(id, actor) {
  const exam = await mustExam(id);
  if (exam.status === 'published') throw new HttpError(409, 'This exam is already published.');
  const papers = await papersOf(id);
  if (!papers.length) throw new HttpError(400, 'Add at least one paper before publishing.');
  const waiting = papers.filter((p) => p.marksStatus !== 'submitted').map((p) => p.subject);
  if (waiting.length) throw new HttpError(400, `Marks are not submitted yet for: ${waiting.join(', ')}.`);
  await q("update exams set status = 'published', published_at = now() where id = $1", [id]);
  await audit(actor, 'exam.publish', 'exam', id, { name: exam.name });
  return getExam(id);
}

export async function unpublishExam(id, actor) {
  const exam = await mustExam(id);
  if (exam.status !== 'published') throw new HttpError(409, 'This exam is not published.');
  await q("update exams set status = 'draft', published_at = null where id = $1", [id]);
  await audit(actor, 'exam.unpublish', 'exam', id, { name: exam.name });
  return getExam(id);
}

/* ---------------------------------------------------------------- mark entry */

async function loadPaper(paperId, { lock = false } = {}) {
  const { rows: [p] } = await q(
    `${PAPER_SQL.replace('p.exam_id as "examId",', `p.exam_id as "examId", e.name as "examName", e.status as "examStatus",
        e.course_id as "courseId", c.name as course, e.semester,`)
      .replace('from exam_papers p', 'from exam_papers p join exams e on e.id = p.exam_id join courses c on c.id = e.course_id')}
     where p.id = $1 ${lock ? 'for update of p' : ''}`,
    [paperId],
  );
  return p;
}

/** Employees only ever see their own papers (anyone else's looks nonexistent). */
function visibleTo(actor, paper) {
  if (!paper) return false;
  return actor.role === 'admin' || (actor.role === 'employee' && paper.employeeId === actor.employeeId);
}

function canEdit(actor, paper) {
  if (actor.role === 'admin') return { ok: true };
  if (paper.examStatus === 'published') return { ok: false, reason: 'These results are published. Ask an admin to make corrections.' };
  return { ok: true };
}

async function sheetOf(paper, actor) {
  const exam = { id: paper.examId, courseId: paper.courseId, semester: paper.semester };
  const roster = await rosterOf(exam);
  const byPaper = await entriesOf(paper.examId);
  const mine = byPaper.get(paper.id) || new Map();
  const perm = canEdit(actor, paper);
  const students = roster.map((s) => ({ ...s, marks: mine.get(s.id)?.marks ?? null, absent: mine.get(s.id)?.absent ?? false, entered: mine.has(s.id) }));
  return {
    paper: {
      id: paper.id, subject: paper.subject, maxMarks: paper.maxMarks, passMarks: paper.passMarks, credits: paper.credits,
      marksStatus: paper.marksStatus, employeeName: paper.employeeName,
    },
    exam: { id: paper.examId, name: paper.examName, status: paper.examStatus, course: paper.course, semester: paper.semester },
    students,
    editable: perm.ok,
    reason: perm.ok ? null : perm.reason,
  };
}

export async function getMarkSheet({ paperId, examId, actor }) {
  const paper = await loadPaper(paperId);
  if (!visibleTo(actor, paper) || (examId && paper.examId !== examId)) throw new HttpError(404, 'Paper not found.');
  return sheetOf(paper, actor);
}

export async function saveMarkSheet({ paperId, examId, entries, submit, actor }) {
  const paper = await loadPaper(paperId, { lock: true });
  if (!visibleTo(actor, paper) || (examId && paper.examId !== examId)) throw new HttpError(404, 'Paper not found.');
  const perm = canEdit(actor, paper);
  if (!perm.ok) throw new HttpError(403, perm.reason);
  if (!Array.isArray(entries)) throw new HttpError(400, 'Send the marks as a list of { studentId, marks } or { studentId, absent: true }.');

  const exam = { id: paper.examId, courseId: paper.courseId, semester: paper.semester };
  const roster = await rosterOf(exam);
  const byId = new Map(roster.map((s) => [s.id, s]));
  const existing = (await entriesOf(paper.examId)).get(paper.id) || new Map();

  const seen = new Set(); const upserts = []; const clears = [];
  for (const e of entries) {
    if (!e || typeof e.studentId !== 'string' || !byId.has(e.studentId)) throw new HttpError(400, 'One or more students are not in this class.');
    if (seen.has(e.studentId)) throw new HttpError(400, 'A student appears more than once.');
    seen.add(e.studentId);
    const who = byId.get(e.studentId).name;
    if (e.absent === true) {
      if (e.marks !== undefined && e.marks !== null && e.marks !== '') throw new HttpError(400, `${who}: an absent student cannot have marks.`);
      upserts.push({ studentId: e.studentId, marks: null, absent: true });
    } else if (e.marks === null || e.marks === undefined || e.marks === '') {
      clears.push(e.studentId);
    } else {
      const m = typeof e.marks === 'string' ? Number(e.marks) : e.marks;
      if (typeof m !== 'number' || !Number.isFinite(m) || m < 0 || m > paper.maxMarks || Math.abs(round2(m) - m) > 1e-9) {
        throw new HttpError(400, `${who}: marks must be between 0 and ${paper.maxMarks}, with at most 2 decimal places.`);
      }
      upserts.push({ studentId: e.studentId, marks: m, absent: false });
    }
  }
  if (clears.length && paper.marksStatus === 'submitted') {
    throw new HttpError(400, 'Submitted marks cannot be cleared. Enter a mark or mark the student absent.');
  }
  if (!entries.length && !submit) throw new HttpError(400, 'Nothing to save yet.');

  if (submit) {
    if (!roster.length) throw new HttpError(400, `There are no students in ${paper.course}, semester ${paper.semester}.`);
    const after = new Set(existing.keys());
    clears.forEach((id) => after.delete(id));
    upserts.forEach((u) => after.add(u.studentId));
    const missing = roster.filter((s) => !after.has(s.id)).length;
    if (missing) throw new HttpError(400, `Enter a mark or Absent for every student before submitting - ${missing} still empty.`);
  }

  if (upserts.length) {
    await q(
      `insert into exam_marks (paper_id, student_id, marks, absent, updated_by)
       select $1, x.student_id, x.marks, x.absent, $5
       from unnest($2::uuid[], $3::numeric[], $4::boolean[]) as x(student_id, marks, absent)
       on conflict (paper_id, student_id) do update
         set marks = excluded.marks, absent = excluded.absent, updated_by = excluded.updated_by, updated_at = now()`,
      [paperId, upserts.map((u) => u.studentId), upserts.map((u) => u.marks), upserts.map((u) => u.absent), actor.id],
    );
  }
  if (clears.length) await q('delete from exam_marks where paper_id = $1 and student_id = any($2::uuid[])', [paperId, clears]);
  if (submit && paper.marksStatus !== 'submitted') {
    await q("update exam_papers set marks_status = 'submitted', submitted_at = now() where id = $1", [paperId]);
  }

  const action = paper.examStatus === 'published' ? 'exam.marks_edit_published'
    : submit && paper.marksStatus !== 'submitted' ? 'exam.marks_submit' : 'exam.marks_save';
  await audit(actor, action, 'exam_paper', paperId, { exam: paper.examName, subject: paper.subject, entries: entries.length, by: actor.role });

  return sheetOf(await loadPaper(paperId), actor);
}

/** Faculty home: every paper they are assigned, open ones first. */
export async function employeePapers(employeeId) {
  const { rows } = await q(
    `${PAPER_SQL.replace('p.exam_id as "examId",', `p.exam_id as "examId", e.name as "examName", e.status as "examStatus", e.kind,
        c.name as course, e.semester,
        (select count(*)::int from exam_marks m where m.paper_id = p.id) as entered,
        (select count(*)::int from students s where s.course_id = e.course_id and s.semester = e.semester and s.status = 'Active') as roster,`)
      .replace('from exam_papers p', 'from exam_papers p join exams e on e.id = p.exam_id join courses c on c.id = e.course_id')}
     where p.employee_id = $1
     order by (e.status = 'draft') desc, coalesce(e.start_date, e.created_at::date) desc, lower(p.subject) limit 200`,
    [employeeId],
  );
  return rows;
}

/* ------------------------------------------------------------------ results */

/** Every student's computed result for one exam (admin view / CSV / report cards). */
export async function examResults(examId) {
  const exam = await mustExam(examId);
  const papers = await papersOf(examId);
  const bands = await loadBands();
  const roster = await rosterOf(exam);
  const byPaper = await entriesOf(examId);

  const students = roster.map((s) => ({ ...s, ...studentOutcome(papers, entriesForStudent(byPaper, s.id), bands) }));
  const done = students.filter((s) => s.complete);
  const stats = {
    students: students.length,
    complete: done.length,
    incomplete: students.length - done.length,
    passed: done.filter((s) => s.result === 'pass').length,
    failed: done.filter((s) => s.result === 'fail').length,
    passRate: done.length ? round2((done.filter((s) => s.result === 'pass').length / done.length) * 100) : null,
    average: done.length ? round2(done.reduce((a, s) => a + s.pct, 0) / done.length) : null,
    highest: done.length ? Math.max(...done.map((s) => s.pct)) : null,
    lowest: done.length ? Math.min(...done.map((s) => s.pct)) : null,
  };
  return { exam, papers, bands, students, stats };
}

export async function resultsCsv(examId) {
  const { papers, students } = await examResults(examId);
  const head = ['Roll no', 'Student ID', 'Name', ...papers.map((p) => `${p.subject} (/${p.maxMarks})`), 'Total', 'Out of', 'Percentage', 'GPA', 'Result'];
  const lines = [head.map(csvCell).join(',')];
  for (const s of students) {
    const cells = s.subjects.map((x) => (x.status === 'pending' ? '' : x.absent ? 'AB' : x.marks));
    lines.push([s.rollNo, s.code, s.name, ...cells, s.total, s.maxTotal, s.pct ?? '', s.gpa ?? '', s.result.toUpperCase()].map(csvCell).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}

/* -------------------------------------------------------------- report cards */

async function studentRow(studentId) {
  const { rows: [s] } = await q(
    `select s.id, s.student_code as code, s.roll_no as "rollNo", s.enrollment_no as "enrollmentNo", s.name, s.dob, s.batch,
            s.section, c.name as course, c.full_name as "courseFullName"
     from students s left join courses c on c.id = s.course_id where s.id = $1`,
    [studentId],
  );
  return s;
}

/**
 * The data behind one printed report card. Admins may print an unpublished exam (it is stamped
 * PROVISIONAL); a student only ever reaches a published one.
 */
export async function reportCardData(examId, studentId, { publishedOnly }) {
  const exam = await mustExam(examId);
  if (publishedOnly && exam.status !== 'published') throw new HttpError(404, 'Result not found.');
  const student = await studentRow(studentId);
  if (!student) throw new HttpError(404, 'Student not found.');
  const papers = await papersOf(examId);
  const bands = await loadBands();
  const mine = entriesForStudent(await entriesOf(examId), studentId);
  if (publishedOnly && mine.size === 0) throw new HttpError(404, 'Result not found.');
  const outcome = studentOutcome(papers, mine, bands);
  if (!outcome.complete) throw new HttpError(409, 'Marks are not complete for this student yet.');
  return { exam, student, outcome, bands, provisional: exam.status !== 'published' };
}

/** Every student whose marks are complete, as report-card data, for a bulk print. */
export async function allReportCards(examId) {
  const { exam, students, bands } = await examResults(examId);
  const cards = [];
  for (const s of students.filter((x) => x.complete)) {
    const student = await studentRow(s.id);
    cards.push({ exam, student, outcome: s, bands, provisional: exam.status !== 'published' });
  }
  if (!cards.length) throw new HttpError(409, 'No student has complete marks yet.');
  return cards;
}

/* ------------------------------------------------------------------ student */

/** A student's published results, newest semester first, plus a CGPA over their semester-end ('term') exams. */
export async function studentResults(studentId) {
  const bands = await loadBands();
  const { rows: exams } = await q(
    `${EXAM_SQL} where e.status = 'published'
       and exists (select 1 from exam_marks m join exam_papers p on p.id = m.paper_id where p.exam_id = e.id and m.student_id = $1)
     order by e.semester desc, e.published_at desc`,
    [studentId],
  );
  if (!exams.length) return { cgpa: null, bands, exams: [] };

  const ids = exams.map((e) => e.id);
  const { rows: papers } = await q(`${PAPER_SQL} where p.exam_id = any($1::uuid[]) order by lower(p.subject)`, [ids]);
  const { rows: marks } = await q(
    `select m.paper_id as "paperId", m.marks::float8 as marks, m.absent from exam_marks m where m.student_id = $1`, [studentId],
  );
  const mine = new Map(marks.map((m) => [m.paperId, { marks: m.marks, absent: m.absent }]));

  const out = exams.map((e) => ({ ...e, ...studentOutcome(papers.filter((p) => p.examId === e.id), mine, bands) }));
  return { cgpa: cumulativeGpa(out.filter((o) => o.kind === 'term')), bands, exams: out };
}

/**
 * Classes / courses / programmes of an institute (what the institute calls them depends on its type).
 * Students, admissions, fees, the timetable, attendance, exams and quizzes all hang off a course, so an admin must be
 * able to create them; and DELETING one must be strict, because several tables would cascade-delete with it.
 */
import { q } from '../db/pool.js';
import { isUuid } from '../db/pool.js';
import { HttpError } from '../middleware/error.js';
import { audit } from '../db/audit.js';

/**
 * Every table that references a course: [table, column, singular, plural].
 * A course may be deleted ONLY when none of these has a row for it. (Six of them would cascade-delete with the course,
 * so the database alone would silently wipe attendance, exams or quizzes.) test/courses.test.js compares this list
 * with the database's own foreign keys, so a future migration that adds a dependant fails the test until it is added here.
 */
export const COURSE_DEPENDANTS = [
  ['students', 'course_id', 'student', 'students'],
  ['applications', 'course_id', 'admission application', 'admission applications'],
  ['fee_structures', 'course_id', 'fee structure', 'fee structures'],
  ['timetable_slots', 'course_id', 'timetable slot', 'timetable slots'],
  ['duties', 'course_id', 'lecture reassignment', 'lecture reassignments'],
  ['attendance_sessions', 'course_id', 'attendance record', 'attendance records'],
  ['exams', 'course_id', 'exam', 'exams'],
  ['quizzes', 'course_id', 'quiz', 'quizzes'],
  ['learning_assignments', 'target_course_id', 'learning assignment', 'learning assignments'],
];

const SELECT = `
  select c.id, c.code, c.name, c.full_name as "fullName", c.years, c.department_id as "departmentId", d.name as "departmentName",
         (select count(*)::int from students s where s.course_id = c.id) as students
  from courses c left join departments d on d.id = c.department_id`;

const text = (v, label, max, required = false) => {
  const s = String(v ?? '').trim();
  if (required && !s) throw new HttpError(400, `${label} is required.`);
  if (s.length > max) throw new HttpError(400, `${label} is too long (${max} characters at most).`);
  return s;
};

async function clean(body, current) {
  const b = { ...(current || {}), ...(body || {}) };
  const code = text(b.code, 'Code', 20, true);
  if (!/^[A-Za-z0-9][A-Za-z0-9 ._-]*$/.test(code)) throw new HttpError(400, 'Code may use letters, numbers, spaces, dots, dashes and underscores, and must start with a letter or number.');
  const years = Number(b.years ?? 1);
  if (!Number.isInteger(years) || years < 1 || years > 8) throw new HttpError(400, 'Duration must be a whole number of years from 1 to 8.');
  let departmentId = b.departmentId || null;
  if (departmentId) {
    if (!isUuid(departmentId) || !(await q('select 1 from departments where id = $1', [departmentId])).rowCount) throw new HttpError(400, 'Choose a department from the list.');
  } else departmentId = null;
  return { code, name: text(b.name, 'Name', 80, true), fullName: text(b.fullName, 'Full name', 150), years, departmentId };
}

const dupMessage = 'Another one already uses that code. Codes must be different (capital letters do not count).';

export async function listCourses() {
  return (await q(`${SELECT} order by lower(c.code)`)).rows;
}

export async function getCourse(id) {
  if (!isUuid(id)) throw new HttpError(404, 'Not found.');
  const { rows: [c] } = await q(`${SELECT} where c.id = $1`, [id]);
  if (!c) throw new HttpError(404, 'Not found.');
  return c;
}

export async function createCourse(actor, body) {
  const c = await clean(body);
  let id;
  try {
    ({ rows: [{ id }] } = await q('insert into courses (code, name, full_name, department_id, years) values ($1,$2,$3,$4,$5) returning id', [c.code, c.name, c.fullName, c.departmentId, c.years]));
  } catch (e) { if (e.code === '23505') throw new HttpError(409, dupMessage); throw e; }
  await audit(actor, 'course.create', 'course', id, { code: c.code, name: c.name });
  return getCourse(id);
}

export async function updateCourse(actor, id, body) {
  const cur = await getCourse(id);
  const c = await clean(body, cur);
  try {
    await q('update courses set code=$2, name=$3, full_name=$4, department_id=$5, years=$6 where id=$1', [id, c.code, c.name, c.fullName, c.departmentId, c.years]);
  } catch (e) { if (e.code === '23505') throw new HttpError(409, dupMessage); throw e; }
  await audit(actor, 'course.update', 'course', id, { code: c.code });
  return getCourse(id);
}

export async function usageOf(id) {
  const sql = COURSE_DEPENDANTS.map(([t, col], i) => `select ${i} as i, count(*)::int as n from ${t} where ${col} = $1`).join(' union all ');
  const { rows } = await q(sql, [id]);
  return COURSE_DEPENDANTS.map(([, , one, many], i) => ({ n: rows.find((r) => r.i === i).n, one, many })).filter((u) => u.n > 0);
}

export async function removeCourse(actor, id) {
  const cur = await getCourse(id);
  const used = await usageOf(id);
  if (used.length) {
    const list = used.map((u) => `${u.n} ${u.n === 1 ? u.one : u.many}`).join(', ');
    throw new HttpError(409, `Cannot delete "${cur.code}": it still has ${list}. Move or remove those first.`);
  }
  await q('delete from courses where id = $1', [id]);
  await audit(actor, 'course.delete', 'course', id, { code: cur.code });
}

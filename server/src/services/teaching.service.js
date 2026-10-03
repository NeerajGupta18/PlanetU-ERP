/** Who may act on which subject: a teacher works with the classes and subjects on their own timetable; an admin with all of them. */
import { q } from '../db/pool.js';
import { HttpError } from '../middleware/error.js';

export const sameSubject = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();

export async function teaches(employeeId, courseId, subject) {
  if (!employeeId) return false;
  const { rowCount } = await q(
    'select 1 from timetable_slots where employee_id = $1 and course_id = $2 and lower(trim(subject)) = lower(trim($3)) limit 1', [employeeId, courseId, subject],
  );
  return rowCount > 0;
}

/** The (class, subject) pairs this person may assign work for. */
export async function teachingScope(actor) {
  const { rows } = await q(
    `select distinct s.course_id as "courseId", c.name as course, s.subject
     from timetable_slots s join courses c on c.id = s.course_id
     where ($1::uuid is null or s.employee_id = $1) order by c.name, s.subject`,
    [actor.role === 'admin' ? null : actor.employeeId],
  );
  return rows;
}

export async function assertCanTeach(actor, courseId, subject) {
  if (actor.role === 'admin') return;
  if (!(await teaches(actor.employeeId, courseId, subject))) {
    throw new HttpError(403, 'You can only do this for a subject you teach in that class (it must be on your timetable).');
  }
}

/** Everything the assign / set-a-quiz forms need: the classes this person may use, and the (class, subject) pairs on their timetable. */
export async function formScope(actor) {
  const pairs = await teachingScope(actor);
  const classes = actor.role === 'admin'
    ? (await q('select id, name from courses order by name')).rows
    : [...new Map(pairs.map((p) => [p.courseId, { id: p.courseId, name: p.course }])).values()];
  return { classes, scope: pairs };
}

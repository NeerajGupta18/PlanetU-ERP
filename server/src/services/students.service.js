import { q } from '../db/pool.js';
import { HttpError } from '../middleware/error.js';
import { audit } from '../db/audit.js';

const SELECT = `
  select s.id, s.student_code as "studentCode", s.roll_no as "rollNo", s.enrollment_no as "enrollmentNo",
         s.name, s.email, s.phone, s.dob, s.gender, s.blood_group as "bloodGroup", s.nationality,
         s.course_id as "courseId", c.name as course, s.semester, s.section, s.batch,
         s.admission_date as "admissionDate", s.status, s.address, s.guardian,
         s.photo_file_id as "photoFileId", s.card_valid_till as "cardValidTill"
  from students s left join courses c on c.id = s.course_id`;

export async function listStudents({ course, status, search } = {}) {
  const where = [];
  const params = [];
  if (course) { params.push(course); where.push(`s.course_id = $${params.length}`); }
  if (status) { params.push(status); where.push(`s.status = $${params.length}`); }
  if (search) { params.push(`%${String(search).toLowerCase()}%`); where.push(`(lower(s.name) like $${params.length} or lower(s.email) like $${params.length} or lower(s.student_code) like $${params.length})`); }
  const { rows } = await q(`${SELECT} ${where.length ? `where ${where.join(' and ')}` : ''} order by s.student_code`, params);
  return rows;
}

export async function getStudent(id) {
  const { rows: [s] } = await q(`${SELECT} where s.id = $1`, [id]);
  if (!s) throw new HttpError(404, 'Student not found.');
  const { rows: [full] } = await q('select attendance from students where id = $1', [id]);
  return { ...s, attendance: full.attendance };
}

const EDITABLE = ['phone', 'address', 'section', 'semester', 'status', 'bloodGroup', 'guardian', 'cardValidTill'];
const STATUSES = ['Active', 'Inactive', 'Alumni'];
const COLUMN = { phone: 'phone', address: 'address', section: 'section', semester: 'semester', status: 'status', bloodGroup: 'blood_group', guardian: 'guardian', cardValidTill: 'card_valid_till' };

export async function updateStudent(id, body, admin) {
  const { rowCount: exists } = await q('select 1 from students where id = $1', [id]);
  if (!exists) throw new HttpError(404, 'Student not found.');
  if (body.status && !STATUSES.includes(body.status)) throw new HttpError(400, `Status must be one of: ${STATUSES.join(', ')}.`);
  if (body.semester !== undefined && (!Number.isInteger(body.semester) || body.semester < 1 || body.semester > 20)) {
    throw new HttpError(400, 'Semester must be a whole number between 1 and 20.');
  }
  const sets = []; const params = [];
  for (const k of EDITABLE) {
    if (body[k] === undefined) continue;
    params.push(k === 'guardian' ? JSON.stringify(body[k]) : (body[k] || null));
    sets.push(`${COLUMN[k]} = $${params.length}${k === 'guardian' ? '::jsonb' : ''}`);
  }
  if (!sets.length) throw new HttpError(400, 'Nothing to update.');
  params.push(id);
  await q(`update students set ${sets.join(', ')} where id = $${params.length}`, params);
  // Disabling a student's status also blocks their login without deleting their history
  if (body.status) {
    await q(`update users set status = $1 where student_id = $2`, [body.status === 'Active' ? 'active' : 'disabled', id]);
    await audit(admin, 'student.status_change', 'student', id, { status: body.status });
  }
  return getStudent(id);
}

/** Sets (or clears) the file used as the student's photo - must already belong to this tenant. */
export async function setPhoto(id, fileId) {
  const { rowCount: exists } = await q('select 1 from students where id = $1', [id]);
  if (!exists) throw new HttpError(404, 'Student not found.');
  if (fileId) {
    const { rows: [f] } = await q("select mime from files where id = $1", [fileId]);
    if (!f) throw new HttpError(400, 'File not found.');
    if (!f.mime.startsWith('image/')) throw new HttpError(400, 'The ID photo must be an image (PNG or JPEG).');
  }
  await q('update students set photo_file_id = $1 where id = $2', [fileId || null, id]);
  return getStudent(id);
}

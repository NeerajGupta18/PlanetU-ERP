/**
 * Placement. The placement cell keeps the companies that visit and the drives they hold: role, package, dates and who
 * may apply (courses, minimum semester, minimum attendance). Students apply to open drives they are eligible for; the
 * office moves each application to shortlisted, selected or rejected and records the offer.
 */
import { env } from '../config/env.js';
import { isUuid, q } from '../db/pool.js';
import { audit } from '../db/audit.js';
import { HttpError } from '../middleware/error.js';
import { isISO, toISO } from '../utils/dates.js';
import { queueEmail, tenantInfo } from './notifications.service.js';
import { studentOverview } from './attendance.service.js';

const DECISIONS = ['applied', 'shortlisted', 'selected', 'rejected'];
const str = (v, max, label, required = false) => {
  const s = typeof v === 'string' ? v.trim() : '';
  if (required && !s) throw new HttpError(400, `${label} is required.`);
  if (s.length > max) throw new HttpError(400, `${label} is too long (${max} characters at most).`);
  return s;
};
const num = (v, label, { min = 0, max = 10000 } = {}) => {
  if (v === '' || v === undefined || v === null) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw new HttpError(400, `${label} must be a number from ${min} to ${max}.`);
  return Math.round(n * 100) / 100;
};
const dup = (err, msg) => { if (err.code === '23505') throw new HttpError(409, msg); throw err; };

/* ================================================================== companies */

const COMPANY = `select c.id, c.name, c.industry, c.website, c.contact_name as "contactName", c.contact_email as "contactEmail", c.contact_phone as "contactPhone",
  c.notes, (select count(*) from placement_drives d where d.company_id = c.id)::int as drives from placement_companies c`;

export async function listCompanies() { return (await q(`${COMPANY} order by lower(c.name)`)).rows; }

function cleanCompany(b = {}) {
  return {
    name: str(b.name, 120, 'Company name', true), industry: str(b.industry, 80, 'Industry'), website: str(b.website, 200, 'Website'),
    contactName: str(b.contactName, 100, 'Contact name'), contactEmail: str(b.contactEmail, 120, 'Contact email'),
    contactPhone: str(b.contactPhone, 30, 'Contact phone'), notes: str(b.notes, 1000, 'Notes'),
  };
}

export async function createCompany(body, admin) {
  const c = cleanCompany(body);
  try {
    const { rows: [r] } = await q(
      'insert into placement_companies (name, industry, website, contact_name, contact_email, contact_phone, notes) values ($1, $2, $3, $4, $5, $6, $7) returning id',
      [c.name, c.industry, c.website, c.contactName, c.contactEmail, c.contactPhone, c.notes],
    );
    await audit(admin, 'placement.company.create', 'placement_company', r.id, { name: c.name });
    return (await q(`${COMPANY} where c.id = $1`, [r.id])).rows[0];
  } catch (err) { return dup(err, 'This company is already listed.'); }
}

export async function updateCompany(id, body, admin) {
  const c = cleanCompany(body);
  try {
    const { rowCount } = await q(
      'update placement_companies set name = $2, industry = $3, website = $4, contact_name = $5, contact_email = $6, contact_phone = $7, notes = $8 where id = $1',
      [id, c.name, c.industry, c.website, c.contactName, c.contactEmail, c.contactPhone, c.notes],
    );
    if (!rowCount) throw new HttpError(404, 'Company not found.');
  } catch (err) { if (err instanceof HttpError) throw err; dup(err, 'This company is already listed.'); }
  await audit(admin, 'placement.company.update', 'placement_company', id);
  return (await q(`${COMPANY} where c.id = $1`, [id])).rows[0];
}

export async function removeCompany(id, admin) {
  const { rows: [c] } = await q(`${COMPANY} where c.id = $1`, [id]);
  if (!c) throw new HttpError(404, 'Company not found.');
  if (c.drives) throw new HttpError(409, `${c.name} has ${c.drives} drive${c.drives === 1 ? '' : 's'}. Delete those first.`);
  await q('delete from placement_companies where id = $1', [id]);
  await audit(admin, 'placement.company.delete', 'placement_company', id, { name: c.name });
}

/* ================================================================== drives */

const DRIVE = `select d.id, d.title, d.description, d.ctc_lpa::float8 as "ctcLpa", d.location, d.drive_date as "driveDate", d.apply_by as "applyBy", d.status,
  d.course_ids as "courseIds", d.min_semester as "minSemester", d.min_attendance::float8 as "minAttendance",
  c.id as "companyId", c.name as company, c.industry,
  coalesce((select json_agg(x.name order by x.name) from courses x where x.id = any (d.course_ids)), '[]'::json) as "courseNames"
  from placement_drives d join placement_companies c on c.id = d.company_id`;

async function cleanDrive(b = {}) {
  if (!isUuid(b.companyId) || !(await q('select 1 from placement_companies where id = $1', [b.companyId])).rowCount) throw new HttpError(400, 'Choose a company.');
  const driveDate = b.driveDate || null; const applyBy = b.applyBy || null;
  for (const [v, l] of [[driveDate, 'drive date'], [applyBy, 'last date to apply']]) if (v && !isISO(v)) throw new HttpError(400, `Enter a valid ${l}.`);
  if (driveDate && applyBy && applyBy > driveDate) throw new HttpError(400, 'The last date to apply cannot be after the drive date.');
  const courseIds = Array.isArray(b.courseIds) ? [...new Set(b.courseIds)] : [];
  if (courseIds.some((x) => !isUuid(x))) throw new HttpError(400, 'Choose valid courses.');
  if (courseIds.length && (await q('select count(*)::int as n from courses where id = any ($1)', [courseIds])).rows[0].n !== courseIds.length) throw new HttpError(400, 'Choose valid courses.');
  const minSem = num(b.minSemester, 'Minimum semester', { min: 1, max: 20 });
  return {
    companyId: b.companyId, title: str(b.title, 150, 'Title', true), description: str(b.description, 3000, 'Details'), ctc: num(b.ctcLpa, 'Package (LPA)', { max: 1000 }),
    location: str(b.location, 100, 'Location'), driveDate, applyBy, courseIds, minSemester: minSem === null ? null : Math.round(minSem),
    minAttendance: num(b.minAttendance, 'Minimum attendance', { max: 100 }),
  };
}

export async function listDrives({ status } = {}) {
  const { rows } = await q(
    `select * from (${DRIVE}) d2,
       lateral (select count(*)::int as applicants,
                       count(*) filter (where a.status = 'shortlisted')::int as shortlisted,
                       count(*) filter (where a.status = 'selected')::int as selected
                from placement_applications a where a.drive_id = d2.id and a.status <> 'withdrawn') n
     where ($1::text is null or d2.status = $1) order by coalesce(d2."driveDate", d2."applyBy") desc nulls last, d2.title limit 300`, [status || null],
  );
  return rows;
}

export async function createDrive(body, admin) {
  const d = await cleanDrive(body);
  const { rows: [r] } = await q(
    `insert into placement_drives (company_id, title, description, ctc_lpa, location, drive_date, apply_by, status, course_ids, min_semester, min_attendance)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning id`,
    [d.companyId, d.title, d.description, d.ctc, d.location, d.driveDate, d.applyBy, body.publish === true ? 'open' : 'draft', d.courseIds, d.minSemester, d.minAttendance],
  );
  await audit(admin, 'placement.drive.create', 'placement_drive', r.id, { title: d.title });
  return (await q(`${DRIVE} where d.id = $1`, [r.id])).rows[0];
}

export async function updateDrive(id, body, admin) {
  const d = await cleanDrive(body);
  const { rowCount } = await q(
    `update placement_drives set company_id = $2, title = $3, description = $4, ctc_lpa = $5, location = $6, drive_date = $7, apply_by = $8,
       course_ids = $9, min_semester = $10, min_attendance = $11 where id = $1`,
    [id, d.companyId, d.title, d.description, d.ctc, d.location, d.driveDate, d.applyBy, d.courseIds, d.minSemester, d.minAttendance],
  );
  if (!rowCount) throw new HttpError(404, 'Drive not found.');
  await audit(admin, 'placement.drive.update', 'placement_drive', id);
  return (await q(`${DRIVE} where d.id = $1`, [id])).rows[0];
}

async function setDriveStatus(id, to, from, admin) {
  const { rows: [d] } = await q('select status from placement_drives where id = $1 for update', [id]);
  if (!d) throw new HttpError(404, 'Drive not found.');
  if (!from.includes(d.status)) throw new HttpError(409, `This drive is ${d.status}.`);
  await q('update placement_drives set status = $2 where id = $1', [id, to]);
  await audit(admin, `placement.drive.${to}`, 'placement_drive', id);
  return (await q(`${DRIVE} where d.id = $1`, [id])).rows[0];
}
export const openDrive = (id, admin) => setDriveStatus(id, 'open', ['draft', 'closed'], admin);
export const closeDrive = (id, admin) => setDriveStatus(id, 'closed', ['open'], admin);

export async function removeDrive(id, admin) {
  if ((await q('select 1 from placement_applications where drive_id = $1', [id])).rowCount) throw new HttpError(409, 'Students have applied. Close the drive instead of deleting it.');
  const { rowCount } = await q('delete from placement_drives where id = $1', [id]);
  if (!rowCount) throw new HttpError(404, 'Drive not found.');
  await audit(admin, 'placement.drive.delete', 'placement_drive', id);
}

export async function driveDetail(id) {
  if (!isUuid(id)) throw new HttpError(404, 'Drive not found.');
  const { rows: [drive] } = await q(`${DRIVE} where d.id = $1`, [id]);
  if (!drive) throw new HttpError(404, 'Drive not found.');
  const { rows: applications } = await q(
    `select a.id, a.status, a.note, a.offer_lpa::float8 as "offerLpa", a.resume_file_id as "resumeFileId", a.applied_at as "appliedAt",
            s.id as "studentId", s.name, s.student_code as "studentCode", s.semester, s.email, c.name as course
     from placement_applications a join students s on s.id = a.student_id left join courses c on c.id = s.course_id
     where a.drive_id = $1 order by case a.status when 'selected' then 0 when 'shortlisted' then 1 when 'applied' then 2 when 'rejected' then 3 else 4 end, s.name`, [id],
  );
  return { drive, applications };
}

export async function decide(applicationId, body = {}, admin) {
  if (!DECISIONS.includes(body.status)) throw new HttpError(400, `Choose one of: ${DECISIONS.join(', ')}.`);
  const { rows: [a] } = await q(
    `select a.id, a.status, a.drive_id, s.name, s.email, d.title, c.name as company
     from placement_applications a join students s on s.id = a.student_id join placement_drives d on d.id = a.drive_id join placement_companies c on c.id = d.company_id
     where a.id = $1 for update of a`, [applicationId],
  );
  if (!a) throw new HttpError(404, 'Application not found.');
  if (a.status === 'withdrawn') throw new HttpError(409, 'The student withdrew this application.');
  const offer = body.status === 'selected' ? num(body.offerLpa, 'Offer (LPA)', { max: 1000 }) : null;
  const note = str(body.note, 500, 'Note');
  await q('update placement_applications set status = $2, offer_lpa = $3, note = $4, decided_at = case when $2 = \'applied\' then null else now() end where id = $1',
    [applicationId, body.status, offer, note]);
  if (a.email && body.status !== a.status && body.status !== 'applied') {
    const info = await tenantInfo();
    await queueEmail(a.email, 'placementUpdate', { institute: info.name, name: a.name, company: a.company, title: a.title, status: body.status, offer, note, url: `${env.APP_URL}/login` });
  }
  await audit(admin, 'placement.decide', 'placement_application', applicationId, { status: body.status });
  return (await driveDetail(a.drive_id)).applications.find((x) => x.id === applicationId);
}

export async function stats() {
  const { rows: [t] } = await q(
    `select (select count(*) from placement_companies)::int as companies,
            (select count(*) from placement_drives where status = 'open')::int as "openDrives",
            (select count(*) from placement_applications where status <> 'withdrawn')::int as applications,
            (select count(distinct student_id) from placement_applications where status = 'selected')::int as placed,
            (select count(*) from students where status = 'Active')::int as students,
            (select max(offer_lpa) from placement_applications where status = 'selected')::float8 as highest,
            (select round(avg(offer_lpa), 2) from placement_applications where status = 'selected' and offer_lpa is not null)::float8 as average`,
  );
  const { rows: byCourse } = await q(
    `select c.name as course, (select count(*) from students s where s.course_id = c.id and s.status = 'Active')::int as students,
            (select count(distinct a.student_id) from placement_applications a join students s on s.id = a.student_id where s.course_id = c.id and a.status = 'selected')::int as placed
     from courses c order by c.name`,
  );
  return { ...t, byCourse: byCourse.filter((c) => c.students > 0) };
}

/* ================================================================== student */

async function eligibility(student, d) {
  const reasons = [];
  if (d.course_ids.length && !d.course_ids.includes(student.course_id)) reasons.push('Not open to your course');
  if (d.min_semester && student.semester < d.min_semester) reasons.push(`Needs semester ${d.min_semester} or later`);
  if (d.min_attendance !== null) {
    const o = await studentOverview(student.id, student.attendance || []);
    if (Number(o.overall) < d.min_attendance) reasons.push(`Needs ${d.min_attendance}% attendance (you have ${o.overall}%)`);
  }
  return reasons;
}

async function studentOf(studentId) {
  const { rows: [s] } = await q('select id, course_id, semester, attendance, status from students where id = $1', [studentId]);
  if (!s) throw new HttpError(404, 'Student not found.');
  return s;
}

const MY_APP = `a.id as "applicationId", a.status as "myStatus", a.offer_lpa::float8 as "myOffer", a.note as "myNote"`;

export async function drivesForStudent(studentId) {
  const s = await studentOf(studentId);
  const { rows } = await q(
    `select d.id, d.title, d.description, d.ctc_lpa::float8 as "ctcLpa", d.location, d.drive_date as "driveDate", d.apply_by as "applyBy", d.status,
            d.course_ids, d.min_semester, d.min_attendance::float8 as min_attendance, c.name as company, c.industry, ${MY_APP}
     from placement_drives d join placement_companies c on c.id = d.company_id
     left join placement_applications a on a.drive_id = d.id and a.student_id = $1
     where d.status = 'open' or a.id is not null order by coalesce(d.apply_by, d.drive_date) nulls last, d.title`, [studentId],
  );
  const today = toISO(new Date());
  const out = [];
  for (const d of rows) {
    const reasons = d.status === 'open' ? await eligibility(s, d) : [];
    const closed = d.status !== 'open' || (d.applyBy && d.applyBy < today);
    out.push({
      id: d.id, title: d.title, description: d.description, ctcLpa: d.ctcLpa, location: d.location, driveDate: d.driveDate, applyBy: d.applyBy, company: d.company,
      industry: d.industry, status: d.status, applicationId: d.applicationId, myStatus: d.myStatus, myOffer: d.myOffer, myNote: d.myNote,
      minSemester: d.min_semester, minAttendance: d.min_attendance, eligible: !closed && reasons.length === 0, reasons: closed ? ['Applications are closed'] : reasons,
    });
  }
  return { drives: out };
}

export async function apply(actor, driveId, body = {}) {
  const s = await studentOf(actor.studentId);
  if (s.status !== 'Active') throw new HttpError(403, 'Only active students can apply.');
  if (!isUuid(driveId)) throw new HttpError(404, 'Drive not found.');
  const { rows: [d] } = await q('select id, status, apply_by::text as apply_by, course_ids, min_semester, min_attendance::float8 as min_attendance from placement_drives where id = $1', [driveId]);
  if (!d || d.status !== 'open') throw new HttpError(404, 'This drive is not open.');
  if (d.apply_by && d.apply_by < toISO(new Date())) throw new HttpError(409, 'The last date to apply has passed.');
  const reasons = await eligibility(s, d);
  if (reasons.length) throw new HttpError(403, `You are not eligible: ${reasons.join('; ')}.`);
  let resume = null;
  if (body.resumeFileId) {
    if (!isUuid(body.resumeFileId) || !(await q('select 1 from files where id = $1 and created_by = $2', [body.resumeFileId, actor.id])).rowCount) throw new HttpError(400, 'The resume was not found. Upload it again.');
    resume = body.resumeFileId;
  }
  const { rows: [cur] } = await q('select id, status from placement_applications where drive_id = $1 and student_id = $2 for update', [driveId, s.id]);
  if (cur && cur.status !== 'withdrawn') throw new HttpError(409, 'You have already applied to this drive.');
  if (cur) await q("update placement_applications set status = 'applied', resume_file_id = coalesce($2, resume_file_id), applied_at = now(), decided_at = null, offer_lpa = null, note = '' where id = $1", [cur.id, resume]);
  else await q('insert into placement_applications (drive_id, student_id, resume_file_id) values ($1, $2, $3)', [driveId, s.id, resume]);
  await audit(actor, 'placement.apply', 'placement_drive', driveId);
  return drivesForStudent(s.id);
}

export async function withdraw(actor, driveId) {
  const { rows: [a] } = await q('select id, status from placement_applications where drive_id = $1 and student_id = $2 for update', [driveId, actor.studentId]);
  if (!a) throw new HttpError(404, 'You have not applied to this drive.');
  if (!['applied', 'shortlisted'].includes(a.status)) throw new HttpError(409, `You cannot withdraw once the application is ${a.status}.`);
  await q("update placement_applications set status = 'withdrawn' where id = $1", [a.id]);
  await audit(actor, 'placement.withdraw', 'placement_drive', driveId);
  return drivesForStudent(actor.studentId);
}

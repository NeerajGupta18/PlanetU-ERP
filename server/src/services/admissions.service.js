import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { q } from '../db/pool.js';
import { HttpError } from '../middleware/error.js';
import { audit } from '../db/audit.js';
import { nextNumber } from '../db/series.js';
import { deleteFile, saveUpload } from './files.service.js';
import { env } from '../config/env.js';
import { sendSetupLink } from './accounts.service.js';
import { queueEmail, tenantInfo } from './notifications.service.js';
import { isISO, toISO } from '../utils/dates.js';

export const DOC_TYPES = ['photo', 'id_proof', 'marksheet', 'other'];
export const REQUIRED_DOCS = ['photo', 'id_proof', 'marksheet'];
const EDITABLE = ['draft', 'documents_pending'];

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const DOC_NAME = { photo: 'passport-size photo', id_proof: 'ID proof', marksheet: 'previous marksheet', other: 'document' };

async function notifyApplicant(app, template, extra = {}) {
  const info = await tenantInfo();
  await queueEmail(app.email, template, {
    institute: info.name, name: app.name, applicationNo: app.application_no ?? app.applicationNo,
    statusUrl: `${env.APP_URL}/apply/${info.code}/status`, ...extra,
  });
}
const str = (v, max, label, required = false) => {
  const s = typeof v === 'string' ? v.trim() : '';
  if (required && !s) throw new HttpError(400, `${label} is required.`);
  if (s.length > max) throw new HttpError(400, `${label} is too long.`);
  return s;
};

function cleanApplicant(b = {}) {
  const email = str(b.email, 120, 'Email', true).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Enter a valid email address.');
  if (!isISO(b.dob) || b.dob >= toISO(new Date())) throw new HttpError(400, 'Enter a valid date of birth.');
  const g = b.guardian || {};
  const e = b.previousEducation || {};
  return {
    courseId: b.courseId,
    name: str(b.name, 100, 'Full name', true),
    email,
    phone: str(b.phone, 20, 'Phone'),
    dob: b.dob,
    gender: str(b.gender, 20, 'Gender'),
    address: str(b.address, 300, 'Address'),
    guardian: { name: str(g.name, 100, 'Guardian name'), relation: str(g.relation, 30, 'Relation'), phone: str(g.phone, 20, 'Guardian phone'), email: str(g.email, 120, 'Guardian email') },
    previousEducation: { institution: str(e.institution, 150, 'Institution'), qualification: str(e.qualification, 100, 'Qualification'), year: str(e.year, 4, 'Year'), percentage: str(e.percentage, 8, 'Percentage') },
  };
}

/* ---------------- applicant side ---------------- */

export async function admissionsInfo() {
  const { rows: courses } = await q('select id, name, full_name as "fullName" from courses order by name');
  return { courses, requiredDocuments: REQUIRED_DOCS, documentTypes: DOC_TYPES };
}

/** Creates a private draft. The access code is returned ONCE; only its hash is stored. */
export async function createApplication(body) {
  const a = cleanApplicant(body);
  const { rowCount } = await q('select 1 from courses where id = $1', [a.courseId]);
  if (!rowCount) throw new HttpError(400, 'Choose a valid course.');
  const accessCode = crypto.randomBytes(12).toString('base64url');
  const applicationNo = await nextNumber('application', { prefix: `APP${new Date().getFullYear()}-`, padding: 5 });
  const { rows: [r] } = await q(
    `insert into applications (application_no, course_id, name, email, phone, dob, gender, address, guardian, previous_education, access_hash)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning id`,
    [applicationNo, a.courseId, a.name, a.email, a.phone, a.dob, a.gender, a.address, a.guardian, a.previousEducation, sha(accessCode)],
  );
  return { id: r.id, applicationNo, accessCode };
}

export async function loadForApplicant(id, accessCode) {
  if (typeof accessCode !== 'string' || !accessCode) throw new HttpError(401, 'Enter your application access code.');
  const { rows: [app] } = await q('select * from applications where id = $1 and access_hash = $2', [id, sha(accessCode)]);
  if (!app) throw new HttpError(404, 'Application not found, or the access code is wrong.');
  return app;
}

export async function loadByNumber(applicationNo, accessCode) {
  if (typeof applicationNo !== 'string' || typeof accessCode !== 'string' || !applicationNo || !accessCode) {
    throw new HttpError(400, 'Enter your application number and access code.');
  }
  const { rows: [app] } = await q('select * from applications where upper(application_no) = upper($1) and access_hash = $2', [applicationNo.trim(), sha(accessCode.trim())]);
  if (!app) throw new HttpError(404, 'No application matches that number and access code.');
  return app;
}

async function documentsOf(applicationId) {
  const { rows } = await q(
    `select d.id, d.doc_type as "docType", d.status, d.remark, f.original_name as name, f.size_bytes as size
     from application_documents d join files f on f.id = d.file_id
     where d.application_id = $1 order by d.doc_type, f.created_at`, [applicationId],
  );
  return rows;
}

export async function applicantView(app) {
  const { rows: [c] } = await q('select name from courses where id = $1', [app.course_id]);
  const decided = ['accepted', 'waitlisted', 'rejected', 'enrolled'].includes(app.status);
  return {
    id: app.id, applicationNo: app.application_no, status: app.status, name: app.name, course: c?.name,
    submittedAt: app.submitted_at, decisionNote: decided ? app.decision_note : '',
    documents: await documentsOf(app.id), requiredDocuments: REQUIRED_DOCS,
  };
}

export async function attachDocument(app, docType, file) {
  if (!DOC_TYPES.includes(docType)) throw new HttpError(400, `Document type must be one of: ${DOC_TYPES.join(', ')}.`);
  if (!EDITABLE.includes(app.status)) throw new HttpError(409, 'This application can no longer be changed.');

  if (docType !== 'other') {
    const { rows: [old] } = await q(
      `select d.id, d.status, d.file_id, f.storage_key from application_documents d join files f on f.id = d.file_id
       where d.application_id = $1 and d.doc_type = $2`, [app.id, docType],
    );
    if (old?.status === 'verified') throw new HttpError(409, 'A verified document cannot be replaced.');
    if (old) {
      await q('delete from application_documents where id = $1', [old.id]);
      await deleteFile({ id: old.file_id, storage_key: old.storage_key });
    }
  }
  const saved = await saveUpload({ file, purpose: 'admission', user: { id: null } });
  await q('insert into application_documents (application_id, doc_type, file_id) values ($1, $2, $3)', [app.id, docType, saved.id]);
  return applicantView(app);
}

export async function submitApplication(app) {
  if (!EDITABLE.includes(app.status)) throw new HttpError(409, 'This application has already been submitted.');
  const docs = await documentsOf(app.id);
  const missing = REQUIRED_DOCS.filter((t) => !docs.some((d) => d.docType === t));
  if (missing.length) throw new HttpError(400, `Upload the required documents first: ${missing.join(', ')}.`);
  if (docs.some((d) => d.status === 'rejected')) throw new HttpError(400, 'Replace the rejected documents before submitting again.');
  try {
    await q("update applications set status = 'submitted', submitted_at = coalesce(submitted_at, now()) where id = $1", [app.id]);
  } catch (err) {
    if (err.code === '23505') throw new HttpError(409, 'An application with this email already exists for this course.');
    throw err;
  }
  if (app.status === 'draft') await notifyApplicant(app, 'applicationReceived');
  return applicantView({ ...app, status: 'submitted' });
}

/* ---------------- admin side ---------------- */

const APP_SELECT = `
  select a.id, a.application_no as "applicationNo", a.name, a.email, a.phone, a.dob, a.gender, a.address, a.guardian,
         a.previous_education as "previousEducation", a.status, a.submitted_at as "submittedAt", a.decided_at as "decidedAt",
         a.decision_note as "decisionNote", a.student_id as "studentId", a.created_at as "createdAt",
         c.name as course, a.course_id as "courseId",
         (select count(*) from application_documents d where d.application_id = a.id)::int as "documentCount"
  from applications a join courses c on c.id = a.course_id`;

export async function listApplications({ status, search } = {}) {
  const where = ["a.status <> 'draft'"];
  const params = [];
  if (status) { params.push(status); where.push(`a.status = $${params.length}`); }
  if (search) { params.push(`%${String(search).toLowerCase()}%`); where.push(`(lower(a.name) like $${params.length} or lower(a.email) like $${params.length} or lower(a.application_no) like $${params.length})`); }
  const { rows } = await q(`${APP_SELECT} where ${where.join(' and ')} order by a.submitted_at desc nulls last, a.created_at desc`, params);
  const { rows: counts } = await q("select status, count(*)::int as n from applications where status <> 'draft' group by status");
  return { applications: rows, counts: Object.fromEntries(counts.map((c) => [c.status, c.n])) };
}

export async function getApplication(id) {
  const { rows: [a] } = await q(`${APP_SELECT} where a.id = $1 and a.status <> 'draft'`, [id]);
  if (!a) throw new HttpError(404, 'Application not found.');
  const { rows: docs } = await q(
    `select d.id, d.doc_type as "docType", d.status, d.remark, d.file_id as "fileId", f.original_name as name, f.mime, f.size_bytes as size
     from application_documents d join files f on f.id = d.file_id where d.application_id = $1 order by d.doc_type`, [id],
  );
  return { ...a, documents: docs, requiredDocuments: REQUIRED_DOCS };
}

export async function reviewDocument(appId, docId, { status, remark }, admin) {
  if (!['verified', 'rejected'].includes(status)) throw new HttpError(400, 'Status must be verified or rejected.');
  if (status === 'rejected' && !String(remark || '').trim()) throw new HttpError(400, 'Say why the document was rejected.');
  const { rows: [app] } = await q('select * from applications where id = $1', [appId]);
  if (!app || app.status === 'draft') throw new HttpError(404, 'Application not found.');
  if (!['submitted', 'documents_pending'].includes(app.status)) throw new HttpError(409, 'Documents can only be reviewed before a decision.');
  const { rowCount, rows: [doc] } = await q(
    `update application_documents set status = $1, remark = $2, verified_by = $3, verified_at = now() where id = $4 and application_id = $5
     returning doc_type`,
    [status, status === 'rejected' ? remark.trim() : '', admin.id, docId, appId],
  );
  if (!rowCount) throw new HttpError(404, 'Document not found.');
  // A rejected document sends the application back to the applicant to fix
  if (status === 'rejected') {
    await q("update applications set status = 'documents_pending' where id = $1", [appId]);
    await notifyApplicant(app, 'documentRejected', { docLabel: DOC_NAME[doc.doc_type], remark: remark.trim() });
  }
  await audit(admin, `admission.document_${status}`, 'application', appId, { docId });
  return getApplication(appId);
}

export async function decide(id, { decision, note }, admin) {
  const target = { accept: 'accepted', reject: 'rejected', waitlist: 'waitlisted' }[decision];
  if (!target) throw new HttpError(400, 'Decision must be accept, reject or waitlist.');
  if (target !== 'accepted' && !String(note || '').trim()) throw new HttpError(400, 'Add a note explaining the decision.');
  const { rows: [app] } = await q('select * from applications where id = $1 for update', [id]);
  if (!app || app.status === 'draft') throw new HttpError(404, 'Application not found.');
  if (!['submitted', 'waitlisted'].includes(app.status)) throw new HttpError(409, `An application that is "${app.status}" cannot be decided.`);
  if (target === 'accepted') {
    const { rows: docs } = await q('select doc_type, status from application_documents where application_id = $1', [id]);
    const unverified = REQUIRED_DOCS.filter((t) => !docs.some((d) => d.doc_type === t && d.status === 'verified'));
    if (unverified.length) throw new HttpError(409, `Verify these documents before accepting: ${unverified.join(', ')}.`);
  }
  await q('update applications set status = $1, decided_at = now(), decided_by = $2, decision_note = $3 where id = $4',
    [target, admin.id, String(note || '').trim(), id]);
  await notifyApplicant(app, 'applicationDecision', { decision: target, note: String(note || '').trim() });
  await audit(admin, `admission.${decision}`, 'application', id);
  return getApplication(id);
}

/** Turns an accepted application into a student: PRN, student record and a login. Atomic. */
export async function enroll(id, admin) {
  const { rows: [app] } = await q(
    `select a.*, c.years from applications a join courses c on c.id = a.course_id where a.id = $1 for update of a`, [id],
  );
  if (!app || app.status === 'draft') throw new HttpError(404, 'Application not found.');
  if (app.status !== 'accepted') throw new HttpError(409, app.status === 'enrolled' ? 'Already enrolled.' : 'Only accepted applications can be enrolled.');

  const prn = await nextNumber('prn', { prefix: 'PRN', padding: 7 });
  const year = new Date().getFullYear();
  let student;
  try {
    // Carry the verified admission photo over as the student's ID photo, if one was uploaded
    const { rows: [photo] } = await q(
      "select file_id from application_documents where application_id = $1 and doc_type = 'photo'", [app.id],
    );
    ({ rows: [student] } = await q(
      `insert into students (student_code, enrollment_no, name, email, phone, dob, gender, course_id, semester, batch,
                             admission_date, status, address, guardian, photo_file_id)
       values ($1, $1, $2, $3, $4, $5, $6, $7, 1, $8, current_date, 'Active', $9, $10, $11) returning id`,
      [prn, app.name, app.email, app.phone, app.dob, app.gender, app.course_id, `${year} - ${year + app.years}`, app.address, app.guardian, photo?.file_id ?? null],
    ));
  } catch (err) {
    if (err.code === '23505') throw new HttpError(409, 'A student with this PRN already exists.');
    throw err;
  }
  const temporaryPassword = crypto.randomBytes(9).toString('base64url');
  try {
    const { rows: [u] } = await q(
      `insert into users (role, login_id, email, name, password_hash, student_id, must_change_password)
       values ('student', $1, $2, $3, $4, $5, true) returning id`,
      [prn, app.email, app.name, await bcrypt.hash(temporaryPassword, 10), student.id],
    );
    await sendSetupLink({ id: u.id, name: app.name, email: app.email, loginId: prn });
  } catch (err) {
    if (err.code === '23505') throw new HttpError(409, 'Another account at this institute already uses this email.');
    throw err;
  }
  await q("update applications set status = 'enrolled', student_id = $1 where id = $2", [student.id, id]);
  await audit(admin, 'admission.enroll', 'application', id, { prn });
  return { application: await getApplication(id), student: { prn, loginId: prn, email: app.email, temporaryPassword } };
}

/**
 * "I lost my access code": issues fresh codes (the old ones stop working) and emails them to the address on file.
 * The caller always gets the same answer, so this can't be used to find out who applied.
 */
export async function recoverAccess(rawEmail) {
  const email = String(rawEmail || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Enter the email address you applied with.');
  const { rows: apps } = await q(
    `select id, application_no, name from applications
     where lower(email) = $1 and status in ('draft', 'submitted', 'documents_pending', 'accepted', 'waitlisted') order by created_at`, [email],
  );
  if (!apps.length) return;
  const entries = [];
  for (const a of apps) {
    const accessCode = crypto.randomBytes(12).toString('base64url');
    await q('update applications set access_hash = $1 where id = $2', [sha(accessCode), a.id]);
    entries.push({ applicationNo: a.application_no, accessCode });
  }
  const info = await tenantInfo();
  await queueEmail(email, 'accessCodeRecovered', {
    institute: info.name, name: apps[0].name, entries, statusUrl: `${env.APP_URL}/apply/${info.code}/status`,
  });
}

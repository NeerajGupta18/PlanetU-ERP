/**
 * Certificates. A student asks for a bonafide, character, NOC or transfer certificate (or the office issues one
 * over the counter). Issuing gives it a number from the institute's own series; the PDF is drawn from the saved
 * details, so downloading it again always gives the same certificate.
 */
import { env } from '../config/env.js';
import { q } from '../db/pool.js';
import { audit } from '../db/audit.js';
import { nextNumber } from '../db/series.js';
import { HttpError } from '../middleware/error.js';
import { isISO, toISO } from '../utils/dates.js';
import { queueEmail, tenantInfo } from './notifications.service.js';
import { studentFees } from './fees.service.js';

export const TYPES = {
  bonafide: 'Bonafide certificate',
  character: 'Character certificate',
  noc: 'No Objection Certificate (NOC)',
  transfer: 'Transfer certificate (TC)',
};

const str = (v, max, label, required = false) => {
  const s = typeof v === 'string' ? v.trim() : '';
  if (required && !s) throw new HttpError(400, `${label} is required.`);
  if (s.length > max) throw new HttpError(400, `${label} is too long (${max} characters at most).`);
  return s;
};

const SELECT = `
  select r.id, r.cert_type as "certType", r.purpose, r.status, r.certificate_no as "certificateNo", r.details, r.remark,
         r.created_at as "requestedAt", r.issued_at as "issuedAt", r.decided_at as "decidedAt",
         s.id as "studentId", s.name as "studentName", s.student_code as "studentCode", c.name as course
  from certificate_requests r
  join students s on s.id = r.student_id
  left join courses c on c.id = s.course_id`;
const label = (row) => ({ ...row, certLabel: TYPES[row.certType] });

/** Type-specific extras the office fills in when issuing. */
function cleanDetails(certType, d = {}) {
  if (certType === 'transfer') {
    const leavingDate = d.leavingDate || toISO(new Date());
    if (!isISO(leavingDate)) throw new HttpError(400, 'Enter a valid date of leaving.');
    return { leavingDate, reason: str(d.reason, 150, 'Reason for leaving'), conduct: str(d.conduct || 'Good', 40, 'Conduct') };
  }
  if (certType === 'character') return { conduct: str(d.conduct || 'Good', 40, 'Conduct') };
  return {};
}

/* ---------------- student ---------------- */

export async function listMine(user) {
  const { rows } = await q(`${SELECT} where r.student_id = $1 order by r.created_at desc`, [user.studentId]);
  return { requests: rows.map(label), types: TYPES };
}

export async function request(user, body = {}) {
  const certType = body.certType;
  if (!TYPES[certType]) throw new HttpError(400, `Choose a certificate: ${Object.keys(TYPES).join(', ')}.`);
  const purpose = str(body.purpose, 300, certType === 'transfer' ? 'Reason for leaving' : 'Purpose', true);
  const { rowCount } = await q("select 1 from certificate_requests where student_id = $1 and cert_type = $2 and status = 'requested'", [user.studentId, certType]);
  if (rowCount) throw new HttpError(409, `You already have a ${TYPES[certType]} request waiting for the office.`);
  const { rows: [r] } = await q(
    'insert into certificate_requests (student_id, cert_type, purpose, requested_by) values ($1, $2, $3, $4) returning id',
    [user.studentId, certType, purpose, user.id],
  );
  await audit(user, 'certificate.request', 'certificate', r.id, { certType });
  return (await q(`${SELECT} where r.id = $1`, [r.id])).rows.map(label)[0];
}

/* ---------------- office ---------------- */

export async function listForAdmin({ status, search } = {}) {
  const { rows } = await q(`${SELECT} order by (r.status = 'requested') desc, r.created_at desc limit 500`);
  const s = String(search || '').toLowerCase();
  const filtered = rows.filter((r) => (!status || r.status === status)
    && (!s || r.studentName.toLowerCase().includes(s) || r.studentCode.toLowerCase().includes(s) || (r.certificateNo || '').toLowerCase().includes(s)));
  const counts = rows.reduce((a, r) => ({ ...a, [r.status]: (a[r.status] || 0) + 1 }), {});
  return { requests: filtered.map(label), counts, types: TYPES };
}

async function outstandingDues(studentId, modules) {
  if (!modules?.includes('fees')) return 0;
  return (await studentFees(studentId)).summary.outstanding;
}

async function issue(row, { details, remark, force }, admin, modules) {
  if (row.cert_type === 'transfer' && !force) {
    const dues = await outstandingDues(row.student_id, modules);
    if (dues > 0) {
      throw Object.assign(new HttpError(409, `This student still owes ₹${dues.toLocaleString('en-IN')}. Collect it first, or issue anyway if the office has agreed.`), { code: 'HAS_DUES' });
    }
  }
  const number = await nextNumber('certificate', { prefix: `CERT${new Date().getFullYear()}-`, padding: 5 });
  await q(
    `update certificate_requests set status = 'issued', certificate_no = $2, details = $3, remark = $4, issued_at = now(), decided_at = now(), decided_by = $5 where id = $1`,
    [row.id, number, cleanDetails(row.cert_type, details), str(remark, 300, 'Remark'), admin.id],
  );
  await audit(admin, 'certificate.issue', 'certificate', row.id, { certificateNo: number, certType: row.cert_type });
  return number;
}

async function tell(id, decision, remark) {
  const { rows: [r] } = await q(
    `select r.cert_type, r.certificate_no, s.name, s.email from certificate_requests r join students s on s.id = r.student_id where r.id = $1`, [id],
  );
  if (!r?.email) return;
  const info = await tenantInfo();
  await queueEmail(r.email, 'certificateUpdate', {
    institute: info.name, name: r.name, certLabel: TYPES[r.cert_type], decision, certificateNo: r.certificate_no, remark, url: `${env.APP_URL}/login`,
  });
}

/** body: { decision: 'issue' | 'reject', remark, details, force } */
export async function decide(id, body = {}, admin, modules) {
  const { rows: [row] } = await q('select * from certificate_requests where id = $1 for update', [id]);
  if (!row) throw new HttpError(404, 'Request not found.');
  if (row.status !== 'requested') throw new HttpError(409, `This request is already ${row.status}.`);
  if (body.decision === 'reject') {
    const remark = str(body.remark, 300, 'Reason', true);
    await q("update certificate_requests set status = 'rejected', remark = $2, decided_at = now(), decided_by = $3 where id = $1", [id, remark, admin.id]);
    await audit(admin, 'certificate.reject', 'certificate', id, { certType: row.cert_type });
    await tell(id, 'rejected', remark);
  } else if (body.decision === 'issue') {
    await issue(row, body, admin, modules);
    await tell(id, 'issued', str(body.remark, 300, 'Remark'));
  } else {
    throw new HttpError(400, 'Decision must be issue or reject.');
  }
  return (await q(`${SELECT} where r.id = $1`, [id])).rows.map(label)[0];
}

/** Issue straight away, without a request (the student asked at the counter). */
export async function issueDirect(body = {}, admin, modules) {
  if (!TYPES[body.certType]) throw new HttpError(400, `Choose a certificate: ${Object.keys(TYPES).join(', ')}.`);
  const { rowCount } = await q('select 1 from students where id = $1', [body.studentId]);
  if (!rowCount) throw new HttpError(404, 'Student not found.');
  const purpose = str(body.purpose, 300, body.certType === 'transfer' ? 'Reason for leaving' : 'Purpose', true);
  const { rows: [row] } = await q(
    "insert into certificate_requests (student_id, cert_type, purpose, status, requested_by) values ($1, $2, $3, 'requested', $4) returning *",
    [body.studentId, body.certType, purpose, admin.id],
  );
  await issue(row, body, admin, modules);
  await tell(row.id, 'issued', '');
  return (await q(`${SELECT} where r.id = $1`, [row.id])).rows.map(label)[0];
}

/** Everything the PDF needs. A student may only fetch their own; `forStudentId` enforces that. */
export async function forPdf(id, { forStudentId } = {}) {
  const { rows: [r] } = await q(
    `select r.*, s.name, s.student_code as code, s.dob, s.gender, s.batch, s.semester, s.admission_date as "admissionDate", s.guardian, s.id as sid,
            c.name as course, c.full_name as "courseFull"
     from certificate_requests r join students s on s.id = r.student_id left join courses c on c.id = s.course_id where r.id = $1`, [id],
  );
  if (!r || (forStudentId && r.sid !== forStudentId)) throw new HttpError(404, 'Certificate not found.');
  if (r.status !== 'issued') throw new HttpError(409, 'This certificate has not been issued yet.');
  return r;
}

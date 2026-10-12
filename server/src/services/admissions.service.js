import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { isUuid, q, withTx } from '../db/pool.js';
import { HttpError } from '../middleware/error.js';
import { audit } from '../db/audit.js';
import { nextNumber } from '../db/series.js';
import { deleteFile, saveUpload } from './files.service.js';
import { env } from '../config/env.js';
import { sendSetupLink } from './accounts.service.js';
import { queueEmail, tenantInfo } from './notifications.service.js';
import { isISO, toISO } from '../utils/dates.js';
import * as gateway from './razorpay.service.js';

export const DOC_TYPES = ['photo', 'signature', 'id_proof', 'marksheet', 'other'];
export const REQUIRED_DOCS = ['photo', 'id_proof', 'marksheet'];
const EDITABLE = ['draft', 'documents_pending'];

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const DOC_NAME = { photo: 'passport-size photo', signature: 'signature', id_proof: 'ID proof', marksheet: 'previous marksheet', other: 'document' };

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

/** An error the form can act on: `code` says which step of the form to send the applicant back to. */
const stepError = (code, message) => Object.assign(new HttpError(400, message), { code });

const CATEGORIES = ['', 'General', 'OBC', 'SC', 'ST', 'EWS', 'Other'];
const num = (v, label) => {
  const s = str(v, 8, label);
  if (s && !/^\d{1,3}(\.\d{1,2})?$/.test(s)) throw new HttpError(400, `${label} must be a number, like 78.5.`);
  return s;
};

/**
 * Checks and tidies whatever the form sent. Missing parts become empty, so a half-filled draft is fine; the
 * parts that ARE sent must be valid. Whether the application is COMPLETE is checked on submit (see ensureComplete).
 */
function cleanAll(b = {}) {
  const email = str(b.email, 120, 'Email', true).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Enter a valid email address.');
  const hasDob = b.dob !== undefined && b.dob !== null && b.dob !== '';
  if (hasDob && (!isISO(b.dob) || b.dob >= toISO(new Date()))) throw new HttpError(400, 'Enter a valid date of birth.');
  const g = b.guardian || {};
  const e = b.previousEducation || {};
  const t = e.tenth || {};
  const p = b.personal || {};
  const x = b.entrance || {};
  const category = str(p.category, 20, 'Category');
  if (!CATEGORIES.includes(category)) throw new HttpError(400, 'Choose a category from the list.');
  return {
    courseId: b.courseId,
    name: str(b.name, 100, 'Full name', true),
    email,
    phone: str(b.phone, 20, 'Phone'),
    dob: hasDob ? b.dob : null,
    gender: str(b.gender, 20, 'Gender'),
    address: str(b.address, 300, 'Address'),
    personal: { nationality: str(p.nationality, 40, 'Nationality'), category, bloodGroup: str(p.bloodGroup, 5, 'Blood group') },
    guardian: {
      name: str(g.name, 100, 'Guardian name'), relation: str(g.relation, 30, 'Relation'), phone: str(g.phone, 20, 'Guardian phone'), email: str(g.email, 120, 'Guardian email'),
      fatherName: str(g.fatherName, 100, "Father's name"), motherName: str(g.motherName, 100, "Mother's name"), occupation: str(g.occupation, 80, 'Occupation'),
    },
    previousEducation: {
      institution: str(e.institution, 150, 'Institution'), qualification: str(e.qualification, 100, 'Qualification'), board: str(e.board, 100, 'Board / university'),
      year: str(e.year, 4, 'Year'), percentage: num(e.percentage, 'Percentage'),
      tenth: { board: str(t.board, 100, '10th board'), year: str(t.year, 4, '10th year'), percentage: num(t.percentage, '10th percentage') },
    },
    entrance: { exam: str(x.exam, 80, 'Entrance exam'), rollNo: str(x.rollNo, 40, 'Roll number'), score: str(x.score, 12, 'Score or rank') },
  };
}

/** The wizard's steps: which fields each one saves. Step 5 (documents) and 6 (review) save nothing here. */
const STEP_FIELDS = {
  1: ['courseId', 'name', 'email', 'phone'],
  2: ['dob', 'gender', 'address', 'personal'],
  3: ['guardian'],
  4: ['previousEducation', 'entrance'],
};
const COLUMN = {
  courseId: 'course_id', name: 'name', email: 'email', phone: 'phone', dob: 'dob', gender: 'gender', address: 'address',
  personal: 'personal', guardian: 'guardian', previousEducation: 'previous_education', entrance: 'entrance',
};
const asBody = (r) => ({
  courseId: r.course_id, name: r.name, email: r.email, phone: r.phone, dob: r.dob, gender: r.gender, address: r.address,
  personal: r.personal, guardian: r.guardian, previousEducation: r.previous_education, entrance: r.entrance,
});

/** Everything the office needs before it can look at an application. Names the step to fix. */
function ensureComplete(a) {
  if (!String(a.phone || '').trim()) throw stepError('STEP_COURSE', 'Enter a mobile number (step 1).');
  if (!a.dob) throw stepError('STEP_PERSONAL', 'Enter the date of birth (step 2).');
  if (!String(a.address || '').trim()) throw stepError('STEP_PERSONAL', 'Enter the address (step 2).');
  if (!String(a.guardian?.name || '').trim()) throw stepError('STEP_PARENTS', "Enter a parent or guardian's name (step 3).");
  if (!String(a.guardian?.phone || '').trim()) throw stepError('STEP_PARENTS', "Enter a parent or guardian's phone number (step 3).");
}

async function ensureCourse(courseId) {
  if (!isUuid(courseId)) throw new HttpError(400, 'Choose a valid course.');
  const { rowCount } = await q('select 1 from courses where id = $1', [courseId]);
  if (!rowCount) throw new HttpError(400, 'Choose a valid course.');
}

/* ---------------- settings ---------------- */

export async function getSettings() {
  const { rows: [s] } = await q('select application_fee, accepting, instructions from admission_settings');
  return { applicationFee: Number(s?.application_fee ?? 0), accepting: s?.accepting ?? true, instructions: s?.instructions ?? '' };
}

export async function updateSettings(body = {}, admin) {
  const fee = Number(body.applicationFee ?? 0);
  if (!Number.isFinite(fee) || fee < 0 || fee > 1_000_000) throw new HttpError(400, 'The application fee must be between 0 and 10,00,000.');
  const instructions = str(body.instructions, 2000, 'Instructions');
  await q(
    `insert into admission_settings (application_fee, accepting, instructions) values ($1, $2, $3)
     on conflict (tenant_id) do update set application_fee = $1, accepting = $2, instructions = $3, updated_at = now()`,
    [Math.round(fee * 100) / 100, body.accepting !== false, instructions],
  );
  await audit(admin, 'admission.settings', 'institute', null, { applicationFee: fee, accepting: body.accepting !== false });
  return getSettings();
}

/* ---------------- applicant side ---------------- */

export async function admissionsInfo() {
  const { rows: courses } = await q('select id, name, full_name as "fullName" from courses order by name');
  return {
    courses, requiredDocuments: REQUIRED_DOCS, documentTypes: DOC_TYPES, settings: await getSettings(), paymentsOnline: env.RAZORPAY_ENABLED,
  };
}

/**
 * Starts an application (step 1 of the form): a course, a name and an email are enough to make a private draft.
 * The access code is returned ONCE; only its hash is stored. Older clients may send the whole form in one go.
 */
export async function createApplication(body) {
  const settings = await getSettings();
  if (!settings.accepting) throw new HttpError(403, 'Applications are not being accepted right now.');
  const a = cleanAll(body);
  await ensureCourse(a.courseId);
  const accessCode = crypto.randomBytes(12).toString('base64url');
  const applicationNo = await nextNumber('application', { prefix: `APP${new Date().getFullYear()}-`, padding: 5 });
  const { rows: [r] } = await q(
    `insert into applications (application_no, course_id, name, email, phone, dob, gender, address, guardian, previous_education,
                               personal, entrance, access_hash, fee_amount, fee_status)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) returning id`,
    [applicationNo, a.courseId, a.name, a.email, a.phone, a.dob, a.gender, a.address, a.guardian, a.previousEducation,
      a.personal, a.entrance, sha(accessCode), settings.applicationFee, settings.applicationFee > 0 ? 'pending' : 'none'],
  );
  return { id: r.id, applicationNo, accessCode };
}

/**
 * Saves one step of the form (the applicant can leave and come back to it). `step` is the furthest step reached,
 * so reopening the form lands where the applicant stopped. Documents and payment are saved by their own calls.
 */
export async function saveStep(app, step, body = {}) {
  if (!EDITABLE.includes(app.status)) throw new HttpError(409, 'This application can no longer be changed.');
  const n = Number(step);
  if (!Number.isInteger(n) || n < 1 || n > 6) throw new HttpError(400, 'Step must be a number from 1 to 6.');
  const keys = STEP_FIELDS[n] || [];
  if (keys.length) {
    const merged = cleanAll({ ...asBody(app), ...Object.fromEntries(keys.filter((k) => body[k] !== undefined).map((k) => [k, body[k]])) });
    if (keys.includes('courseId')) await ensureCourse(merged.courseId);
    const sets = keys.map((k, i) => `${COLUMN[k]} = $${i + 2}`);
    try {
      await q(`update applications set ${sets.join(', ')} where id = $1`, [app.id, ...keys.map((k) => merged[k])]);
    } catch (err) {
      if (err.code === '23505') throw new HttpError(409, 'An application with this email already exists for this course.');
      throw err;
    }
  }
  await q('update applications set step = greatest(step, least($2, 6)) where id = $1', [app.id, n + 1]);
  const { rows: [fresh] } = await q('select * from applications where id = $1', [app.id]);
  return applicantView(fresh);
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
    step: app.step,
    form: {
      courseId: app.course_id, name: app.name, email: app.email, phone: app.phone, dob: app.dob, gender: app.gender, address: app.address,
      personal: app.personal, guardian: app.guardian, previousEducation: app.previous_education, entrance: app.entrance,
    },
    fee: { amount: Number(app.fee_amount), status: app.fee_status, paidAt: app.fee_paid_at, reference: app.fee_status === 'paid' ? app.fee_reference : '' },
    paymentsOnline: env.RAZORPAY_ENABLED,
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
  ensureComplete({ ...asBody(app) });
  const docs = await documentsOf(app.id);
  const missing = REQUIRED_DOCS.filter((t) => !docs.some((d) => d.docType === t));
  if (missing.length) throw stepError('STEP_DOCUMENTS', `Upload the required documents first: ${missing.join(', ')}.`);
  if (docs.some((d) => d.status === 'rejected')) throw stepError('STEP_DOCUMENTS', 'Replace the rejected documents before submitting again.');
  // With online payment switched on the fee is paid before submitting. Without it, the office collects the fee and
  // records it (an application cannot be accepted while the fee is still pending - see decide()).
  if (app.fee_status === 'pending' && env.RAZORPAY_ENABLED) throw stepError('STEP_PAYMENT', 'Pay the application fee to submit your application.');
  try {
    await q("update applications set status = 'submitted', step = 6, submitted_at = coalesce(submitted_at, now()) where id = $1", [app.id]);
  } catch (err) {
    if (err.code === '23505') throw new HttpError(409, 'An application with this email already exists for this course.');
    throw err;
  }
  if (app.status === 'draft') await notifyApplicant(app, 'applicationReceived');
  return applicantView({ ...app, status: 'submitted', step: 6 });
}

/* ---------------- application fee (online) ---------------- */

const toPaise = (rupees) => Math.round(Number(rupees) * 100);

export async function createFeeOrder(app) {
  if (!env.RAZORPAY_ENABLED) throw new HttpError(503, 'Online payment is not available. Please pay the fee at the institute office.');
  if (!EDITABLE.includes(app.status)) throw new HttpError(409, 'This application has already been submitted.');
  if (app.fee_status === 'paid' || app.fee_status === 'waived') throw new HttpError(409, 'The application fee is already settled.');
  if (app.fee_status !== 'pending') throw new HttpError(409, 'There is no application fee to pay.');
  const id = crypto.randomUUID();
  const order = await gateway.createOrder({
    amountPaise: toPaise(app.fee_amount), receipt: id,
    notes: { kind: 'application_fee', tenant_id: app.tenant_id, application_id: app.id, order_id: id },
  });
  await q('insert into application_fee_orders (id, application_id, amount, razorpay_order_id) values ($1, $2, $3, $4)',
    [id, app.id, app.fee_amount, order.id]);
  return {
    orderId: order.id, amount: Number(app.fee_amount), amountPaise: toPaise(app.fee_amount), currency: 'INR', keyId: env.RAZORPAY_KEY_ID,
    prefill: { name: app.name, email: app.email, contact: app.phone },
  };
}

/** The single place an application fee is marked paid online. Locked + idempotent, so the browser and the webhook can race safely. */
async function settleFee(order, paymentId, method) {
  if (order.status === 'paid') return { status: 'paid' };
  await q("update application_fee_orders set status = 'paid', razorpay_payment_id = $2, method = $3, paid_at = now() where id = $1", [order.id, paymentId, method ?? null]);
  const { rowCount } = await q(
    "update applications set fee_status = 'paid', fee_paid_at = now(), fee_reference = $2 where id = $1 and fee_status = 'pending'",
    [order.application_id, paymentId],
  );
  // The office settled it by hand while the applicant was paying: keep the evidence of the extra payment
  if (!rowCount) await audit({ id: null, role: 'webhook' }, 'admission.fee_paid_twice', 'application', order.application_id, { paymentId });
  return { status: 'paid' };
}

export async function verifyFee(app, { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature } = {}) {
  if (![orderId, paymentId, signature].every((v) => typeof v === 'string' && v)) throw new HttpError(400, 'Missing payment details.');
  if (!gateway.verifyCheckoutSignature({ orderId, paymentId, signature })) throw new HttpError(400, 'We could not verify this payment.');
  const { rows: [order] } = await q('select * from application_fee_orders where razorpay_order_id = $1 and application_id = $2 for update', [orderId, app.id]);
  if (!order) throw new HttpError(404, 'Payment not found.');
  let status = 'paid';
  if (order.status !== 'paid') {
    const pay = await gateway.fetchPayment(paymentId);
    if (pay.order_id !== orderId || Number(pay.amount) !== toPaise(order.amount)) throw new HttpError(409, 'This payment does not match the order.');
    if (pay.status === 'captured') await settleFee(order, paymentId, pay.method);
    else status = 'pending'; // the webhook settles it the moment it is captured
  }
  const { rows: [fresh] } = await q('select * from applications where id = $1', [app.id]);
  return { status, application: await applicantView(fresh) };
}

/** Razorpay calls us about an application-fee order (see onlinePayments.handleWebhook). */
export async function handleFeeWebhook(event, pay, notes) {
  if (!isUuid(notes?.tenant_id)) return { ignored: true };
  return withTx({ tenantId: notes.tenant_id }, async () => {
    const { rows: [order] } = await q('select * from application_fee_orders where razorpay_order_id = $1 for update', [pay.order_id]);
    if (!order) return { ignored: true };
    if (event.event === 'payment.failed') return { recorded: 'failed' };
    if (Number(pay.amount) !== toPaise(order.amount)) return { ignored: true };
    return settleFee(order, pay.id, pay.method);
  });
}

/* ---------------- admin side ---------------- */

const APP_SELECT = `
  select a.id, a.application_no as "applicationNo", a.name, a.email, a.phone, a.dob, a.gender, a.address, a.guardian,
         a.previous_education as "previousEducation", a.personal, a.entrance, a.status, a.submitted_at as "submittedAt", a.decided_at as "decidedAt",
         a.decision_note as "decisionNote", a.student_id as "studentId", a.created_at as "createdAt",
         a.source, a.fee_amount as "feeAmount", a.fee_status as "feeStatus", a.fee_paid_at as "feePaidAt", a.fee_reference as "feeReference",
         a.merit_score as "meritScore",
         c.name as course, a.course_id as "courseId",
         (select count(*) from application_documents d where d.application_id = a.id)::int as "documentCount"
  from applications a join courses c on c.id = a.course_id`;

/** The number the merit list ranks by: the office's own score if it set one, otherwise the qualifying percentage. */
export function meritValue(a) {
  if (a.meritScore !== null && a.meritScore !== undefined) return Number(a.meritScore);
  const p = Number.parseFloat(a.previousEducation?.percentage);
  return Number.isFinite(p) ? p : null;
}
const withMerit = (a) => ({ ...a, feeAmount: Number(a.feeAmount), meritScore: a.meritScore === null ? null : Number(a.meritScore), meritValue: meritValue(a) });

export async function listApplications({ status, search, courseId, fee } = {}) {
  const where = ["a.status <> 'draft'"];
  const params = [];
  if (status) { params.push(status); where.push(`a.status = $${params.length}`); }
  if (isUuid(courseId)) { params.push(courseId); where.push(`a.course_id = $${params.length}`); }
  if (fee === 'pending') where.push("a.fee_status = 'pending'");
  if (search) { params.push(`%${String(search).toLowerCase()}%`); where.push(`(lower(a.name) like $${params.length} or lower(a.email) like $${params.length} or lower(a.application_no) like $${params.length})`); }
  const { rows } = await q(`${APP_SELECT} where ${where.join(' and ')} order by a.submitted_at desc nulls last, a.created_at desc`, params);
  const { rows: counts } = await q("select status, count(*)::int as n from applications where status <> 'draft' group by status");
  const { rows: [extra] } = await q(
    `select count(*) filter (where fee_status = 'pending')::int as "feePending",
            count(*) filter (where status = 'draft')::int as drafts
     from applications`,
  );
  return { applications: rows.map(withMerit), counts: { ...Object.fromEntries(counts.map((c) => [c.status, c.n])), feePending: extra.feePending, drafts: extra.drafts } };
}

export async function getApplication(id) {
  const { rows: [a] } = await q(`${APP_SELECT} where a.id = $1 and a.status <> 'draft'`, [id]);
  if (!a) throw new HttpError(404, 'Application not found.');
  const { rows: docs } = await q(
    `select d.id, d.doc_type as "docType", d.status, d.remark, d.file_id as "fileId", f.original_name as name, f.mime, f.size_bytes as size
     from application_documents d join files f on f.id = d.file_id where d.application_id = $1 order by d.doc_type`, [id],
  );
  return { ...withMerit(a), documents: docs, requiredDocuments: REQUIRED_DOCS };
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
    if (app.fee_status === 'pending') throw new HttpError(409, 'The application fee has not been paid yet. Record it as paid (or waive it) before accepting.');
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

/* ---------------- the office: fee, merit, walk-ins, bulk decisions, merit list ---------------- */

/** The office collected the application fee at the counter, or decided not to charge it. */
export async function setFee(id, { action, reference } = {}, admin) {
  if (!['paid', 'waived'].includes(action)) throw new HttpError(400, 'Action must be paid or waived.');
  const ref = str(reference, 120, 'Reference');
  if (action === 'waived' && !ref) throw new HttpError(400, 'Say why the fee is being waived.');
  const { rows: [app] } = await q('select id, fee_status from applications where id = $1 for update', [id]);
  if (!app) throw new HttpError(404, 'Application not found.');
  if (app.fee_status !== 'pending') throw new HttpError(409, 'There is no pending fee on this application.');
  await q('update applications set fee_status = $2, fee_paid_at = now(), fee_reference = $3 where id = $1', [id, action, ref || 'Paid at the office']);
  await audit(admin, `admission.fee_${action}`, 'application', id, { reference: ref });
  return getApplication(id);
}

export async function setMerit(id, value, admin) {
  let score = null;
  if (value !== null && value !== undefined && value !== '') {
    score = Number(value);
    if (!Number.isFinite(score) || score < 0 || score > 1000) throw new HttpError(400, 'The merit score must be a number from 0 to 1000.');
    score = Math.round(score * 100) / 100;
  }
  const { rowCount } = await q("update applications set merit_score = $2 where id = $1 and status <> 'draft'", [id, score]);
  if (!rowCount) throw new HttpError(404, 'Application not found.');
  await audit(admin, 'admission.merit', 'application', id, { score });
  return getApplication(id);
}

/** A walk-in: the office types the form in for someone who came to the counter. It goes straight to review. */
export async function createWalkIn(body = {}, admin) {
  const a = cleanAll(body);
  await ensureCourse(a.courseId);
  ensureComplete(a);
  const settings = await getSettings();
  let feeStatus = settings.applicationFee > 0 ? 'pending' : 'none';
  let feeReference = '';
  if (settings.applicationFee > 0 && ['paid', 'waived'].includes(body.feeStatus)) {
    feeStatus = body.feeStatus;
    feeReference = str(body.feeReference, 120, 'Fee reference');
    if (feeStatus === 'waived' && !feeReference) throw new HttpError(400, 'Say why the fee is being waived.');
    feeReference ||= 'Paid at the office';
  }
  const accessCode = crypto.randomBytes(12).toString('base64url');
  const applicationNo = await nextNumber('application', { prefix: `APP${new Date().getFullYear()}-`, padding: 5 });
  let row;
  try {
    ({ rows: [row] } = await q(
      `insert into applications (application_no, course_id, name, email, phone, dob, gender, address, guardian, previous_education,
                                 personal, entrance, access_hash, status, step, submitted_at, source, fee_amount, fee_status, fee_paid_at, fee_reference)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'submitted', 6, now(), 'walk_in', $14, $15,
               case when $15 in ('paid', 'waived') then now() end, $16) returning id`,
      [applicationNo, a.courseId, a.name, a.email, a.phone, a.dob, a.gender, a.address, a.guardian, a.previousEducation,
        a.personal, a.entrance, sha(accessCode), settings.applicationFee, feeStatus, feeReference],
    ));
  } catch (err) {
    if (err.code === '23505') throw new HttpError(409, 'An application with this email already exists for this course.');
    throw err;
  }
  await notifyApplicant({ email: a.email, name: a.name, application_no: applicationNo }, 'applicationReceived');
  await audit(admin, 'admission.walk_in', 'application', row.id, { applicationNo });
  return { application: await getApplication(row.id), accessCode };
}

/** The office scans the originals at the counter: documents it uploads are already verified. */
export async function adminAttachDocument(id, docType, file, admin) {
  if (!DOC_TYPES.includes(docType)) throw new HttpError(400, `Document type must be one of: ${DOC_TYPES.join(', ')}.`);
  const { rows: [app] } = await q('select id, status from applications where id = $1 for update', [id]);
  if (!app || app.status === 'draft') throw new HttpError(404, 'Application not found.');
  if (!['submitted', 'documents_pending'].includes(app.status)) throw new HttpError(409, 'Documents can only be added before a decision.');
  if (docType !== 'other') {
    const { rows: [old] } = await q(
      `select d.id, d.file_id, f.storage_key from application_documents d join files f on f.id = d.file_id
       where d.application_id = $1 and d.doc_type = $2`, [id, docType],
    );
    if (old) {
      await q('delete from application_documents where id = $1', [old.id]);
      await deleteFile({ id: old.file_id, storage_key: old.storage_key });
    }
  }
  const saved = await saveUpload({ file, purpose: 'admission', user: admin });
  await q(
    "insert into application_documents (application_id, doc_type, file_id, status, verified_by, verified_at) values ($1, $2, $3, 'verified', $4, now())",
    [id, docType, saved.id, admin.id],
  );
  await audit(admin, 'admission.document_added', 'application', id, { docType });
  return getApplication(id);
}

/** Accept / waitlist / reject many at once. Each one is judged on its own; the ones that cannot be done say why. */
export async function bulkDecide({ ids, decision, note } = {}, admin) {
  if (!Array.isArray(ids) || !ids.length) throw new HttpError(400, 'Select at least one application.');
  if (ids.length > 200) throw new HttpError(400, 'Select 200 applications or fewer at a time.');
  if (!ids.every(isUuid)) throw new HttpError(400, 'One of the selected applications is not valid.');
  if (!['accept', 'reject', 'waitlist'].includes(decision)) throw new HttpError(400, 'Decision must be accept, reject or waitlist.');
  if (decision !== 'accept' && !String(note || '').trim()) throw new HttpError(400, 'Add a note explaining the decision.');
  const done = []; const failed = [];
  for (const id of [...new Set(ids)]) {
    await q('savepoint bulk_item');
    try {
      await decide(id, { decision, note }, admin);
      await q('release savepoint bulk_item');
      done.push(id);
    } catch (err) {
      await q('rollback to savepoint bulk_item');
      if (!(err instanceof HttpError)) throw err;
      const { rows: [a] } = await q('select application_no from applications where id = $1', [id]);
      failed.push({ id, applicationNo: a?.application_no ?? id, reason: err.message });
    }
  }
  return { done, failed };
}

/** Applicants ranked within their course: best merit first, earlier applications first among equals. */
export async function meritList({ courseId } = {}) {
  const params = []; let where = "a.status in ('submitted', 'documents_pending', 'accepted', 'waitlisted', 'enrolled')";
  if (isUuid(courseId)) { params.push(courseId); where += ` and a.course_id = $${params.length}`; }
  const { rows } = await q(`${APP_SELECT} where ${where} order by c.name, a.submitted_at nulls last`, params);
  const byCourse = new Map();
  for (const a of rows.map(withMerit)) {
    if (!byCourse.has(a.course)) byCourse.set(a.course, []);
    byCourse.get(a.course).push(a);
  }
  const out = [];
  for (const [course, list] of byCourse) {
    list.sort((x, y) => (y.meritValue ?? -1) - (x.meritValue ?? -1));
    let rank = 0; let prev = null;
    list.forEach((a, i) => {
      if (a.meritValue !== prev) { rank = i + 1; prev = a.meritValue; }
      out.push({
        rank, course, applicationNo: a.applicationNo, name: a.name, merit: a.meritValue, category: a.personal?.category || '',
        entrance: [a.entrance?.exam, a.entrance?.score].filter(Boolean).join(' - '), status: a.status, phone: a.phone, email: a.email,
      });
    });
  }
  return out;
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

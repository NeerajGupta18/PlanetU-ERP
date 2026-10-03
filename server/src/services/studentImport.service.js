/**
 * Bulk student import from a CSV file.
 *
 *   analyse(buffer)  reads and validates every row WITHOUT writing anything (the preview)
 *   importStudents() validates again on the server (a client's preview is never trusted), then creates the
 *                    students - and, optionally, their logins and "set your password" emails - in ONE
 *                    transaction: either every accepted row is created, or none are.
 *
 * Accounts follow the same model as enrolment from Admissions: the login ID is the student ID, the account is
 * flagged "must change password", and the student gets an emailed single-use link to choose a password. An
 * import does not generate 500 temporary passwords; it creates each login with a password nobody knows and
 * relies on that link (or "Forgot password" later).
 */
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { q } from '../db/pool.js';
import { HttpError } from '../middleware/error.js';
import { audit } from '../db/audit.js';
import { nextNumber } from '../db/series.js';
import { parseCsv } from '../utils/csvParse.js';
import { csvCell } from '../utils/csv.js';
import { sendSetupLink } from './accounts.service.js';
import { toISO } from '../utils/dates.js';

export const IMPORT_LIMITS = { maxRows: 2000, maxBytes: 2 * 1024 * 1024 };
const SETUP_LINK_HOURS = 7 * 24; // an onboarding batch is not acted on within 72 hours

/* Column definitions: key, label for the template, and the header spellings we accept. */
export const COLUMNS = [
  { key: 'name', label: 'name', required: true, aliases: ['fullname', 'studentname', 'nameofstudent'] },
  { key: 'email', label: 'email', required: true, aliases: ['emailid', 'emailaddress', 'studentemail', 'mail'] },
  { key: 'course', label: 'course', required: true, aliases: ['coursecode', 'coursename', 'class', 'programme', 'program', 'branch', 'standard'] },
  { key: 'semester', label: 'semester', aliases: ['sem', 'term', 'year'] },
  { key: 'section', label: 'section', aliases: ['division', 'div'] },
  { key: 'studentCode', label: 'student_id', aliases: ['studentcode', 'prn', 'studentno', 'admissionno', 'regno', 'registrationno', 'id'] },
  { key: 'rollNo', label: 'roll_no', aliases: ['rollnumber', 'roll', 'rollno'] },
  { key: 'enrollmentNo', label: 'enrollment_no', aliases: ['enrolmentno', 'enrollmentnumber', 'enrolmentnumber', 'enrollment', 'enrolment'] },
  { key: 'phone', label: 'phone', aliases: ['mobile', 'mobileno', 'phoneno', 'contact', 'contactno', 'phonenumber', 'mobilenumber'] },
  { key: 'dob', label: 'date_of_birth', aliases: ['dob', 'birthdate', 'dateofbirth'] },
  { key: 'gender', label: 'gender', aliases: ['sex'] },
  { key: 'bloodGroup', label: 'blood_group', aliases: ['bloodgroup', 'bloodtype'] },
  { key: 'nationality', label: 'nationality', aliases: [] },
  { key: 'batch', label: 'batch', aliases: ['academicyear', 'session'] },
  { key: 'admissionDate', label: 'admission_date', aliases: ['dateofadmission', 'admitted', 'doa'] },
  { key: 'address', label: 'address', aliases: ['residentialaddress', 'homeaddress'] },
  { key: 'guardianName', label: 'guardian_name', aliases: ['parentname', 'fathername', 'guardian', 'parent'] },
  { key: 'guardianRelation', label: 'guardian_relation', aliases: ['relation', 'relationship', 'parentrelation'] },
  { key: 'guardianPhone', label: 'guardian_phone', aliases: ['parentphone', 'parentmobile', 'guardianmobile', 'fatherphone'] },
  { key: 'guardianEmail', label: 'guardian_email', aliases: ['parentemail', 'guardianmail'] },
  { key: 'status', label: 'status', aliases: ['studentstatus'] },
];

const squash = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
const HEADER_LOOKUP = (() => {
  const m = new Map();
  for (const c of COLUMNS) for (const k of [c.key, c.label, ...c.aliases]) m.set(squash(k), c.key);
  return m;
})();

const STATUSES = ['Active', 'Inactive', 'Alumni'];
const BLOOD = new Set(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']);
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const CODE_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

/* ------------------------------------------------------------------ date parsing */

const realDate = (y, m, d) => {
  if (y < 1900 || y > 9999 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d ? toISO(dt) : null;
};

/**
 * Accepts 2005-03-14, 14/03/2005, 14-03-2005, 14.03.2005 (day first, the Indian convention) and 14-Mar-2005 /
 * 14 March 2005. Two-digit years are refused because 05 could mean 1905 or 2005.
 */
export function parseDate(text) {
  const s = String(text).trim();
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) return realDate(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (m) return realDate(+m[3], +m[2], +m[1]);
  m = s.match(/^(\d{1,2})[\s-]+([A-Za-z]{3,9})[\s,-]+(\d{4})$/);
  if (m) {
    const mi = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase());
    return mi < 0 ? null : realDate(+m[3], mi + 1, +m[1]);
  }
  return null;
}

/* ------------------------------------------------------------------ reading the file */

function decode(buffer) {
  if (buffer.length >= 2 && buffer[0] === 0x50 && buffer[1] === 0x4b) {
    throw new HttpError(400, 'That looks like an Excel workbook, not a CSV. In Excel choose File > Save As > "CSV UTF-8 (Comma delimited)" and upload that file.');
  }
  if (buffer.includes(0)) throw new HttpError(400, 'That file is not a text CSV file.');
  let text = buffer.toString('utf8');
  let note = null;
  if (text.includes('\uFFFD')) {
    // Excel's plain "CSV" is Windows-1252, not UTF-8; reading it as UTF-8 would garble every accented name
    text = new TextDecoder('windows-1252').decode(buffer);
    note = 'The file was not UTF-8, so it was read as Windows-1252 (Excel\'s plain CSV). Check that accented names look right.';
  }
  return { text, note };
}

function mapHeader(cells) {
  const seen = new Map(); const unknown = []; const dupes = [];
  cells.forEach((raw, i) => {
    const h = String(raw).trim();
    if (!h) return;
    const key = HEADER_LOOKUP.get(squash(h));
    if (!key) { unknown.push(h); return; }
    if (seen.has(key)) dupes.push(h); else seen.set(key, i);
  });
  return { columns: seen, unknown, dupes };
}

/* ------------------------------------------------------------------ row validation */

const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const tooLong = (v, max, label, errors) => { if (v.length > max) errors.push(`${label} is too long (${max} characters at most).`); };

function cleanPhone(v, label, errors) {
  const raw = clean(v);
  if (!raw) return '';
  if (/^\d(\.\d+)?e\+?\d+$/i.test(raw)) {
    errors.push(`${label} "${raw}" looks like Excel turned it into scientific notation. Format the column as Text in Excel and re-save.`);
    return '';
  }
  const digits = raw.replace(/[\s().-]/g, '');
  if (!/^\+?\d{7,15}$/.test(digits)) { errors.push(`${label} "${raw}" is not a valid phone number (7 to 15 digits).`); return ''; }
  return digits;
}

function pickCourse(text, courses, errors) {
  const t = clean(text).toLowerCase();
  if (!t) { errors.push('Course is required.'); return null; }
  const byCode = courses.filter((c) => c.code.toLowerCase() === t);
  if (byCode.length === 1) return byCode[0];
  const byName = courses.filter((c) => c.name.toLowerCase() === t || (c.fullName || '').toLowerCase() === t);
  if (byName.length === 1) return byName[0];
  if (byName.length > 1) { errors.push(`"${clean(text)}" matches more than one course. Use the course code instead.`); return null; }
  const known = courses.slice(0, 8).map((c) => c.code).join(', ');
  errors.push(`Unknown course "${clean(text)}". Use a course code or name that exists here${known ? ` (for example: ${known})` : ''}.`);
  return null;
}

/** Validates one raw row (an object keyed by our column keys) and returns normalised values + messages. */
function validateRow(raw, ctx) {
  const errors = []; const warnings = [];
  const v = {};

  v.name = clean(raw.name);
  if (!v.name) errors.push('Name is required.'); else tooLong(v.name, 120, 'Name', errors);

  v.email = clean(raw.email).toLowerCase();
  if (!v.email) errors.push('Email is required.');
  else if (!EMAIL_RE.test(v.email) || v.email.length > 200) errors.push(`"${v.email}" is not a valid email address.`);

  const course = pickCourse(raw.course, ctx.courses, errors);
  v.courseId = course?.id ?? null; v.courseName = course?.name ?? clean(raw.course);

  const sem = clean(raw.semester);
  if (!sem) v.semester = 1;
  else {
    const m = sem.match(/^(?:sem(?:ester)?\s*)?(\d{1,2})(?:st|nd|rd|th)?$/i);
    v.semester = m ? Number(m[1]) : NaN;
    if (!(v.semester >= 1 && v.semester <= 20)) { errors.push(`Semester "${sem}" must be a whole number from 1 to 20.`); v.semester = 1; }
  }

  v.section = clean(raw.section); tooLong(v.section, 20, 'Section', errors);
  v.rollNo = clean(raw.rollNo); tooLong(v.rollNo, 40, 'Roll no.', errors);
  v.enrollmentNo = clean(raw.enrollmentNo); tooLong(v.enrollmentNo, 60, 'Enrollment no.', errors);
  v.batch = clean(raw.batch); tooLong(v.batch, 40, 'Batch', errors);
  v.address = clean(raw.address); tooLong(v.address, 300, 'Address', errors);
  v.nationality = clean(raw.nationality); tooLong(v.nationality, 40, 'Nationality', errors);

  v.studentCode = clean(raw.studentCode);
  if (v.studentCode) {
    if (v.studentCode.length > 40 || !CODE_RE.test(v.studentCode)) errors.push(`Student ID "${v.studentCode}" may only use letters, digits and . _ / - (40 characters at most).`);
  }

  v.phone = cleanPhone(raw.phone, 'Phone', errors);

  const dob = clean(raw.dob);
  v.dob = null;
  if (dob) {
    const iso = parseDate(dob);
    if (!iso) errors.push(`Date of birth "${dob}" is not a valid date. Use YYYY-MM-DD or DD/MM/YYYY.`);
    else if (iso > toISO(new Date())) errors.push(`Date of birth ${iso} is in the future.`);
    else v.dob = iso;
  }
  const adm = clean(raw.admissionDate);
  v.admissionDate = null;
  if (adm) {
    const iso = parseDate(adm);
    if (!iso) errors.push(`Admission date "${adm}" is not a valid date. Use YYYY-MM-DD or DD/MM/YYYY.`); else v.admissionDate = iso;
  }

  const g = clean(raw.gender).toLowerCase();
  v.gender = '';
  if (g) {
    if (['m', 'male', 'man', 'boy'].includes(g)) v.gender = 'Male';
    else if (['f', 'female', 'woman', 'girl'].includes(g)) v.gender = 'Female';
    else if (['o', 'other', 'others', 'non-binary', 'nonbinary', 'x'].includes(g)) v.gender = 'Other';
    else errors.push(`Gender "${clean(raw.gender)}" must be Male, Female or Other.`);
  }

  const bg = clean(raw.bloodGroup).toUpperCase().replace(/\s+/g, '').replace(/POSITIVE$/, '+').replace(/NEGATIVE$/, '-');
  v.bloodGroup = '';
  if (bg) { if (BLOOD.has(bg)) v.bloodGroup = bg; else errors.push(`Blood group "${clean(raw.bloodGroup)}" is not valid (A+, A-, B+, B-, AB+, AB-, O+ or O-).`); }

  const st = clean(raw.status);
  v.status = 'Active';
  if (st) {
    const hit = STATUSES.find((s) => s.toLowerCase() === st.toLowerCase());
    if (hit) v.status = hit; else errors.push(`Status "${st}" must be one of: ${STATUSES.join(', ')}.`);
  }

  const guardian = {
    name: clean(raw.guardianName), relation: clean(raw.guardianRelation),
    phone: cleanPhone(raw.guardianPhone, 'Guardian phone', errors), email: clean(raw.guardianEmail).toLowerCase(),
  };
  if (guardian.email && !EMAIL_RE.test(guardian.email)) { errors.push(`Guardian email "${guardian.email}" is not valid.`); guardian.email = ''; }
  tooLong(guardian.name, 120, 'Guardian name', errors);
  v.guardian = Object.fromEntries(Object.entries(guardian).filter(([, x]) => x));

  return { values: v, errors, warnings };
}

/* ------------------------------------------------------------------ analyse (preview) */

/**
 * Reads and validates the whole file. Nothing is written. Returns
 *   { rows: [{ line, values, errors, warnings }], summary, columns, unknownColumns, notes }
 * or throws a 400 for problems with the file itself (no header, missing required columns, too many rows).
 */
export async function analyse(buffer, { createLogins = true } = {}) {
  if (!buffer?.length) throw new HttpError(400, 'The file is empty.');
  if (buffer.length > IMPORT_LIMITS.maxBytes) throw new HttpError(413, `That file is too large (${IMPORT_LIMITS.maxBytes / 1024 / 1024} MB at most).`);
  const { text, note } = decode(buffer);
  let parsed;
  try { parsed = parseCsv(text); } catch (err) { throw new HttpError(400, err.message); }
  if (!parsed.rows.length) throw new HttpError(400, 'The file has no rows.');

  const [head, ...body] = parsed.rows;
  const { columns, unknown, dupes } = mapHeader(head.cells);
  const missing = COLUMNS.filter((c) => c.required && !columns.has(c.key)).map((c) => c.label);
  if (missing.length) {
    throw new HttpError(400, `The first row must be a header containing: ${missing.join(', ')}. Download the template to see the expected columns.`);
  }
  if (!body.length) throw new HttpError(400, 'The file has a header but no student rows.');
  if (body.length > IMPORT_LIMITS.maxRows) {
    throw new HttpError(400, `That file has ${body.length} students. Import at most ${IMPORT_LIMITS.maxRows} at a time - split the file and upload it in parts.`);
  }

  const { rows: courseRows } = await q('select id, code, name, full_name as "fullName" from courses order by code');
  const objects = body.map((r) => {
    const o = {};
    for (const [key, idx] of columns) o[key] = r.cells[idx] ?? '';
    return { line: r.line, raw: o, extra: r.cells.length > head.cells.length && r.cells.slice(head.cells.length).some((c) => c.trim()) };
  });

  const results = objects.map((o) => {
    const r = validateRow(o.raw, { courses: courseRows });
    if (o.extra) r.warnings.push('This row has more values than the header has columns; the extra values were ignored.');
    return { line: o.line, ...r };
  });

  // Uniqueness: within the file, then against what already exists in this institute
  const codes = results.map((r) => r.values.studentCode).filter(Boolean).map((c) => c.toLowerCase());
  const emails = results.map((r) => r.values.email).filter(Boolean);
  // One at a time: a request's transaction is a single connection, which cannot run queries in parallel
  const { rows: haveCodes } = await q('select lower(student_code) as v from students where lower(student_code) = any($1::text[])', [codes]);
  const { rows: haveUsers } = await q('select lower(email) as v from users where lower(email) = any($1::text[])', [emails]);
  const { rows: haveStudents } = await q('select lower(email) as v from students where lower(email) = any($1::text[])', [emails]);
  const existingCodes = new Set(haveCodes.map((r) => r.v));
  const existingEmails = new Set([...haveUsers, ...haveStudents].map((r) => r.v));

  const firstCode = new Map(); const firstEmail = new Map(); const rollSeen = new Map();
  for (const r of results) {
    const v = r.values;
    if (v.studentCode) {
      const k = v.studentCode.toLowerCase();
      if (firstCode.has(k)) r.errors.push(`Student ID ${v.studentCode} is repeated (first on line ${firstCode.get(k)}).`);
      else firstCode.set(k, r.line);
      if (existingCodes.has(k)) r.errors.push(`A student with ID ${v.studentCode} already exists.`);
    }
    if (v.email) {
      // With logins each student needs their own email (it is the key for password reset); without logins
      // siblings may share a parent's address, so a repeat is only worth a warning.
      const report = createLogins ? r.errors : r.warnings;
      if (firstEmail.has(v.email)) report.push(`Email ${v.email} is repeated (first on line ${firstEmail.get(v.email)}).`);
      else firstEmail.set(v.email, r.line);
      if (existingEmails.has(v.email)) report.push(`Email ${v.email} is already used by an existing student or account.`);
    }
    if (v.rollNo && v.courseId) {
      const k = `${v.courseId}|${v.semester}|${v.section.toLowerCase()}|${v.rollNo.toLowerCase()}`;
      if (rollSeen.has(k)) r.warnings.push(`Roll no. ${v.rollNo} is also used on line ${rollSeen.get(k)} for the same class.`);
      else rollSeen.set(k, r.line);
    }
  }

  const bad = results.filter((r) => r.errors.length);
  return {
    rows: results,
    columns: [...columns.keys()],
    unknownColumns: unknown,
    notes: [note, dupes.length ? `Column${dupes.length > 1 ? 's' : ''} ${dupes.join(', ')} appear${dupes.length > 1 ? '' : 's'} more than once; the first was used.` : null].filter(Boolean),
    summary: {
      rows: results.length, ready: results.length - bad.length, withErrors: bad.length,
      withWarnings: results.filter((r) => !r.errors.length && r.warnings.length).length,
      autoIds: results.filter((r) => !r.errors.length && !r.values.studentCode).length,
    },
  };
}

/** What the preview screen needs per row (it does not need every normalised value). */
export const previewRow = (r) => ({
  line: r.line, name: r.values.name, email: r.values.email, course: r.values.courseName, semester: r.values.semester,
  studentCode: r.values.studentCode || null, status: r.values.status, ok: r.errors.length === 0, errors: r.errors, warnings: r.warnings,
});

/* ------------------------------------------------------------------ commit */

async function freshCode(used) {
  for (let i = 0; i < 1000; i += 1) {
    const code = await nextNumber('prn', { prefix: 'PRN', padding: 7 });
    const k = code.toLowerCase();
    if (used.has(k)) continue;
    const { rowCount } = await q('select 1 from students where lower(student_code) = $1', [k]);
    if (!rowCount) { used.add(k); return code; }
  }
  throw new HttpError(500, 'Could not allocate a free student ID. Check the "prn" number series.');
}

export async function importStudents(buffer, { createLogins = true, sendEmails = true, skipInvalid = false, fileName = '' } = {}, admin) {
  const a = await analyse(buffer, { createLogins });
  const bad = a.rows.filter((r) => r.errors.length);
  if (bad.length && !skipInvalid) {
    throw new HttpError(409, `${bad.length} row${bad.length === 1 ? ' has' : 's have'} problems, so nothing was imported. Fix them and upload again, or choose to skip the rows with problems.`);
  }
  const good = a.rows.filter((r) => !r.errors.length);
  if (!good.length) throw new HttpError(400, 'There are no valid rows to import.');

  // Explicit IDs in this file must not be handed out as generated ones
  const used = new Set(good.map((r) => r.values.studentCode.toLowerCase()).filter(Boolean));
  const lockedHash = createLogins ? await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10) : null; // nobody knows this password
  const outcome = new Map();
  let emails = 0;

  for (const r of good) {
    const v = r.values;
    const code = v.studentCode || await freshCode(used);
    let student;
    try {
      ({ rows: [student] } = await q(
        `insert into students (student_code, roll_no, enrollment_no, name, email, phone, dob, gender, blood_group, nationality,
                               course_id, semester, section, batch, admission_date, status, address, guardian)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18) returning id`,
        [code, v.rollNo, v.enrollmentNo || code, v.name, v.email, v.phone, v.dob, v.gender, v.bloodGroup, v.nationality,
          v.courseId, v.semester, v.section, v.batch, v.admissionDate, v.status, v.address, JSON.stringify(v.guardian)],
      ));
    } catch (err) {
      if (err.code === '23505') throw new HttpError(409, `Line ${r.line}: a student with ID ${code} already exists (it may have been added while you were importing). Nothing was imported.`);
      throw err;
    }
    if (createLogins) {
      const active = v.status === 'Active';
      try {
        const { rows: [u] } = await q(
          `insert into users (role, login_id, email, name, password_hash, student_id, must_change_password, status)
           values ('student', $1, $2, $3, $4, $5, true, $6) returning id`,
          [code, v.email, v.name, lockedHash, student.id, active ? 'active' : 'disabled'],
        );
        if (sendEmails && active) { await sendSetupLink({ id: u.id, name: v.name, email: v.email, loginId: code }, SETUP_LINK_HOURS); emails += 1; }
      } catch (err) {
        if (err.code === '23505') throw new HttpError(409, `Line ${r.line}: another account already uses ${v.email} (or the ID ${code}). Nothing was imported.`);
        throw err;
      }
    }
    outcome.set(r.line, code);
  }

  await audit(admin, 'students.import', 'student', null, {
    file: String(fileName).slice(0, 100), created: good.length, skipped: bad.length, createLogins, emailsQueued: emails,
  });

  return {
    created: good.length, skipped: bad.length, emailsQueued: emails, createLogins,
    rows: a.rows.map((r) => ({
      line: r.line, name: r.values.name, email: r.values.email,
      status: r.errors.length ? 'skipped' : 'created', studentCode: outcome.get(r.line) || null, reason: r.errors.join(' '),
    })),
  };
}

/* ------------------------------------------------------------------ template */

export async function templateCsv() {
  const { rows: [c] } = await q('select code from courses order by code limit 1');
  const course = c?.code || 'COURSE-CODE';
  const header = COLUMNS.map((x) => x.label);
  const samples = [
    { name: 'Asha Patil', email: 'asha.patil@example.com', course, semester: '1', section: 'A', student_id: '', roll_no: '1', enrollment_no: '', phone: '9876543210',
      date_of_birth: '2006-05-14', gender: 'Female', blood_group: 'B+', nationality: 'Indian', batch: '2025 - 2028', admission_date: '2025-07-01', address: '12 MG Road, Pune',
      guardian_name: 'Ramesh Patil', guardian_relation: 'Father', guardian_phone: '9876500000', guardian_email: 'ramesh.patil@example.com', status: 'Active' },
    { name: 'Vikram Rao', email: 'vikram.rao@example.com', course, semester: '1', section: 'A', student_id: '', roll_no: '2', enrollment_no: '', phone: '',
      date_of_birth: '14/08/2005', gender: 'Male', blood_group: '', nationality: 'Indian', batch: '2025 - 2028', admission_date: '01/07/2025', address: '',
      guardian_name: '', guardian_relation: '', guardian_phone: '', guardian_email: '', status: 'Active' },
  ];
  const lines = [header.map(csvCell).join(',')];
  for (const s of samples) lines.push(header.map((h) => csvCell(s[h] ?? '')).join(','));
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}


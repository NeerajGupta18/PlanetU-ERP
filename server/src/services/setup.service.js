/**
 * Institute setup.
 *
 *   setupStatus()   the short checklist on a new institute's admin dashboard (each step links to its page).
 *   wizard()        the seven-step setup wizard (config/processes.js "setup"): where each step stands, with the
 *                   numbers the wizard shows. The vendor console uses setupProgress() to watch every client.
 *
 * The wizard's own settings (brand colour, logo, academic year, divisions, subjects, sample data) live on the
 * institute profile under the hidden `details._setup` key, so no migration is needed and the "label: value"
 * details list on the Institute page never shows them.
 */
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { isUuid, q } from '../db/pool.js';
import { HttpError } from '../middleware/error.js';
import { audit } from '../db/audit.js';
import { nextNumber } from '../db/series.js';
import { sendSetupLink } from './accounts.service.js';
import { inviteAll as inviteAllParents } from './parents.service.js';
import { usageOf } from './courses.service.js';

const STEPS = [
  { key: 'institute', label: 'Fill in the institute\'s address, phone and email', to: '/admin/institute', sql: "select (coalesce(address, '') <> '' and coalesce(phone, '') <> '' and coalesce(email, '') <> '') as done from institute_profiles" },
  { key: 'departments', label: 'Add departments and designations', to: '/admin/departments', sql: 'select (select count(*) from departments) > 0 and (select count(*) from designations) > 0 as done' },
  { key: 'courses', label: 'Add the courses or classes you teach', to: '/admin/courses', sql: 'select count(*) > 0 as done from courses' },
  { key: 'employees', label: 'Add staff and give them logins', to: '/admin/employees', sql: 'select count(*) > 0 as done from employees' },
  { key: 'timetable', module: 'timetable', label: 'Build the weekly timetable', to: '/admin/timetable', sql: 'select count(*) > 0 as done from timetable_slots' },
  { key: 'fees', module: 'fees', label: 'Create a fee structure', to: '/admin/fees?tab=structures', sql: 'select count(*) > 0 as done from fee_structures' },
  { key: 'students', module: 'students', label: 'Import or enrol students', to: '/admin/students/import', sql: 'select count(*) > 0 as done from students' },
  { key: 'leave', module: 'leave', label: 'Set up leave types', to: '/admin/leave?tab=types', sql: 'select count(*) > 0 as done from leave_types' },
];

export async function setupStatus(modules = []) {
  const steps = [];
  for (const s of STEPS) {
    if (s.module && !modules.includes(s.module)) continue;
    const { rows: [r] } = await q(s.sql);
    steps.push({ key: s.key, label: s.label, to: s.to, done: Boolean(r?.done) });
  }
  const done = steps.filter((s) => s.done).length;
  return { steps, done, total: steps.length, complete: done === steps.length };
}

/* ------------------------------------------------------------------ the wizard's stored settings */

/** Sample records carry these codes, so they can be told apart from real ones and removed in one go. */
export const SAMPLE_COURSE = 'SAMPLE';
const SAMPLE_PREFIX = 'SAMPLE-';
const SAMPLE_LIKE = `${SAMPLE_PREFIX}%`;

async function readSetup({ lock = false } = {}) {
  const { rows: [r] } = await q(`select coalesce(details->'_setup', '{}'::jsonb) as s from institute_profiles${lock ? ' for update' : ''}`);
  if (!r) throw new HttpError(404, 'The institute profile is missing. Contact PlanetU support.');
  return r.s;
}

/** Merges `patch` into the stored settings; a key set to undefined is removed. */
async function writeSetup(patch) {
  const cur = await readSetup({ lock: true });
  const next = { ...cur };
  for (const [k, v] of Object.entries(patch)) { if (v === undefined) delete next[k]; else next[k] = v; }
  await q("update institute_profiles set details = jsonb_set(coalesce(details, '{}'::jsonb), '{_setup}', $1::jsonb)", [JSON.stringify(next)]);
  return next;
}

/* ------------------------------------------------------------------ step 1: profile, colour and logo */

const HEX_RE = /^#[0-9a-f]{6}$/i;
const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
/** Contrast of white text on this colour (buttons and the selected menu item use white text on the brand colour). */
export const contrastWithWhite = (hex) => 1.05 / (luminance(hex) + 0.05);

export async function saveBrand(admin, { brandColor } = {}) {
  let color;
  if (brandColor === null || brandColor === '') color = undefined; // back to the PlanetU navy
  else {
    color = String(brandColor ?? '').trim();
    if (!HEX_RE.test(color)) throw new HttpError(400, 'Choose a colour with the picker, or type it as # and six letters or digits (for example #1E3A5F).');
    if (contrastWithWhite(color) < 4.5) {
      throw new HttpError(400, 'That colour is too light: white writing on it would be hard to read. Choose a darker shade of it.');
    }
    color = color.toUpperCase();
  }
  await writeSetup({ brandColor: color });
  await audit(admin, 'setup.brand', 'institute', null, { brandColor: color || null });
  return { brandColor: color || null };
}

export const LOGO_MAX_BYTES = 300 * 1024;
const LOGO_TYPES = {
  'image/png': (b) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  'image/jpeg': (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
};

/** The logo is uploaded as a file. PNG or JPEG only (told apart by their first bytes): they also print on receipts. */
export async function saveLogo(admin, bytes) {
  if (!bytes?.length) throw new HttpError(400, 'Choose a picture of your logo (PNG or JPG).');
  const type = Object.keys(LOGO_TYPES).find((t) => LOGO_TYPES[t](bytes));
  if (!type) throw new HttpError(400, 'The logo must be a PNG or JPG picture. Open it, save it as PNG, and choose it again.');
  if (bytes.length > LOGO_MAX_BYTES) throw new HttpError(413, `That picture is ${Math.ceil(bytes.length / 1024)} KB. Use one under ${LOGO_MAX_BYTES / 1024} KB (a 512 x 512 PNG is plenty).`);
  const version = crypto.randomBytes(6).toString('hex');
  await writeSetup({ logo: { type, data: bytes.toString('base64'), version } });
  await audit(admin, 'setup.logo', 'institute', null, { bytes: bytes.length });
  return { logoVersion: version };
}

export async function removeLogo(admin) {
  await writeSetup({ logo: undefined });
  await audit(admin, 'setup.logo_remove', 'institute');
  return { logoVersion: null };
}

/** The divisions (A, B, C...) saved for one class in step 3, or [] when it has none. */
export async function divisionsOf(courseId) {
  const { divisions = {} } = await readSetup();
  return divisions[courseId] || [];
}

/** { type, bytes } of the institute's logo, or null. */
export async function logoOf() {
  const { logo } = await readSetup();
  return logo?.data ? { type: logo.type, bytes: Buffer.from(logo.data, 'base64'), version: logo.version } : null;
}

/* ------------------------------------------------------------------ step 2: academic year */

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function saveYear(admin, { name, start, end } = {}) {
  if (!ISO_RE.test(start || '') || !ISO_RE.test(end || '')) throw new HttpError(400, 'Choose the first and the last day of the academic year.');
  if (end <= start) throw new HttpError(400, 'The last day must come after the first day.');
  const days = (new Date(end) - new Date(start)) / 86400000;
  if (days > 550) throw new HttpError(400, 'An academic year can be at most 18 months long. Check the two dates.');
  const label = String(name || '').trim() || `${start.slice(0, 4)}-${end.slice(2, 4)}`;
  if (label.length > 20) throw new HttpError(400, 'Keep the name short, for example 2026-27.');
  const academicYear = { name: label, start, end };
  await writeSetup({ academicYear });
  await audit(admin, 'setup.year', 'institute', null, academicYear);
  return { academicYear };
}

/* ------------------------------------------------------------------ step 3: divisions of each class */

export async function saveDivisions(admin, courseId, { divisions } = {}) {
  if (!isUuid(courseId) || !(await q('select 1 from courses where id = $1', [courseId])).rowCount) throw new HttpError(404, 'That class was not found. Reload the page.');
  const list = [...new Set(String(Array.isArray(divisions) ? divisions.join(',') : divisions || '')
    .split(',').map((d) => d.trim()).filter(Boolean))];
  if (list.length > 26) throw new HttpError(400, 'A class can have at most 26 divisions.');
  if (list.some((d) => d.length > 20)) throw new HttpError(400, 'Keep each division name short (20 characters at most), for example A, B, C.');
  const cur = await readSetup({ lock: true });
  const all = { ...(cur.divisions || {}) };
  if (list.length) all[courseId] = list; else delete all[courseId];
  await writeSetup({ divisions: all });
  await audit(admin, 'setup.divisions', 'course', courseId, { divisions: list });
  return { divisions: list };
}

/* ------------------------------------------------------------------ step 4: subjects and faculty */

const MAX_SUBJECTS = 400;

export async function addSubject(admin, { courseId, name, teacherId } = {}) {
  if (!isUuid(courseId) || !(await q('select 1 from courses where id = $1', [courseId])).rowCount) throw new HttpError(400, 'Choose the class this subject is taught in.');
  const subject = String(name || '').replace(/\s+/g, ' ').trim();
  if (!subject) throw new HttpError(400, 'Type the subject name, for example Mathematics.');
  if (subject.length > 80) throw new HttpError(400, 'The subject name is too long (80 characters at most).');
  let teacher = null;
  if (teacherId) {
    if (!isUuid(teacherId) || !(await q('select 1 from employees where id = $1', [teacherId])).rowCount) throw new HttpError(400, 'Choose the teacher from the list, or add them first.');
    teacher = teacherId;
  }
  const cur = await readSetup({ lock: true });
  const list = cur.subjects || [];
  if (list.length >= MAX_SUBJECTS) throw new HttpError(400, `You can list at most ${MAX_SUBJECTS} subjects here.`);
  if (list.some((s) => s.courseId === courseId && s.name.toLowerCase() === subject.toLowerCase())) {
    throw new HttpError(409, `${subject} is already listed for that class.`);
  }
  const row = { id: crypto.randomUUID(), courseId, name: subject, teacherId: teacher };
  await writeSetup({ subjects: [...list, row] });
  await audit(admin, 'setup.subject_add', 'course', courseId, { subject });
  return { subject: row };
}

export async function removeSubject(admin, id) {
  const cur = await readSetup({ lock: true });
  const list = cur.subjects || [];
  if (!list.some((s) => s.id === id)) throw new HttpError(404, 'That subject was already removed. Reload the page.');
  await writeSetup({ subjects: list.filter((s) => s.id !== id) });
  await audit(admin, 'setup.subject_remove', 'institute', null, { id });
  return { success: true };
}

/** A teacher added from the wizard goes into a "Teaching" department as "Teacher" (both made when missing). */
export async function addTeacher(admin, { name, email } = {}) {
  const n = String(name || '').replace(/\s+/g, ' ').trim();
  const e = String(email || '').trim().toLowerCase();
  if (!n) throw new HttpError(400, 'Type the teacher\'s name.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)) throw new HttpError(400, 'Type a valid email address: the teacher signs in with it.');
  const dept = (await q("select id from departments where lower(name) = 'teaching'")).rows[0]
    || (await q("insert into departments (name, description) values ('Teaching', 'Teaching staff') returning id")).rows[0];
  const desig = (await q("select id from designations where department_id = $1 and lower(name) = 'teacher'", [dept.id])).rows[0]
    || (await q("insert into designations (department_id, name) values ($1, 'Teacher') returning id", [dept.id])).rows[0];
  const code = await nextNumber('employee', { prefix: 'EMP', padding: 3 });
  try {
    const { rows: [row] } = await q(
      `insert into employees (emp_code, name, email, department_id, designation_id) values ($1, $2, $3, $4, $5)
       returning id, emp_code as code, name, email`, [code, n, e, dept.id, desig.id],
    );
    await audit(admin, 'employee.create', 'employee', row.id, { code, from: 'setup' });
    return { teacher: row };
  } catch (err) {
    if (err.code === '23505') throw new HttpError(409, `A staff member with ${e} already exists. Choose them from the list instead.`);
    throw err;
  }
}

/* ------------------------------------------------------------------ step 7: invite people */

/**
 * Gives every staff member who has no login yet an account (login ID = staff code) and emails them a link to set
 * their password; with the parent portal on, also invites the parents of students whose guardian email is known.
 */
export async function invitePeople(admin, modules = []) {
  const { rows } = await q(
    `select e.id, e.emp_code as code, e.name, lower(e.email) as email from employees e
     where not exists (select 1 from users u where u.employee_id = e.id) order by e.emp_code limit 500`,
  );
  const lockedHash = rows.length ? await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10) : null;
  const staff = { invited: 0, skipped: [] };
  for (const e of rows) {
    await q('savepoint staff_invite');
    try {
      const { rows: [u] } = await q(
        `insert into users (role, login_id, email, name, password_hash, employee_id, must_change_password)
         values ('employee', $1, $2, $3, $4, $5, true) returning id`, [e.code, e.email, e.name, lockedHash, e.id],
      );
      await sendSetupLink({ id: u.id, name: e.name, email: e.email, loginId: e.code }, 7 * 24);
      await q('release savepoint staff_invite');
      staff.invited += 1;
    } catch (err) {
      await q('rollback to savepoint staff_invite');
      if (err.code !== '23505') throw err;
      staff.skipped.push({ code: e.code, name: e.name, reason: `Another account already uses ${e.email} or the login ID ${e.code}. Change the email on the Staff page.` });
    }
  }
  const parents = modules.includes('parent_portal') ? await inviteAllParents(admin) : null;
  await writeSetup({ invitedAt: new Date().toISOString() });
  await audit(admin, 'setup.invite', 'institute', null, { staff: staff.invited, parents: parents ? parents.created + parents.linked : null });
  return { staff, parents };
}

/* ------------------------------------------------------------------ sample data */

const SAMPLE_STUDENTS = [
  ['Aarav Sharma', 'Male'], ['Diya Patel', 'Female'], ['Kabir Singh', 'Male'], ['Meera Iyer', 'Female'], ['Rohan Das', 'Male'],
  ['Sara Khan', 'Female'], ['Vivaan Rao', 'Male'], ['Ananya Gupta', 'Female'],
];

/**
 * Sample-data mode: a "Sample class" with a few made-up students, so a new institute can try every screen before
 * its real data is in. Switching it off removes exactly those records (and anything recorded against them).
 */
export async function setSampleData(admin, on) {
  if (on) {
    let { rows: [course] } = await q('select id from courses where lower(code) = lower($1)', [SAMPLE_COURSE]);
    if (!course) ({ rows: [course] } = await q("insert into courses (code, name, full_name, years) values ($1, 'Sample class', 'Sample class (made-up students to try the system)', 1) returning id", [SAMPLE_COURSE]));
    let made = 0;
    for (const [i, [name, gender]] of SAMPLE_STUDENTS.entries()) {
      const code = `${SAMPLE_PREFIX}${String(i + 1).padStart(3, '0')}`;
      const { rowCount } = await q(
        `insert into students (student_code, roll_no, enrollment_no, name, email, gender, course_id, semester, section, status, guardian)
         select $1, $2, $1, $3, $4, $5, $6, 1, 'A', 'Active', $7
         where not exists (select 1 from students where lower(student_code) = lower($1))`,
        [code, String(i + 1), `${name} (sample)`, `sample${i + 1}@example.invalid`, gender, course.id,
          JSON.stringify({ name: 'Sample parent', relation: 'Parent' })],
      );
      made += rowCount;
    }
    await writeSetup({ sampleData: true });
    await audit(admin, 'setup.sample_on', 'institute', null, { students: made });
    return { sampleData: true, students: SAMPLE_STUDENTS.length };
  }
  const { rowCount } = await q('delete from students where student_code ilike $1', [SAMPLE_LIKE]);
  let kept = null;
  const { rows: [course] } = await q('select id from courses where lower(code) = lower($1)', [SAMPLE_COURSE]);
  if (course) {
    const used = await usageOf(course.id);
    if (used.length) kept = `The Sample class was kept because ${used.map((u) => `${u.n} ${u.n === 1 ? u.one : u.many}`).join(', ')} still use it. Remove those, then remove the class on the Classes page.`;
    else await q('delete from courses where id = $1', [course.id]);
  }
  await writeSetup({ sampleData: undefined });
  await audit(admin, 'setup.sample_off', 'institute', null, { removed: rowCount });
  return { sampleData: false, removed: rowCount, kept };
}

/* ------------------------------------------------------------------ where the wizard stands */

async function counts() {
  const { rows: [c] } = await q(
    `select (coalesce(address, '') <> '' and coalesce(phone, '') <> '' and coalesce(email, '') <> '') as "profileDone",
            (select count(*) from courses where lower(code) <> lower($1))::int as classes,
            (select count(*) from employees)::int as staff,
            (select count(*) from timetable_slots)::int as slots,
            (select count(*) from fee_structures)::int as "feePlans",
            (select count(*) from students where student_code not ilike $2)::int as students,
            (select count(*) from users where role in ('employee', 'parent'))::int as "staffLogins"
     from institute_profiles`, [SAMPLE_COURSE, SAMPLE_LIKE],
  );
  return c;
}

/**
 * The seven steps with done flags and a one-line summary each. Steps whose module is switched off count as done
 * ("Not used here"). `current` is the first step not done yet.
 */
export async function wizard(modules = []) {
  const s = await readSetup();
  const c = await counts();
  const subjects = (s.subjects || []).length;
  const feesOn = modules.includes('fees');
  const steps = [
    { key: 'profile', done: Boolean(c.profileDone), summary: c.profileDone ? (s.logo ? 'Details, logo and colour saved' : 'Details saved. A logo is still worth adding.') : 'Address, phone and email are missing' },
    { key: 'year', done: Boolean(s.academicYear), summary: s.academicYear ? `Academic year ${s.academicYear.name}` : 'Not set yet' },
    { key: 'classes', done: c.classes > 0, summary: c.classes ? `${c.classes} class${c.classes === 1 ? '' : 'es'}` : 'No classes yet' },
    { key: 'subjects', done: subjects > 0 || c.slots > 0, summary: `${subjects} subject${subjects === 1 ? '' : 's'}, ${c.staff} staff` },
    { key: 'fees', done: !feesOn || c.feePlans > 0, off: !feesOn, summary: !feesOn ? 'Fees are not used here' : c.feePlans ? `${c.feePlans} fee plan${c.feePlans === 1 ? '' : 's'}` : 'No fee plan yet' },
    { key: 'import', done: c.students > 0 && c.staff > 0, summary: `${c.students} student${c.students === 1 ? '' : 's'}, ${c.staff} staff` },
    { key: 'invite', done: Boolean(s.invitedAt) || c.staffLogins > 0, summary: s.invitedAt || c.staffLogins ? `${c.staffLogins} staff and parent login${c.staffLogins === 1 ? '' : 's'}` : 'Nobody invited yet' },
  ];
  const done = steps.filter((x) => x.done).length;
  return {
    steps, done, total: steps.length, complete: done === steps.length,
    current: (steps.find((x) => !x.done) || steps[steps.length - 1]).key,
    settings: {
      brandColor: s.brandColor || null, logoVersion: s.logo?.version || null, academicYear: s.academicYear || null,
      divisions: s.divisions || {}, subjects: s.subjects || [], sampleData: Boolean(s.sampleData), invitedAt: s.invitedAt || null,
    },
    counts: c,
  };
}

/** For the vendor console: how far one client is (call inside that client's tenant context). */
export async function setupProgress(modules = []) {
  const w = await wizard(modules);
  return { done: w.done, total: w.total, current: w.current, students: w.counts.students, staff: w.counts.staff };
}

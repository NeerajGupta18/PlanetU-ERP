/**
 * Parent portal. The office creates a parent (or guardian) account from a student's record; a parent can be linked
 * to several students (brothers and sisters) and a student can have more than one parent linked. A parent only ever
 * sees the students linked to them.
 */
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { q } from '../db/pool.js';
import { audit } from '../db/audit.js';
import { HttpError } from '../middleware/error.js';
import { sendSetupLink } from './accounts.service.js';
import { studentOverview } from './attendance.service.js';
import { studentFees } from './fees.service.js';
import { studentResults } from './exams.service.js';
import { loadEvents } from '../db/repo.js';
import { consentTimes } from './consent.service.js';
import { addDays, toISO } from '../utils/dates.js';

/** The cookie that remembers which child a parent is looking at. */
export const CHILD_COOKIE = 'erp_child';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_BULK = 2000;

const str = (v, max, label, required = false) => {
  const s = typeof v === 'string' ? v.trim() : '';
  if (required && !s) throw new HttpError(400, `${label} is required.`);
  if (s.length > max) throw new HttpError(400, `${label} is too long (${max} characters at most).`);
  return s;
};

/* ---------------- the office ---------------- */

export async function listForStudent(studentId) {
  const { rows: [s] } = await q('select id from students where id = $1', [studentId]);
  if (!s) throw new HttpError(404, 'Student not found.');
  const { rows } = await q(
    `select u.id as "userId", u.name, u.email, u.login_id as "loginId", l.relation, u.status, u.must_change_password as "invited",
            (select count(*) from parent_links x where x.user_id = u.id)::int as children
     from parent_links l join users u on u.id = l.user_id where l.student_id = $1 order by l.created_at`, [studentId],
  );
  const agreed = await consentTimes(rows.map((r) => r.userId));
  return { parents: rows.map((r) => ({ ...r, consentAt: agreed[r.userId] ?? null })) };
}

async function uniqueLogin(studentCode) {
  for (let n = 1; n < 20; n += 1) {
    const id = n === 1 ? `PAR-${studentCode}` : `PAR-${studentCode}-${n}`;
    if (!(await q('select 1 from users where lower(login_id) = lower($1)', [id])).rowCount) return id;
  }
  throw new HttpError(409, 'Could not make a login ID for this parent.');
}

/**
 * Creates the parent account (or links an existing parent with the same email, e.g. for a brother or sister) and
 * emails a link to set a password. `showPassword` also returns a one-time password for the office to hand over.
 * `linkExisting: false` refuses instead of linking, for when nobody at the office has looked at this one family.
 */
export async function addParent(studentId, body = {}, admin, { showPassword = true, linkExisting = true } = {}) {
  const { rows: [st] } = await q('select id, student_code as code, name, status from students where id = $1', [studentId]);
  if (!st) throw new HttpError(404, 'Student not found.');
  const name = str(body.name, 100, 'Name', true);
  const email = str(body.email, 120, 'Email', true).toLowerCase();
  if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Enter a valid email address.');
  const relation = str(body.relation || 'Guardian', 30, 'Relation');

  const { rows: [existing] } = await q('select id, role, name from users where lower(email) = $1', [email]);
  if (existing) {
    if (existing.role !== 'parent') throw new HttpError(409, 'This email already belongs to another account at this institute. Use a different email for the parent.');
    if (!linkExisting) throw new HttpError(409, 'This guardian email already has a parent account. If they are brothers or sisters, open the student and add the parent.');
    const { rowCount } = await q('insert into parent_links (user_id, student_id, relation) values ($1, $2, $3) on conflict do nothing', [existing.id, studentId, relation]);
    if (!rowCount) throw new HttpError(409, 'This parent is already linked to the student.');
    await audit(admin, 'parent.link', 'student', studentId, { parent: existing.id });
    return { created: false, parent: (await listForStudent(studentId)).parents.find((p) => p.userId === existing.id) };
  }

  const loginId = await uniqueLogin(st.code);
  const password = crypto.randomBytes(9).toString('base64url');
  const { rows: [u] } = await q(
    `insert into users (role, login_id, email, name, password_hash, must_change_password) values ('parent', $1, $2, $3, $4, true) returning id`,
    [loginId, email, name, await bcrypt.hash(password, 10)],
  );
  await q('insert into parent_links (user_id, student_id, relation) values ($1, $2, $3)', [u.id, studentId, relation]);
  await sendSetupLink({ id: u.id, name, email, loginId });
  await audit(admin, 'parent.create', 'student', studentId, { parent: u.id, loginId });
  return {
    created: true, parent: (await listForStudent(studentId)).parents.find((p) => p.userId === u.id),
    ...(showPassword ? { account: { loginId, email, temporaryPassword: password } } : {}),
  };
}

export async function removeLink(studentId, userId, admin) {
  const { rowCount } = await q('delete from parent_links where student_id = $1 and user_id = $2', [studentId, userId]);
  if (!rowCount) throw new HttpError(404, 'This parent is not linked to the student.');
  const { rows: [{ n }] } = await q('select count(*)::int as n from parent_links where user_id = $1', [userId]);
  if (n === 0) await q("delete from users where id = $1 and role = 'parent'", [userId]); // no children left: the account has no purpose
  await audit(admin, 'parent.unlink', 'student', studentId, { parent: userId, accountRemoved: n === 0 });
}

/**
 * Creates a parent account for every active student that has none and has a guardian email on record, and emails each
 * a link to set a password. Students whose guardian email is missing or already used by any account are listed: a
 * matching email alone never links a child to someone's account, the office does that from the student's record.
 */
export async function inviteAll(admin) {
  const { rows } = await q(
    `select s.id, s.student_code as code, s.guardian->>'name' as gname, s.guardian->>'relation' as grelation, lower(trim(s.guardian->>'email')) as gemail
     from students s where s.status = 'Active' and not exists (select 1 from parent_links l where l.student_id = s.id)
     order by s.student_code limit ${MAX_BULK}`,
  );
  const out = { created: 0, skipped: [] };
  for (const r of rows) {
    if (!r.gemail || !EMAIL_RE.test(r.gemail)) { out.skipped.push({ studentCode: r.code, reason: 'No guardian email on record' }); continue; }
    await q('savepoint invite');
    try {
      const res = await addParent(r.id, { name: r.gname || 'Parent', email: r.gemail, relation: r.grelation || 'Guardian' }, admin, { showPassword: false, linkExisting: false });
      await q('release savepoint invite');
      if (res.created) out.created += 1;
    } catch (err) {
      await q('rollback to savepoint invite');
      if (!(err instanceof HttpError)) throw err;
      out.skipped.push({ studentCode: r.code, reason: err.message });
    }
  }
  await audit(admin, 'parent.invite_all', 'student', null, { created: out.created, linked: out.linked, skipped: out.skipped.length });
  return out;
}

/* ---------------- the parent ---------------- */

export async function childrenOf(userId) {
  const { rows } = await q(
    `select s.id, s.name, s.student_code as "studentCode", s.semester, s.section, c.name as course, l.relation
     from parent_links l join students s on s.id = l.student_id left join courses c on c.id = s.course_id
     where l.user_id = $1 and s.status = 'Active' order by s.name`, [userId],
  );
  return rows;
}

/** The children with the numbers a parent looks at first. Fees and attendance only when those modules are on. */
export async function childSummaries(userId, modules = []) {
  const kids = await childrenOf(userId);
  const out = [];
  const today = toISO(new Date());
  // Exams on the institute calendar in the next 30 days (the calendar is institute-wide)
  const exams = modules.includes('calendar') || modules.includes('exams')
    ? (await loadEvents({ audiences: ['all', 'student'], from: today, to: toISO(addDays(new Date(), 30)) })).find((e) => e.type === 'exam') || null
    : null;
  for (const k of kids) {
    const item = { ...k, attendance: null, outstanding: null, today: null, nextDue: null, latestResult: null, nextExam: null };
    if (modules.includes('attendance')) {
      const { rows: [s] } = await q('select attendance from students where id = $1', [k.id]);
      const o = await studentOverview(k.id, s?.attendance || []);
      item.attendance = { overall: o.overall, threshold: o.threshold };
      // Today: how many of the classes marked so far the child attended (null when nothing is marked yet)
      const { rows: [t] } = await q(
        `select count(*)::int as marked, count(*) filter (where r.status = 'absent')::int as absent, count(*) filter (where r.status = 'late')::int as late
         from attendance_records r join attendance_sessions a on a.id = r.session_id
         where r.student_id = $1 and a.status = 'submitted' and a.on_date = $2::date`, [k.id, today],
      );
      item.today = t.marked ? t : null;
    }
    if (modules.includes('fees')) {
      const f = await studentFees(k.id);
      item.outstanding = f.summary.outstanding;
      const open = f.items.filter((i) => ['unpaid', 'partial'].includes(i.status));
      const first = open[0];
      if (first) {
        const due = first.dueDate ? String(first.dueDate).slice(0, 10) : null;
        item.nextDue = { label: first.label, amount: Math.round((Number(first.amount) - Number(first.paid)) * 100) / 100, dueDate: due, overdue: Boolean(due && due < today) };
      }
    }
    if (modules.includes('exams')) {
      const r = (await studentResults(k.id)).exams[0];
      if (r) item.latestResult = { name: r.name, gpa: r.gpa, pct: r.pct, result: r.result };
    }
    if (exams) item.nextExam = { title: exams.title, start: exams.start, end: exams.end };
    out.push(item);
  }
  return out;
}

/** The student a request is about: the one the parent picked, if still linked, otherwise their first child. */
export async function resolveChild(userId, wanted) {
  const kids = await childrenOf(userId);
  if (!kids.length) return null;
  return (kids.find((k) => k.id === wanted) || kids[0]).id;
}

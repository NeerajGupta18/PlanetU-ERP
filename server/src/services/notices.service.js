/**
 * Notice board. The office posts notices for everyone, only students (optionally one class/course) or only staff.
 * People see what is meant for them, with the pinned and important ones first, and what they have not opened yet
 * is marked new.
 */
import { env } from '../config/env.js';
import { isUuid, q } from '../db/pool.js';
import { audit } from '../db/audit.js';
import { HttpError } from '../middleware/error.js';
import { isISO, toISO } from '../utils/dates.js';
import { queueEmail, tenantInfo } from './notifications.service.js';

export const CATEGORIES = ['General', 'Academic', 'Exam', 'Fees', 'Event', 'Holiday', 'Hostel', 'Placement'];
const AUDIENCES = ['all', 'students', 'employees'];
const MAX_EMAILS = 2000;

const str = (v, max, label, required = false) => {
  const s = typeof v === 'string' ? v.trim() : '';
  if (required && !s) throw new HttpError(400, `${label} is required.`);
  if (s.length > max) throw new HttpError(400, `${label} is too long (${max} characters at most).`);
  return s;
};

function clean(b = {}) {
  const audience = b.audience ?? 'all';
  if (!AUDIENCES.includes(audience)) throw new HttpError(400, 'Choose who the notice is for.');
  const priority = b.priority ?? 'normal';
  if (!['normal', 'important'].includes(priority)) throw new HttpError(400, 'Priority must be normal or important.');
  const status = b.status ?? 'published';
  if (!['draft', 'published'].includes(status)) throw new HttpError(400, 'Status must be draft or published.');
  const noticeDate = b.noticeDate || toISO(new Date());
  if (!isISO(noticeDate)) throw new HttpError(400, 'Enter a valid date to show the notice from.');
  const expiresOn = b.expiresOn || null;
  if (expiresOn && !isISO(expiresOn)) throw new HttpError(400, 'Enter a valid last date for the notice.');
  if (expiresOn && expiresOn < noticeDate) throw new HttpError(400, 'The last date cannot be before the first date.');
  const courseId = b.courseId || null;
  if (courseId && (!isUuid(courseId) || audience !== 'students')) throw new HttpError(400, 'Only a notice for students can be limited to one course.');
  return {
    title: str(b.title, 150, 'Title', true), body: str(b.body, 5000, 'Message'), category: str(b.category || 'General', 40, 'Category'),
    audience, priority, status, noticeDate, expiresOn, courseId, pinned: b.pinned === true,
  };
}

const ADMIN_SELECT = `
  select n.id, n.title, n.body, n.category, n.audience, n.priority, n.pinned, n.status, n.notice_date as "noticeDate",
         n.expires_on as "expiresOn", n.course_id as "courseId", c.name as course, n.created_at as "createdAt",
         (select count(*) from notice_reads r where r.notice_id = n.id)::int as reads,
         case when n.status = 'draft' then 'draft'
              when n.notice_date > current_date then 'scheduled'
              when n.expires_on is not null and n.expires_on < current_date then 'expired'
              else 'live' end as state
  from notices n left join courses c on c.id = n.course_id`;

export async function listForAdmin({ state, search } = {}) {
  const { rows } = await q(`${ADMIN_SELECT} order by n.pinned desc, n.notice_date desc, n.created_at desc limit 500`);
  const s = String(search || '').toLowerCase();
  const filtered = rows.filter((n) => (!state || n.state === state) && (!s || n.title.toLowerCase().includes(s) || n.body.toLowerCase().includes(s)));
  const counts = rows.reduce((a, n) => ({ ...a, [n.state]: (a[n.state] || 0) + 1 }), {});
  return { notices: filtered, counts, categories: CATEGORIES };
}

async function recipients(audience, courseId) {
  const emails = new Set();
  if (audience !== 'employees') {
    const { rows } = await q(
      `select email from students where status = 'Active' and email <> '' ${courseId ? 'and course_id = $1' : ''} limit ${MAX_EMAILS}`, courseId ? [courseId] : [],
    );
    rows.forEach((r) => emails.add(r.email.toLowerCase()));
  }
  if (audience !== 'students') {
    const { rows } = await q(`select email from employees where email <> '' limit ${MAX_EMAILS}`);
    rows.forEach((r) => emails.add(r.email.toLowerCase()));
  }
  return [...emails].slice(0, MAX_EMAILS);
}

async function emailAudience(n) {
  const [to, info] = [await recipients(n.audience, n.courseId), await tenantInfo()];
  for (const email of to) {
    await queueEmail(email, 'noticePosted', { institute: info.name, title: n.title, category: n.category, excerpt: n.body.slice(0, 400), important: n.priority === 'important', url: `${env.APP_URL}/login` });
  }
  return to.length;
}

export async function create(body, admin) {
  const n = clean(body);
  if (n.courseId) {
    const { rowCount } = await q('select 1 from courses where id = $1', [n.courseId]);
    if (!rowCount) throw new HttpError(400, 'Choose a valid course.');
  }
  const { rows: [r] } = await q(
    `insert into notices (title, body, category, audience, priority, pinned, status, notice_date, expires_on, course_id, created_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning id`,
    [n.title, n.body, n.category, n.audience, n.priority, n.pinned, n.status, n.noticeDate, n.expiresOn, n.courseId, admin.id],
  );
  await audit(admin, 'notice.create', 'notice', r.id, { title: n.title, audience: n.audience });
  const emailed = body.notify === true && n.status === 'published' ? await emailAudience(n) : 0;
  return { notice: (await q(`${ADMIN_SELECT} where n.id = $1`, [r.id])).rows[0], emailed };
}

export async function update(id, body, admin) {
  const { rows: [old] } = await q('select id, status from notices where id = $1 for update', [id]);
  if (!old) throw new HttpError(404, 'Notice not found.');
  const n = clean(body);
  if (n.courseId) {
    const { rowCount } = await q('select 1 from courses where id = $1', [n.courseId]);
    if (!rowCount) throw new HttpError(400, 'Choose a valid course.');
  }
  await q(
    `update notices set title = $2, body = $3, category = $4, audience = $5, priority = $6, pinned = $7, status = $8,
                        notice_date = $9, expires_on = $10, course_id = $11, updated_at = now() where id = $1`,
    [id, n.title, n.body, n.category, n.audience, n.priority, n.pinned, n.status, n.noticeDate, n.expiresOn, n.courseId],
  );
  await audit(admin, 'notice.update', 'notice', id, { title: n.title });
  // Emailing happens once: when a draft is published, or when asked at creation
  const emailed = body.notify === true && old.status === 'draft' && n.status === 'published' ? await emailAudience(n) : 0;
  return { notice: (await q(`${ADMIN_SELECT} where n.id = $1`, [id])).rows[0], emailed };
}

export async function remove(id, admin) {
  const { rowCount } = await q('delete from notices where id = $1', [id]);
  if (!rowCount) throw new HttpError(404, 'Notice not found.');
  await audit(admin, 'notice.delete', 'notice', id);
}

/* ---------------- what a student or staff member sees ---------------- */

async function viewer(user) {
  if (user.role === 'student') {
    const { rows: [s] } = await q('select course_id from students where id = $1', [user.studentId]);
    return { audience: 'students', courseId: s?.course_id ?? null };
  }
  return { audience: 'employees', courseId: null };
}

const FEED_SELECT = `
  select n.id, n.title, n.body, n.category, n.notice_date as date, n.priority, n.pinned, n.audience, c.name as course,
         (r.user_id is not null) as read
  from notices n
  left join courses c on c.id = n.course_id
  left join notice_reads r on r.notice_id = n.id and r.user_id = $1
  where n.status = 'published' and n.notice_date <= current_date and (n.expires_on is null or n.expires_on >= current_date)
    and n.audience in ('all', $2) and (n.course_id is null or n.course_id = $3)`;

export async function feed(user, { limit } = {}) {
  const v = await viewer(user);
  const { rows } = await q(
    `${FEED_SELECT} order by n.pinned desc, n.notice_date desc, n.created_at desc ${limit ? `limit ${Number(limit)}` : 'limit 200'}`,
    [user.id, v.audience, v.courseId],
  );
  const { rows: [u] } = await q(`select count(*)::int as n from (${FEED_SELECT}) x where not x.read`, [user.id, v.audience, v.courseId]);
  return { notices: rows, unread: u.n, categories: CATEGORIES };
}

export async function markRead(user, id) {
  const v = await viewer(user);
  const { rowCount } = await q(`select 1 from (${FEED_SELECT}) x where x.id = $4`, [user.id, v.audience, v.courseId, id]);
  if (!rowCount) throw new HttpError(404, 'Notice not found.');
  await q('insert into notice_reads (notice_id, user_id) values ($1, $2) on conflict do nothing', [id, user.id]);
}

export async function markAllRead(user) {
  const v = await viewer(user);
  await q(
    `insert into notice_reads (notice_id, user_id)
     select x.id, $1::uuid from (${FEED_SELECT}) x where not x.read on conflict do nothing`,
    [user.id, v.audience, v.courseId],
  );
}

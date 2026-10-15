/**
 * The bell: short in-app messages for every role, plus reminders worked out from today's data.
 *
 *   notify*(...)  store a message for the people an event is about (called next to the email the event already sends)
 *   bell(user)    what the bell shows: stored messages, today's reminders and the counts for menu badges
 *
 * A stored message never blocks the action that caused it: if writing it fails, the action still goes through.
 */
import { isUuid, q } from '../db/pool.js';
import { HttpError } from '../middleware/error.js';
import { toISO, addDays } from '../utils/dates.js';
import { feed as noticeFeed } from './notices.service.js';
import { approvalCounts } from './approvals.service.js';

const clip = (s, n) => String(s ?? '').slice(0, n);

/** Stores one message for each of the given users (duplicates and empty ids are skipped). */
export async function notifyUsers(userIds, { kind, title, body = '', link = '' }) {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  if (!ids.length) return 0;
  const insert = () => q(
    `insert into user_notifications (user_id, kind, title, body, link)
     select u, $2, $3, $4, $5 from unnest($1::uuid[]) as u`,
    [ids, clip(kind, 40), clip(title, 200), clip(body, 500), clip(link, 300)],
  );
  // Inside a request transaction a savepoint keeps a failed insert from undoing the action itself
  try {
    await q('savepoint inbox_notify');
  } catch {
    try { await insert(); return ids.length; } catch (err) { console.error('[inbox] could not store a notification:', err.message); return 0; }
  }
  try {
    await insert();
    await q('release savepoint inbox_notify');
    return ids.length;
  } catch (err) {
    await q('rollback to savepoint inbox_notify').catch(() => {});
    console.error('[inbox] could not store a notification:', err.message);
    return 0;
  }
}

/** The student's own login, and (with parents: true) the parent logins linked to them. */
export async function usersOfStudent(studentId, { parents = false } = {}) {
  if (!studentId) return [];
  const { rows } = await q(
    `select id from users where student_id = $1 and status = 'active'
     ${parents ? "union select l.user_id from parent_links l join users u on u.id = l.user_id and u.status = 'active' where l.student_id = $1" : ''}`,
    [studentId],
  );
  return rows.map((r) => r.id);
}

export async function userOfEmployee(employeeId) {
  if (!employeeId) return [];
  const { rows } = await q("select id from users where employee_id = $1 and status = 'active'", [employeeId]);
  return rows.map((r) => r.id);
}

export async function adminUsers() {
  const { rows } = await q("select id from users where role = 'admin' and status = 'active'");
  return rows.map((r) => r.id);
}

/** Tells the student; with { parents: true } their parents too, with the child's first name in front so a parent of two can tell them apart. */
export async function notifyStudent(studentId, msg, { parents = false } = {}) {
  const n = await notifyUsers(await usersOfStudent(studentId), msg);
  if (!parents) return n;
  const { rows } = await q(
    "select l.user_id, s.name from parent_links l join students s on s.id = l.student_id join users u on u.id = l.user_id and u.status = 'active' where l.student_id = $1", [studentId],
  );
  if (!rows.length) return n;
  return n + await notifyUsers(rows.map((r) => r.user_id), { ...msg, title: `${rows[0].name.split(' ')[0]}: ${msg.title}` });
}
export const notifyEmployee = async (employeeId, msg) => notifyUsers(await userOfEmployee(employeeId), msg);
export const notifyAdmins = async (msg) => notifyUsers(await adminUsers(), msg);

/* ------------------------------------------------------------------ reading */

const inr = (n) => `₹${Math.round(Number(n)).toLocaleString('en-IN')}`;
const day = (d) => new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

/** Fee reminders for one student: anything overdue, and anything falling due in the next 3 days. */
async function feeReminders(studentId, who, link) {
  const today = toISO(new Date());
  const { rows: [f] } = await q(
    `select coalesce(sum(o.bal) filter (where o.due_date < $2::date), 0)::float8 as overdue, min(o.due_date) filter (where o.due_date < $2::date) as "overdueSince",
            coalesce(sum(o.bal) filter (where o.due_date between $2::date and $3::date), 0)::float8 as soon, min(o.due_date) filter (where o.due_date between $2::date and $3::date) as "soonOn"
     from (select i.due_date, i.amount - coalesce((select sum(a.amount) from payment_allocations a where a.fee_item_id = i.id), 0) as bal
           from student_fee_items i where i.student_id = $1 and i.status in ('unpaid', 'partial')) o`,
    [studentId, today, toISO(addDays(new Date(), 3))],
  );
  const out = [];
  if (f.overdue > 0) out.push({ id: `fee-overdue-${studentId}`, kind: 'fees', tone: 'bad', title: `${who}${inr(f.overdue)} in fees is overdue`, body: `It was due on ${day(f.overdueSince)}.`, link });
  if (f.soon > 0) out.push({ id: `fee-soon-${studentId}`, kind: 'fees', tone: 'warn', title: `${who}${inr(f.soon)} in fees is due on ${day(f.soonOn)}`, body: 'Pay before the due date to avoid a late fine.', link });
  return out;
}

/** Work due in the next 2 days that the student has not handed in. */
async function workReminders(studentId) {
  const { rows } = await q(
    `select a.id, a.title, a.due_at as "dueAt" from assignments a join students s on s.id = $1
     where a.course_id = s.course_id and (a.section = '' or a.section = s.section) and a.status = 'published'
       and a.due_at between now() and now() + interval '2 days'
       and not exists (select 1 from assignment_submissions x where x.assignment_id = a.id and x.student_id = s.id)
     order by a.due_at limit 3`, [studentId],
  ).catch(() => ({ rows: [] }));
  return rows.map((a) => ({ id: `work-${a.id}`, kind: 'assignment', tone: 'warn', title: `"${a.title}" is due ${new Date(a.dueAt).toLocaleString('en-IN', { weekday: 'short', hour: 'numeric', minute: '2-digit' })}`, body: 'You have not handed it in yet.', link: `/student/assignments/${a.id}` }));
}

/** Everything the bell shows for this user. `modules` is the institute's switched-on module list. */
export async function bell(user, modules = []) {
  const has = (m) => modules.includes(m);
  const { rows: items } = await q(
    `select id, kind, title, body, link, created_at as "createdAt", read_at is not null as read
     from user_notifications where user_id = $1 order by created_at desc limit 30`, [user.id],
  );
  const { rows: [{ n: unread }] } = await q('select count(*)::int as n from user_notifications where user_id = $1 and read_at is null', [user.id]);

  const reminders = [];
  const counts = {};
  if (user.role === 'student' && user.studentId) {
    if (has('fees')) reminders.push(...await feeReminders(user.studentId, '', '/student/fees'));
    if (has('assignments')) reminders.push(...await workReminders(user.studentId));
  }
  if (user.role === 'parent' && has('fees')) {
    const { rows: kids } = await q('select s.id, s.name from parent_links l join students s on s.id = l.student_id where l.user_id = $1 order by s.name', [user.id]);
    for (const k of kids) reminders.push(...await feeReminders(k.id, `${k.name.split(' ')[0]}: `, '/student/fees'));
  }
  const principal = user.role === 'employee' && (await q("select 1 from staff_roles where employee_id = $1 and role = 'principal'", [user.employeeId])).rowCount > 0;
  if (user.role === 'admin' || principal) {
    Object.assign(counts, await approvalCounts(modules));
    if (counts.approvals > 0) reminders.push({ id: 'approvals', kind: 'approvals', tone: 'warn', title: `${counts.approvals} item${counts.approvals === 1 ? '' : 's'} waiting for your decision`, body: 'Leave, certificates, applications and tickets, in one list.', link: '/admin/approvals' });
  }
  if (has('notices') && ['student', 'employee'].includes(user.role)) {
    const f = await noticeFeed(user, { limit: 1 }).catch(() => null);
    counts.notices = f?.unread || 0;
    if (f?.unread) reminders.push({ id: 'notices', kind: 'notice', tone: 'info', title: `${f.unread} new notice${f.unread === 1 ? '' : 's'}`, body: f.notices[0]?.title || '', link: `/${user.role}/notices` });
  }
  return { items, unread, reminders, counts, total: unread + reminders.length };
}

export async function markRead(user, id) {
  if (!isUuid(id)) throw new HttpError(404, 'Notification not found.');
  const { rowCount } = await q('update user_notifications set read_at = coalesce(read_at, now()) where id = $1 and user_id = $2', [id, user.id]);
  if (!rowCount) throw new HttpError(404, 'Notification not found.');
}

export async function markAllRead(user) {
  await q('update user_notifications set read_at = now() where user_id = $1 and read_at is null', [user.id]);
}

/**
 * Grievances. A student, parent or employee raises a ticket (and may hide their name from the office); the office
 * replies and moves it along: open -> in progress -> resolved -> closed. The person who raised it sees the whole
 * conversation, can reply (which re-opens a resolved ticket) and can close it once they are satisfied.
 */
import { env } from '../config/env.js';
import { q } from '../db/pool.js';
import { audit } from '../db/audit.js';
import { nextNumber } from '../db/series.js';
import { HttpError } from '../middleware/error.js';
import { queueEmail, tenantInfo } from './notifications.service.js';
import { notifyAdmins, notifyUsers } from './inbox.service.js';

export const CATEGORIES = ['Academic', 'Fees', 'Hostel', 'Transport', 'Facilities', 'Staff conduct', 'Safety', 'Other'];
export const STATUSES = ['open', 'in_progress', 'resolved', 'closed'];

const str = (v, max, label, required = false) => {
  const s = typeof v === 'string' ? v.trim() : '';
  if (required && !s) throw new HttpError(400, `${label} is required.`);
  if (s.length > max) throw new HttpError(400, `${label} is too long (${max} characters at most).`);
  return s;
};

const SELECT = `
  select g.id, g.ticket_no as "ticketNo", g.category, g.subject, g.details, g.anonymous, g.status,
         g.created_at as "createdAt", g.updated_at as "updatedAt", g.resolved_at as "resolvedAt",
         g.raiser_role as "raiserRole", g.raised_by as "raisedBy",
         s.name as "studentName", s.student_code as "studentCode", u.name as "raiserName",
         (select count(*) from grievance_messages m where m.grievance_id = g.id)::int as replies
  from grievances g
  join users u on u.id = g.raised_by
  left join students s on s.id = g.student_id`;

/** What the office sees: an anonymous ticket shows no name and no way to tell who raised it. */
function forOffice(g) {
  const { raisedBy, raiserName, studentName, studentCode, ...rest } = g;
  if (g.anonymous) return { ...rest, from: 'Anonymous', raiserRole: null };
  const who = g.raiserRole === 'parent' ? `${raiserName} (parent of ${studentName})` : raiserName;
  return { ...rest, from: who, studentCode: g.raiserRole === 'student' ? studentCode : null };
}
/** What the person who raised it sees. */
function forRaiser(g) {
  const { raisedBy, raiserName, studentName, studentCode, raiserRole, ...rest } = g;
  return rest;
}

async function messagesOf(id) {
  const { rows } = await q('select id, from_office as "fromOffice", body, created_at as "at" from grievance_messages where grievance_id = $1 order by created_at, id', [id]);
  return rows;
}

/* ---------------- the person raising it ---------------- */

/** `studentId` is the child a parent is writing about; students use their own record. */
export async function create(user, body = {}, { studentId = null } = {}) {
  const category = body.category;
  if (!CATEGORIES.includes(category)) throw new HttpError(400, `Choose a category: ${CATEGORIES.join(', ')}.`);
  const subject = str(body.subject, 150, 'Subject', true);
  const details = str(body.details, 3000, 'Details', true);
  const ticketNo = await nextNumber('grievance', { prefix: `GRV${new Date().getFullYear()}-`, padding: 5 });
  const sid = user.role === 'student' ? user.studentId : user.role === 'parent' ? studentId : null;
  const { rows: [g] } = await q(
    `insert into grievances (ticket_no, raised_by, raiser_role, student_id, category, subject, details, anonymous)
     values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
    [ticketNo, user.id, user.role, sid, category, subject, details, body.anonymous === true],
  );
  await audit(user, 'grievance.create', 'grievance', g.id, { ticketNo, category });
  await notifyAdmins({ kind: 'approval', title: `New ticket ${ticketNo}: ${subject}`, body: `${category}${body.anonymous === true ? '' : `, from ${user.name}`}`, link: `/admin/grievances?open=${g.id}` });
  return forRaiser((await q(`${SELECT} where g.id = $1`, [g.id])).rows[0]);
}

export async function listMine(user) {
  const { rows } = await q(`${SELECT} where g.raised_by = $1 order by g.updated_at desc limit 200`, [user.id]);
  return { grievances: rows.map(forRaiser), categories: CATEGORIES };
}

async function mine(user, id) {
  const { rows: [g] } = await q(`${SELECT} where g.id = $1 and g.raised_by = $2`, [id, user.id]);
  if (!g) throw new HttpError(404, 'Ticket not found.');
  return g;
}

export async function getMine(user, id) {
  const g = await mine(user, id);
  return { grievance: forRaiser(g), messages: await messagesOf(id) };
}

export async function replyMine(user, id, body = {}) {
  const g = await mine(user, id);
  if (g.status === 'closed') throw new HttpError(409, 'This ticket is closed. Please raise a new one.');
  const text = str(body.body, 3000, 'Message', true);
  await q('insert into grievance_messages (grievance_id, from_office, author_id, body) values ($1, false, $2, $3)', [id, user.id, text]);
  await q("update grievances set updated_at = now(), status = case when status = 'resolved' then 'open' else status end, resolved_at = case when status = 'resolved' then null else resolved_at end where id = $1", [id]);
  return getMine(user, id);
}

export async function closeMine(user, id) {
  const g = await mine(user, id);
  if (g.status === 'closed') throw new HttpError(409, 'This ticket is already closed.');
  await q("update grievances set status = 'closed', updated_at = now(), resolved_at = coalesce(resolved_at, now()) where id = $1", [id]);
  await audit(user, 'grievance.close', 'grievance', id);
  return getMine(user, id);
}

/* ---------------- the office ---------------- */

export async function listForAdmin({ status, category, search } = {}) {
  const { rows } = await q(`${SELECT} order by (g.status in ('open', 'in_progress')) desc, g.updated_at desc limit 500`);
  const s = String(search || '').toLowerCase();
  const view = rows.map(forOffice);
  const filtered = view.filter((g) => (!status || (status === 'active' ? ['open', 'in_progress'].includes(g.status) : g.status === status))
    && (!category || g.category === category)
    && (!s || g.subject.toLowerCase().includes(s) || g.ticketNo.toLowerCase().includes(s) || g.from.toLowerCase().includes(s)));
  const counts = view.reduce((a, g) => ({ ...a, [g.status]: (a[g.status] || 0) + 1 }), {});
  return { grievances: filtered, counts, categories: CATEGORIES };
}

export async function getForAdmin(id) {
  const { rows: [g] } = await q(`${SELECT} where g.id = $1`, [id]);
  if (!g) throw new HttpError(404, 'Ticket not found.');
  return { grievance: forOffice(g), messages: await messagesOf(id) };
}

async function tell(id, status, message) {
  const { rows: [r] } = await q(
    `select g.ticket_no as "ticketNo", g.subject, g.raised_by as "raisedBy", u.name, u.email, u.role from grievances g join users u on u.id = g.raised_by where g.id = $1`, [id],
  );
  if (r) {
    const base = r.role === 'employee' ? '/employee' : r.role === 'parent' ? '/parent' : '/student';
    await notifyUsers([r.raisedBy], {
      kind: 'grievance', link: `${base}/support`,
      title: `Update on your ticket ${r.ticketNo}: ${String(status).replace('_', ' ')}`,
      body: message || r.subject,
    });
  }
  if (!r?.email) return;
  const info = await tenantInfo();
  const home = r.role === 'employee' ? 'employee' : 'student';
  await queueEmail(r.email, 'grievanceUpdate', { institute: info.name, name: r.name, ticketNo: r.ticketNo, subject: r.subject, status, message, url: `${env.APP_URL}/${home}/support` });
}

/** body: { body, status } - a reply, a new status, or both. */
export async function replyAdmin(id, body = {}, admin) {
  const { rows: [g] } = await q('select id, status from grievances where id = $1 for update', [id]);
  if (!g) throw new HttpError(404, 'Ticket not found.');
  const text = str(body.body, 3000, 'Reply');
  const status = body.status ?? null;
  if (status !== null && !STATUSES.includes(status)) throw new HttpError(400, 'Choose a valid status.');
  if (!text && (status === null || status === g.status)) throw new HttpError(400, 'Write a reply or change the status.');
  if (g.status === 'closed' && status === null) throw new HttpError(409, 'This ticket is closed. Re-open it to reply.');
  if (text) await q('insert into grievance_messages (grievance_id, from_office, author_id, body) values ($1, true, $2, $3)', [id, admin.id, text]);
  const next = status ?? (g.status === 'open' ? 'in_progress' : g.status); // answering an open ticket means it is being handled
  await q(
    `update grievances set status = $2, updated_at = now(),
       resolved_at = case when $2 in ('resolved', 'closed') then coalesce(resolved_at, now()) else null end where id = $1`, [id, next],
  );
  await audit(admin, 'grievance.reply', 'grievance', id, { status: next });
  await tell(id, next, text);
  return getForAdmin(id);
}

export async function openCount() {
  return (await q("select count(*)::int as n from grievances where status in ('open', 'in_progress')")).rows[0].n;
}

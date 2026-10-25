/**
 * "Book a demo" requests from the public landing page. They belong to no institute: the public form writes them
 * through a platform transaction, and only the vendor console reads them.
 */
import { q } from '../db/pool.js';
import { HttpError } from '../middleware/error.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[+()\d\s-]{6,20}$/;
export const INSTITUTE_TYPES = ['school', 'college', 'university', 'other'];
export const STATUSES = ['new', 'contacted', 'closed'];

const text = (v, max, label, { required = false, min = 0 } = {}) => {
  const s = typeof v === 'string' ? v.trim() : '';
  if (required && !s) throw new HttpError(400, `Enter ${label}.`);
  if (s && s.length < min) throw new HttpError(400, `${label[0].toUpperCase()}${label.slice(1)} looks too short. Check it and try again.`);
  if (s.length > max) throw new HttpError(400, `Shorten ${label} to ${max} characters or fewer.`);
  return s || null;
};

export async function createDemoRequest(body = {}) {
  const row = {
    name: text(body.name, 100, 'your name', { required: true, min: 2 }),
    institute: text(body.institute, 150, 'the institute name', { required: true, min: 2 }),
    instituteType: INSTITUTE_TYPES.includes(body.instituteType) ? body.instituteType : null,
    phone: text(body.phone, 20, 'a phone number', { required: true }),
    email: text(body.email, 150, 'an email address', { required: true }),
    city: text(body.city, 80, 'the city'),
    students: text(body.students, 20, 'the number of students'),
    message: text(body.message, 1000, 'the message'),
  };
  if (!row.instituteType) throw new HttpError(400, 'Choose the kind of institute: school, college, university or other.');
  if (!PHONE_RE.test(row.phone)) throw new HttpError(400, 'Enter a phone number with digits only, for example 98765 43210.');
  if (!EMAIL_RE.test(row.email)) throw new HttpError(400, 'Enter an email address like name@institute.edu.');
  const { rows: [r] } = await q(
    `insert into demo_requests (name, institute, institute_type, phone, email, city, students, message)
     values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
    [row.name, row.institute, row.instituteType, row.phone, row.email, row.city, row.students, row.message],
  );
  return { id: r.id };
}

export async function listDemoRequests() {
  const { rows } = await q(
    `select id, name, institute, institute_type as "instituteType", phone, email, city, students, message, status,
            created_at as "createdAt"
     from demo_requests order by (status = 'new') desc, created_at desc limit 200`,
  );
  return { requests: rows, newCount: rows.filter((r) => r.status === 'new').length };
}

export async function setDemoRequestStatus(id, status) {
  if (!STATUSES.includes(status)) throw new HttpError(400, 'Choose new, contacted or closed.');
  const { rowCount } = await q('update demo_requests set status = $2 where id = $1', [id, status]);
  if (!rowCount) throw new HttpError(404, 'That demo request was not found. Reload the list.');
  return { id, status };
}

/**
 * Approvals: everything waiting for the office's decision, in one list - leave requests, certificate requests,
 * submitted applications and new help-desk tickets. Each item links to the page where it is decided; leave can be
 * approved or rejected straight from the list.
 */
import { q } from '../db/pool.js';
import { TYPES as CERT_TYPES } from './certificates.service.js';

const SOURCES = [
  { type: 'leave', module: 'leave', count: "select count(*)::int as n from leave_requests where status = 'pending'" },
  { type: 'certificate', module: 'certificates', count: "select count(*)::int as n from certificate_requests where status = 'requested'" },
  { type: 'application', module: 'admissions', count: "select count(*)::int as n from applications where status = 'submitted'" },
  { type: 'grievance', module: 'grievance', count: "select count(*)::int as n from grievances where status = 'open'" },
];

/** How many items of each kind are waiting (only for switched-on modules), and the total as `approvals`. */
export async function approvalCounts(modules = []) {
  const out = { approvals: 0 };
  for (const s of SOURCES) {
    if (!modules.includes(s.module)) continue;
    const { rows: [r] } = await q(s.count);
    out[s.type] = r.n;
    out.approvals += r.n;
  }
  return out;
}

const certLabel = (t) => CERT_TYPES[t]?.label || CERT_TYPES[t] || t;

export async function list(modules = []) {
  const has = (m) => modules.includes(m);
  const items = [];
  if (has('leave')) {
    const { rows } = await q(
      `select r.id, r.from_date::text as "fromDate", r.to_date::text as "toDate", r.days::float8 as days, r.half_day as "halfDay", r.reason,
              r.created_at as "since", t.name as "typeName", e.name, e.emp_code as code
       from leave_requests r join leave_types t on t.id = r.leave_type_id join employees e on e.id = r.employee_id
       where r.status = 'pending' order by r.from_date, r.created_at`,
    );
    for (const r of rows) {
      items.push({
        id: r.id, type: 'leave', title: `${r.typeName}: ${r.days} day${r.days === 1 ? '' : 's'}`, who: `${r.name} (${r.code})`,
        detail: r.fromDate === r.toDate ? r.fromDate : `${r.fromDate} to ${r.toDate}`, note: r.reason, since: r.since, link: '/admin/leave', fromDate: r.fromDate,
      });
    }
  }
  if (has('certificates')) {
    const { rows } = await q(
      `select r.id, r.cert_type, r.purpose, r.created_at as since, s.name, s.student_code as code
       from certificate_requests r join students s on s.id = r.student_id where r.status = 'requested' order by r.created_at`,
    );
    for (const r of rows) items.push({ id: r.id, type: 'certificate', title: certLabel(r.cert_type), who: `${r.name} (${r.code})`, detail: '', note: r.purpose, since: r.since, link: '/admin/certificates' });
  }
  if (has('admissions')) {
    const { rows } = await q(
      `select a.id, a.application_no as no, a.name, a.submitted_at as since, c.name as course
       from applications a left join courses c on c.id = a.course_id where a.status = 'submitted' order by a.submitted_at nulls last limit 200`,
    );
    for (const r of rows) items.push({ id: r.id, type: 'application', title: `Application ${r.no}`, who: r.name, detail: r.course || '', note: '', since: r.since, link: `/admin/admissions?open=${r.id}` });
  }
  if (has('grievance')) {
    const { rows } = await q(
      `select g.id, g.ticket_no as no, g.subject, g.category, g.anonymous, g.created_at as since, u.name
       from grievances g join users u on u.id = g.raised_by where g.status = 'open' order by g.created_at`,
    );
    for (const r of rows) items.push({ id: r.id, type: 'grievance', title: `${r.no}: ${r.subject}`, who: r.anonymous ? 'Name hidden' : r.name, detail: r.category, note: '', since: r.since, link: `/admin/grievances?open=${r.id}` });
  }
  items.sort((a, b) => new Date(a.since || 0) - new Date(b.since || 0));
  return { items, counts: await approvalCounts(modules) };
}

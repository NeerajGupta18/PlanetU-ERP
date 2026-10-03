/**
 * Read helpers shared by the Student and Admin controllers. Rows are mapped to
 * the same object shapes the old JSON store produced, so the API contract the
 * React app depends on is unchanged. Row Level Security scopes every query to
 * the current tenant - nothing here filters by tenant on purpose.
 */
import { q } from './pool.js';

export async function getInstitute() {
  const { rows: [r] } = await q('select * from institute_profiles');
  if (!r) return null;
  return {
    id: r.tenant_id, name: r.name, shortName: r.short_name, tagline: r.tagline, address: r.address, city: r.city,
    state: r.state, pincode: r.pincode, phone: r.phone, email: r.email, website: r.website, details: r.details,
    stakeholders: r.stakeholders, authorizedPersons: r.authorized_persons, documents: r.documents,
    beneficiaries: r.beneficiaries, stamp: r.stamp,
  };
}

export const instituteBrief = async () => {
  const i = await getInstitute();
  return i && { name: i.name, shortName: i.shortName, tagline: i.tagline, address: i.address, phone: i.phone };
};

export async function loadEmployees() {
  const { rows } = await q(`
    select e.id, e.emp_code as code, e.name, e.email, e.shift, d.name as department, g.name as designation
    from employees e
    join departments d on d.id = e.department_id
    join designations g on g.id = e.designation_id
    order by e.emp_code`);
  return rows;
}

export async function loadCourses() {
  const { rows } = await q(`
    select c.id, c.code, c.name, c.full_name as "fullName", d.name as department, c.years
    from courses c left join departments d on d.id = c.department_id
    order by c.code`);
  return rows;
}

export async function loadSlots(courseId) {
  const { rows } = await q(
    `select id, course_id as "courseId", weekday, start_time as start, end_time as "end", subject,
            employee_id as "employeeId", mode, location
     from timetable_slots ${courseId ? 'where course_id = $1' : ''} order by weekday, start_time`,
    courseId ? [courseId] : [],
  );
  return rows;
}

export async function loadDuties(courseId) {
  const { rows } = await q(
    `select id, course_id as "courseId", title, employee_id as "employeeId", duty_date as date,
            start_time as start, end_time as "end", priority, location
     from duties ${courseId ? 'where course_id = $1' : ''} order by duty_date, start_time`,
    courseId ? [courseId] : [],
  );
  return rows;
}

export async function loadReassignments() {
  const { rows } = await q(
    'select slot_id as "slotId", on_date as date, to_employee_id as "toEmployeeId", reason from reassignments',
  );
  return rows;
}

export const EVENT_COLUMNS = `id, title, type, start_date as start, end_date as "end", all_day as "allDay",
  start_time as "startTime", end_time as "endTime", location, description, audience`;

export async function loadEvents({ audiences, from, to } = {}) {
  const where = [];
  const params = [];
  if (audiences) { params.push(audiences); where.push(`audience = any($${params.length})`); }
  if (from) { params.push(from); where.push(`end_date >= $${params.length}`); }
  if (to) { params.push(to); where.push(`start_date <= $${params.length}`); }
  const { rows } = await q(
    `select ${EVENT_COLUMNS} from events ${where.length ? `where ${where.join(' and ')}` : ''}
     order by start_date, title`,
    params,
  );
  return rows;
}

export async function loadHolidayEvents() {
  const { rows } = await q("select start_date as start, end_date as \"end\" from events where type = 'holiday'");
  return rows;
}

export async function loadNotices(limit) {
  const { rows } = await q(
    `select id, title, body, category, notice_date as date from notices order by notice_date desc, title
     ${limit ? `limit ${Number(limit)}` : ''}`,
  );
  return rows;
}

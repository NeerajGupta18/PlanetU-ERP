/**
 * Staff roles: the admin gives an employee one or more office roles (see config/staffRoles.js); the employee then
 * sees the office pages those roles need. A head of department is given for one department.
 */
import { isUuid, q } from '../db/pool.js';
import { audit } from '../db/audit.js';
import { HttpError } from '../middleware/error.js';
import { ROLE_KEYS, STAFF_ROLES, areasFor, reportGroups } from '../config/staffRoles.js';
import { notifyEmployee } from './inbox.service.js';

export async function grantsOf(employeeId) {
  if (!employeeId) return [];
  const { rows } = await q(
    `select r.role, r.department_id as "departmentId", d.name as department
     from staff_roles r left join departments d on d.id = r.department_id where r.employee_id = $1 order by r.role`, [employeeId],
  );
  return rows;
}

/** What an employee's staff roles add up to, or null when they have none. */
export async function officeOf(user) {
  if (user?.role !== 'employee' || !user.employeeId) return null;
  const grants = await grantsOf(user.employeeId);
  if (!grants.length) return null;
  const areas = areasFor(grants);
  // Teaching pages are hidden from staff who have no lectures and no exam papers (an accountant, a librarian)
  const { rows: [t] } = await q(
    `select exists (select 1 from timetable_slots where employee_id = $1) or exists (select 1 from exam_papers where employee_id = $1) as teaching`, [user.employeeId],
  );
  return {
    teaching: t.teaching,
    roles: grants.map((g) => ({ role: g.role, label: STAFF_ROLES[g.role].label, departmentId: g.departmentId, department: g.department })),
    areas,
    reportGroups: reportGroups(areas),
  };
}

/** The roles there are, and who holds each one. */
export async function list() {
  const { rows } = await q(
    `select r.employee_id as "employeeId", r.role, r.department_id as "departmentId", d.name as department, r.created_at as "since",
            e.name, e.emp_code as code, g.name as designation, ed.name as "employeeDepartment",
            exists (select 1 from users u where u.employee_id = e.id and u.status = 'active') as "hasLogin"
     from staff_roles r join employees e on e.id = r.employee_id
     left join departments d on d.id = r.department_id
     left join designations g on g.id = e.designation_id left join departments ed on ed.id = e.department_id
     order by r.role, e.name`,
  );
  return {
    roles: ROLE_KEYS.map((k) => ({ key: k, label: STAFF_ROLES[k].label, about: STAFF_ROLES[k].about, department: STAFF_ROLES[k].scope === 'department' })),
    holders: rows.map((r) => ({ ...r, roleLabel: STAFF_ROLES[r.role]?.label || r.role })),
  };
}

export async function grant(admin, body = {}) {
  const { employeeId, role } = body;
  if (!ROLE_KEYS.includes(role)) throw new HttpError(400, 'Choose a staff role.');
  if (!isUuid(employeeId)) throw new HttpError(400, 'Choose an employee.');
  const { rows: [e] } = await q('select id, name from employees where id = $1', [employeeId]);
  if (!e) throw new HttpError(400, 'Choose an employee.');
  let departmentId = null;
  if (STAFF_ROLES[role].scope === 'department') {
    if (!isUuid(body.departmentId) || !(await q('select 1 from departments where id = $1', [body.departmentId])).rowCount) throw new HttpError(400, 'Choose the department this person heads.');
    departmentId = body.departmentId;
    const { rows: [other] } = await q(
      "select e.name from staff_roles r join employees e on e.id = r.employee_id where r.role = 'hod' and r.department_id = $1 and r.employee_id <> $2", [departmentId, employeeId],
    );
    if (other) throw new HttpError(409, `${other.name} is already head of this department. Remove that first.`);
  }
  await q(
    `insert into staff_roles (employee_id, role, department_id, granted_by) values ($1, $2, $3, $4)
     on conflict (tenant_id, employee_id, role) do update set department_id = excluded.department_id, granted_by = excluded.granted_by`,
    [employeeId, role, departmentId, admin.id],
  );
  await audit(admin, 'staff_role.grant', 'employee', employeeId, { role, departmentId });
  await notifyEmployee(employeeId, { kind: 'staff_role', title: `You were given the ${STAFF_ROLES[role].label} role`, body: 'Its pages are now in your menu.', link: '/employee/dashboard' });
  return list();
}

export async function revoke(admin, employeeId, role) {
  if (!ROLE_KEYS.includes(role) || !isUuid(employeeId)) throw new HttpError(404, 'Role not found.');
  const { rowCount } = await q('delete from staff_roles where employee_id = $1 and role = $2', [employeeId, role]);
  if (!rowCount) throw new HttpError(404, 'Role not found.');
  await audit(admin, 'staff_role.revoke', 'employee', employeeId, { role });
  return list();
}

/** Employees and courses of the given departments (for heads of department). */
export async function employeesIn(departmentIds) {
  const { rows } = await q('select id from employees where department_id = any ($1)', [departmentIds]);
  return new Set(rows.map((r) => r.id));
}
export async function coursesIn(departmentIds) {
  const { rows } = await q('select id from courses where department_id = any ($1)', [departmentIds]);
  return new Set(rows.map((r) => r.id));
}

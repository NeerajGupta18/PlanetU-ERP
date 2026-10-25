/**
 * Which office pages a staff member may open. Mirrors server/src/config/staffRoles.js: the server checks every
 * call; this only decides what the menu shows and which /admin pages open for an employee with staff roles.
 */
const AREA_OF = {
  dashboard: 'dashboard', approvals: 'approvals', admissions: 'admissions', students: 'students', certificates: 'certificates',
  courses: 'academics', timetable: 'academics', calendar: 'academics', attendance: 'attendance', exams: 'exams',
  assignments: 'coursework', quizzes: 'coursework', learning: 'coursework', fees: 'fees', payroll: 'payroll',
  employees: 'staff', departments: 'staff', leave: 'leave', library: 'library', assets: 'assets', hostel: 'hostel',
  transport: 'transport', visitors: 'visitors', placement: 'placement', notices: 'notices', grievances: 'helpdesk', feedback: 'helpdesk',
};
const ADMIN_ONLY = ['institute', 'billing', 'staff-roles', 'setup'];

/** The area grant (or null) for an /admin/... path. */
export function officeGrant(office, path) {
  if (!office) return null;
  const seg = String(path).split('/')[2] || 'dashboard';
  if (ADMIN_ONLY.includes(seg)) return null;
  if (seg === 'reports') return office.reportGroups?.length ? { scope: 'all' } : null;
  const area = AREA_OF[seg];
  return area ? office.areas?.[area] || null : null;
}

export const canOpenOffice = (office, path) => Boolean(officeGrant(office, path));

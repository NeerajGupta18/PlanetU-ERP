/**
 * Staff roles: which office pages each kind of staff member may open.
 *
 * The admin API is split into AREAS by the first part of the path (/api/admin/<segment>/...). A staff role grants
 * areas; an employee with that role may use those parts of the admin API, and nothing else. Lookups (the course,
 * department, employee and student lists that office pages use to fill pickers) are readable by anyone holding a
 * staff role. Some parts are never for staff: the institute's settings, the subscription, the audit log and the
 * staff roles themselves stay with the institute admin.
 *
 * `scope: 'department'` means the role only sees its own department (heads of department), and `readOnly` that it
 * may look but not change.
 */
export const AREAS = {
  dashboard: { routes: ['dashboard', 'setup-status'] },
  approvals: { routes: ['approvals'] },
  admissions: { routes: ['admissions'] },
  students: { routes: ['students'], reports: ['Students'] },
  certificates: { routes: ['certificates'] },
  academics: { routes: ['courses', 'timetable', 'calendar'] },
  attendance: { routes: ['attendance'], reports: ['Attendance'] },
  exams: { routes: ['exams'], reports: ['Exams'] },
  coursework: { routes: ['assignments', 'quizzes', 'learning'], reports: ['Learning'] },
  fees: { routes: ['fees'], reports: ['Fees'] },
  payroll: { routes: ['payroll'] },
  staff: { routes: ['employees', 'departments', 'designations'], reports: ['People'] },
  leave: { routes: ['leave'] },
  library: { routes: ['library'] },
  assets: { routes: ['assets'] },
  hostel: { routes: ['hostel'] },
  transport: { routes: ['transport'] },
  visitors: { routes: ['visitors'] },
  placement: { routes: ['placement'] },
  notices: { routes: ['notices'] },
  helpdesk: { routes: ['grievances', 'feedback'] },
};

/** Never for staff, whatever their role. */
export const ADMIN_ONLY = ['institute', 'billing', 'audit', 'staff-roles', 'setup'];

/** Read-only lists any staff role may use to fill pickers and filters. */
export const LOOKUPS = ['courses', 'departments', 'designations', 'employees', 'students', 'timetable', 'calendar'];

const ALL = Object.keys(AREAS);

export const STAFF_ROLES = {
  principal: { label: 'Principal', about: 'Runs the institute day to day: every office page except settings, subscription and staff roles.', areas: ALL },
  hod: { label: 'Head of department', about: 'Their department\'s leave requests and attendance.', areas: ['leave', 'attendance'], scope: 'department' },
  accountant: { label: 'Accountant', about: 'Fees, payments, receipts, dues and payroll.', areas: ['fees', 'payroll'] },
  admission_officer: { label: 'Admission officer', about: 'Applications, enrolment, student records and certificates.', areas: ['admissions', 'students', 'certificates'] },
  exam_cell: { label: 'Exam cell', about: 'Exams, papers, marks and results.', areas: ['exams'] },
  librarian: { label: 'Librarian', about: 'Books, issue and return.', areas: ['library'] },
  warden: { label: 'Hostel warden', about: 'Hostels, rooms and residents.', areas: ['hostel'] },
  transport_incharge: { label: 'Transport in-charge', about: 'Routes, stops and riders.', areas: ['transport'] },
  placement_officer: { label: 'Placement officer', about: 'Companies, drives, applications and offers.', areas: ['placement'] },
  gate_security: { label: 'Gate security', about: 'The visitor desk: check visitors in and out.', areas: ['visitors'] },
};
export const ROLE_KEYS = Object.keys(STAFF_ROLES);

/** What a set of granted roles adds up to: area -> { scope: 'all' | 'department', departmentIds }. */
export function areasFor(grants) {
  const out = {};
  for (const g of grants) {
    const def = STAFF_ROLES[g.role];
    if (!def) continue;
    for (const a of def.areas) {
      const cur = out[a] || { scope: 'department', departmentIds: [] };
      if (def.scope === 'department') {
        if (cur.scope !== 'all' && g.departmentId) cur.departmentIds = [...new Set([...cur.departmentIds, g.departmentId])];
      } else {
        cur.scope = 'all'; cur.departmentIds = [];
      }
      out[a] = cur;
    }
  }
  return out;
}

export function areaOfSegment(segment) {
  return Object.keys(AREAS).find((a) => AREAS[a].routes.includes(segment)) || null;
}

/** Report groups a set of areas may run. */
export function reportGroups(areas) {
  // Reports cover the whole institute, so a department-only grant (a head of department) does not open them
  return [...new Set(Object.keys(areas).filter((a) => areas[a].scope === 'all').flatMap((a) => AREAS[a]?.reports || []))];
}

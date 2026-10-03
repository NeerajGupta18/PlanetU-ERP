/**
 * The product's module catalogue and the per-client-type presets.
 *
 * One codebase serves schools, colleges, universities and companies:
 *  - MODULES        every module the platform has (or will have). `core` modules
 *                   are always on; the rest can be switched per client.
 *  - PRESETS        the defaults a new client of each type starts with:
 *                   which modules are on and what the words are called
 *                   ("Class" vs "Course" vs "Program", "Teacher" vs "Faculty"...).
 *
 * A vendor (Super Admin) can override both per client from the console.
 * `implemented: false` entries are the roadmap - they can be toggled now and
 * will start working as each module ships.
 */
export const MODULES = [
  { key: 'institute', label: 'Institute profile', core: true, implemented: true },
  { key: 'departments', label: 'Departments & Designations', core: true, implemented: true },
  { key: 'employees', label: 'Employees', core: true, implemented: true },
  { key: 'calendar', label: 'Calendar', core: false, implemented: true },
  { key: 'timetable', label: 'Timetable & Lecture Reassignment', core: false, implemented: true },
  { key: 'admissions', label: 'Admissions', core: false, implemented: true },
  { key: 'students', label: 'Students / Members (PRN)', core: false, implemented: true },
  { key: 'id_cards', label: 'ID Cards', core: false, implemented: true },
  { key: 'fees', label: 'Fees & Finance', core: false, implemented: true },
  { key: 'attendance', label: 'Attendance', core: false, implemented: true },
  { key: 'exams', label: 'Exams & Results', core: false, implemented: true },
  { key: 'learning', label: 'Learning Platform (MOOCs & credits)', core: false, implemented: true },
  { key: 'quizzes', label: 'Quizzes & Internal Marks', core: false, implemented: true },
  { key: 'library', label: 'Library', core: false, implemented: true },
  { key: 'assets', label: 'Assets', core: false, implemented: true },
  { key: 'leave', label: 'Leave & Shifts', core: false, implemented: false },
  { key: 'payroll', label: 'Payroll', core: false, implemented: false },
  { key: 'hostel', label: 'Hostel', core: false, implemented: false },
  { key: 'transport', label: 'Transport', core: false, implemented: false },
  { key: 'notices', label: 'Notice Board', core: false, implemented: false },
  { key: 'certificates', label: 'Certificates', core: false, implemented: false },
  { key: 'visitors', label: 'Visitor Management', core: false, implemented: false },
];

export const MODULE_KEYS = MODULES.map((m) => m.key);
export const CORE_MODULES = MODULES.filter((m) => m.core).map((m) => m.key);

const base = ['calendar', 'timetable', 'admissions', 'students', 'id_cards', 'fees', 'attendance', 'exams', 'learning', 'quizzes',
  'library', 'assets', 'leave', 'payroll', 'notices', 'certificates', 'visitors'];

export const PRESETS = {
  school: {
    label: 'School',
    modules: [...CORE_MODULES, ...base, 'transport'],
    terminology: {
      institute: 'School', student: 'Student', students: 'Students', course: 'Class', courses: 'Classes',
      semester: 'Term', department: 'Department', departments: 'Departments', employee: 'Teacher', employees: 'Teachers',
      admission: 'Admissions',
    },
  },
  college: {
    label: 'College',
    modules: [...CORE_MODULES, ...base, 'hostel', 'transport'],
    terminology: {
      institute: 'College', student: 'Student', students: 'Students', course: 'Course', courses: 'Courses',
      semester: 'Semester', department: 'Department', departments: 'Departments', employee: 'Faculty', employees: 'Faculty',
      admission: 'Admissions',
    },
  },
  university: {
    label: 'University',
    modules: [...CORE_MODULES, ...base, 'hostel', 'transport'],
    terminology: {
      institute: 'University', student: 'Student', students: 'Students', course: 'Programme', courses: 'Programmes',
      semester: 'Semester', department: 'School / Department', departments: 'Schools / Departments',
      employee: 'Faculty', employees: 'Faculty', admission: 'Admissions',
    },
  },
  company: {
    label: 'Company / Organisation',
    modules: [...CORE_MODULES, 'calendar', 'timetable', 'admissions', 'students', 'id_cards', 'attendance',
      'assets', 'leave', 'payroll', 'notices', 'visitors', 'transport'],
    terminology: {
      institute: 'Organisation', student: 'Trainee', students: 'Trainees', course: 'Programme', courses: 'Programmes',
      semester: 'Phase', department: 'Department', departments: 'Departments', employee: 'Employee', employees: 'Employees',
      admission: 'Recruitment',
    },
  },
};

export const TENANT_TYPES = Object.keys(PRESETS);

/** Core modules can never be switched off; unknown keys are dropped. */
export const normaliseModules = (list) => [...new Set([...CORE_MODULES, ...(list || []).filter((k) => MODULE_KEYS.includes(k))])];

import {
  BookOpen, BookOpenCheck, Boxes, Building2, CalendarCheck, CalendarDays, CircleDollarSign, ClipboardCheck, CreditCard, FileBarChart2, GraduationCap, LayoutDashboard, ListChecks, Network, Server, Table2, UserRound, Users, Users2, Wallet,
} from 'lucide-react';

/**
 * Sidebar menus per role. To add a module later: build its page, add a <Route>
 * in App.jsx, and add one line here.
 *
 * Multi-tenant behaviour (see hooks/useTenantConfig.js):
 *   module - the server-side module key. The item is hidden when the institute's
 *            plan/config has that module switched off. Omit for always-on items.
 *   term   - [key, fallback]: the label comes from the institute's terminology
 *            (a school says "Teachers", a college says "Faculty").
 */
export const MENU = {
  student: [
    { label: 'Dashboard', to: '/student/dashboard', icon: LayoutDashboard },
    { label: 'Profile', to: '/student/profile', icon: UserRound },
    { label: 'Institute', to: '/student/institute', icon: Building2, term: ['institute', 'Institute'] },
    { label: 'Calendar', to: '/student/calendar', icon: CalendarDays, module: 'calendar' },
    { label: 'Fees', to: '/student/fees', icon: Wallet, module: 'fees' },
    { label: 'Library', to: '/student/library', icon: BookOpen, module: 'library' },
    { label: 'Timetable', to: '/student/timetable', icon: Table2, module: 'timetable' },
    { label: 'Attendance', to: '/student/attendance', icon: CalendarCheck, module: 'attendance' },
    { label: 'Results', to: '/student/results', icon: GraduationCap, module: 'exams' },
    { label: 'Learning', to: '/student/learning', icon: BookOpenCheck, module: 'learning' },
    { label: 'Quizzes', to: '/student/quizzes', icon: ListChecks, module: 'quizzes' },
  ],
  admin: [
    { label: 'Admin Dashboard', to: '/admin/dashboard', icon: LayoutDashboard },
    { label: 'Institute', to: '/admin/institute', icon: Building2, term: ['institute', 'Institute'] },
    { label: 'Departments & Designations', to: '/admin/departments', icon: Network },
    { label: 'Employees', to: '/admin/employees', icon: Users, term: ['employees', 'Employees'] },
    { label: 'Admissions', to: '/admin/admissions', icon: ClipboardCheck, module: 'admissions', term: ['admission', 'Admissions'] },
    { label: 'Students', to: '/admin/students', icon: Users2, module: 'students', term: ['students', 'Students'] },
    { label: 'Fees & Payments', to: '/admin/fees', icon: Wallet, module: 'fees' },
    { label: 'Library', to: '/admin/library', icon: BookOpen, module: 'library' },
    { label: 'Assets', to: '/admin/assets', icon: Boxes, module: 'assets' },
    { label: 'Calendar', to: '/admin/calendar', icon: CalendarDays, module: 'calendar' },
    { label: 'Timetable', to: '/admin/timetable', icon: Table2, module: 'timetable' },
    { label: 'Attendance', to: '/admin/attendance', icon: CalendarCheck, module: 'attendance' },
    { label: 'Exams & Results', to: '/admin/exams', icon: GraduationCap, module: 'exams' },
    { label: 'Learning', to: '/admin/learning', icon: BookOpenCheck, module: 'learning' },
    { label: 'Quizzes', to: '/admin/quizzes', icon: ListChecks, module: 'quizzes' },
    { label: 'Reports & Exports', to: '/admin/reports', icon: FileBarChart2 },
    { label: 'Billing', to: '/admin/billing', icon: CreditCard },
  ],
  super_admin: [
    { label: 'Dashboard', to: '/super-admin/dashboard', icon: LayoutDashboard },
    { label: 'Institutes', to: '/super-admin/institutes', icon: Server },
    { label: 'Billing', to: '/super-admin/billing', icon: CircleDollarSign },
  ],
  employee: [
    { label: 'Dashboard', to: '/employee/dashboard', icon: LayoutDashboard },
    { label: 'Attendance', to: '/employee/attendance', icon: ClipboardCheck, module: 'attendance' },
    { label: 'Exam marks', to: '/employee/exams', icon: GraduationCap, module: 'exams' },
    { label: 'Learning', to: '/employee/learning', icon: BookOpenCheck, module: 'learning' },
    { label: 'Quizzes', to: '/employee/quizzes', icon: ListChecks, module: 'quizzes' },
  ],
};

export const ROLE_HOME = {
  student: '/student/dashboard',
  admin: '/admin/dashboard',
  super_admin: '/super-admin/dashboard',
  employee: '/employee/dashboard',
};

export const ROLE_LABEL = {
  student: 'Student',
  admin: 'Institute Admin',
  super_admin: 'Platform Admin',
  employee: 'Employee',
};

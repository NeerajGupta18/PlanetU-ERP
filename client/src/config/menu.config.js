import {
  BedDouble, Banknote, Briefcase, NotebookPen, QrCode, BookOpen, BookOpenCheck, Boxes, Bus, Building2, CalendarCheck, CalendarOff, CalendarDays, CircleDollarSign, ClipboardCheck, CreditCard, FileBarChart2, FileText, LifeBuoy, Star, GraduationCap, LayoutDashboard, ListChecks, Megaphone, School, Network, Server, Settings2, Table2, UserRound, Users, Users2, Wallet,
} from 'lucide-react';

/**
 * Sidebar menus per role. To add a module later: build its page, add a <Route>
 * in App.jsx, and add one line here inside the right group.
 *
 * An entry is either a plain link (pinned at the top, like the Dashboard) or a group:
 *   { group: 'Academics', icon, items: [ ...links ] }
 *
 * Multi-tenant behaviour (see hooks/useTenantConfig.js):
 *   module - the server-side module key. The item is hidden when the institute's
 *            plan/config has that module switched off. Omit for always-on items.
 *   term   - [key, fallback]: the label comes from the institute's terminology
 *            (a school says "Teachers", a college says "Faculty").
 * A group with no visible items is hidden automatically.
 */
export const MENU_TREE = {
  parent: [
    { label: 'Home', to: '/parent/home', icon: LayoutDashboard },
    { label: 'Notice board', to: '/student/notices', icon: Megaphone, module: 'notices' },
    { group: 'My child', icon: GraduationCap, items: [
      { label: 'Attendance', to: '/student/attendance', icon: CalendarCheck, module: 'attendance' },
      { label: 'Timetable', to: '/student/timetable', icon: Table2, module: 'timetable' },
      { label: 'Results', to: '/student/results', icon: GraduationCap, module: 'exams' },
      { label: 'Calendar', to: '/student/calendar', icon: CalendarDays, module: 'calendar' },
      { label: 'Fees', to: '/student/fees', icon: Wallet, module: 'fees' },
      { label: 'Hostel', to: '/student/hostel', icon: BedDouble, module: 'hostel' },
      { label: 'Transport', to: '/student/transport', icon: Bus, module: 'transport' },
      { label: 'Profile', to: '/student/profile', icon: UserRound },
    ] },
    { label: 'Help and feedback', to: '/parent/support', icon: LifeBuoy, module: 'grievance' },
  ],
  student: [
    { label: 'Dashboard', to: '/student/dashboard', icon: LayoutDashboard },
    { label: 'Notice board', to: '/student/notices', icon: Megaphone, module: 'notices' },
    {
      group: 'Academics', icon: GraduationCap, items: [
        { label: 'Timetable', to: '/student/timetable', icon: Table2, module: 'timetable' },
        { label: 'Attendance', to: '/student/attendance', icon: CalendarCheck, module: 'attendance' },
        { label: 'Results', to: '/student/results', icon: GraduationCap, module: 'exams' },
        { label: 'Learning', to: '/student/learning', icon: BookOpenCheck, module: 'learning' },
        { label: 'Quizzes', to: '/student/quizzes', icon: ListChecks, module: 'quizzes' },
        { label: 'Assignments', to: '/student/assignments', icon: NotebookPen, module: 'assignments' },
        { label: 'Check in', to: '/student/checkin', icon: QrCode, module: 'attendance' },
        { label: 'Calendar', to: '/student/calendar', icon: CalendarDays, module: 'calendar' },
      ],
    },
    {
      group: 'Fees & Campus', icon: Wallet, items: [
        { label: 'Fees', to: '/student/fees', icon: Wallet, module: 'fees' },
        { label: 'Library', to: '/student/library', icon: BookOpen, module: 'library' },
        { label: 'Hostel', to: '/student/hostel', icon: BedDouble, module: 'hostel' },
        { label: 'Transport', to: '/student/transport', icon: Bus, module: 'transport' },
        { label: 'Placement', to: '/student/placement', icon: Briefcase, module: 'placement' },
      ],
    },
    {
      group: 'My Account', icon: UserRound, items: [
        { label: 'Profile', to: '/student/profile', icon: UserRound },
        { label: 'Certificates', to: '/student/certificates', icon: FileText, module: 'certificates' },
        { label: 'Help and feedback', to: '/student/support', icon: LifeBuoy, module: 'grievance' },
        { label: 'Institute', to: '/student/institute', icon: Building2, term: ['institute', 'Institute'] },
      ],
    },
  ],
  admin: [
    { label: 'Dashboard', to: '/admin/dashboard', icon: LayoutDashboard },
    {
      group: 'Admissions & Students', icon: ClipboardCheck, items: [
        { label: 'Admissions', to: '/admin/admissions', icon: ClipboardCheck, module: 'admissions', term: ['admission', 'Admissions'] },
        { label: 'Students', to: '/admin/students', icon: Users2, module: 'students', term: ['students', 'Students'] },
        { label: 'Certificates', to: '/admin/certificates', icon: FileText, module: 'certificates' },
      ],
    },
    {
      group: 'Academics', icon: GraduationCap, items: [
        { label: 'Courses', to: '/admin/courses', icon: School, term: ['courses', 'Courses'] },
        { label: 'Timetable', to: '/admin/timetable', icon: Table2, module: 'timetable' },
        { label: 'Attendance', to: '/admin/attendance', icon: CalendarCheck, module: 'attendance' },
        { label: 'Exams & Results', to: '/admin/exams', icon: GraduationCap, module: 'exams' },
        { label: 'Learning', to: '/admin/learning', icon: BookOpenCheck, module: 'learning' },
        { label: 'Quizzes', to: '/admin/quizzes', icon: ListChecks, module: 'quizzes' },
        { label: 'Assignments', to: '/admin/assignments', icon: NotebookPen, module: 'assignments' },
        { label: 'Calendar', to: '/admin/calendar', icon: CalendarDays, module: 'calendar' },
      ],
    },
    {
      group: 'Campus', icon: Boxes, items: [
        { label: 'Library', to: '/admin/library', icon: BookOpen, module: 'library' },
        { label: 'Assets', to: '/admin/assets', icon: Boxes, module: 'assets' },
        { label: 'Hostel', to: '/admin/hostel', icon: BedDouble, module: 'hostel' },
        { label: 'Transport', to: '/admin/transport', icon: Bus, module: 'transport' },
        { label: 'Placement', to: '/admin/placement', icon: Briefcase, module: 'placement' },
      ],
    },
    {
      group: 'People', icon: Users, items: [
        { label: 'Employees', to: '/admin/employees', icon: Users, term: ['employees', 'Employees'] },
        { label: 'Departments & Designations', to: '/admin/departments', icon: Network },
        { label: 'Leave', to: '/admin/leave', icon: CalendarOff, module: 'leave' },
      ],
    },
    {
      group: 'Finance', icon: Wallet, items: [
        { label: 'Fees & Payments', to: '/admin/fees', icon: Wallet, module: 'fees' },
        { label: 'Payroll', to: '/admin/payroll', icon: Banknote, module: 'payroll' },
        { label: 'Billing', to: '/admin/billing', icon: CreditCard },
      ],
    },
    {
      group: 'Communication', icon: Megaphone, items: [
        { label: 'Notice board', to: '/admin/notices', icon: Megaphone, module: 'notices' },
        { label: 'Grievances', to: '/admin/grievances', icon: LifeBuoy, module: 'grievance' },
        { label: 'Feedback', to: '/admin/feedback', icon: Star, module: 'grievance' },
      ],
    },
    {
      group: 'Setup & Reports', icon: Settings2, items: [
        { label: 'Institute', to: '/admin/institute', icon: Building2, term: ['institute', 'Institute'] },
        { label: 'Reports & Exports', to: '/admin/reports', icon: FileBarChart2 },
      ],
    },
  ],
  super_admin: [
    { label: 'Dashboard', to: '/super-admin/dashboard', icon: LayoutDashboard },
    { label: 'Institutes', to: '/super-admin/institutes', icon: Server },
    { label: 'Billing', to: '/super-admin/billing', icon: CircleDollarSign },
  ],
  employee: [
    { label: 'Dashboard', to: '/employee/dashboard', icon: LayoutDashboard },
    { label: 'Notice board', to: '/employee/notices', icon: Megaphone, module: 'notices' },
    { label: 'My leave', to: '/employee/leave', icon: CalendarOff, module: 'leave' },
    { label: 'My payslips', to: '/employee/payslips', icon: Banknote, module: 'payroll' },
    { label: 'Help and feedback', to: '/employee/support', icon: LifeBuoy, module: 'grievance' },
    {
      group: 'Teaching', icon: ClipboardCheck, items: [
        { label: 'Attendance', to: '/employee/attendance', icon: ClipboardCheck, module: 'attendance' },
        { label: 'Exam marks', to: '/employee/exams', icon: GraduationCap, module: 'exams' },
        { label: 'Learning', to: '/employee/learning', icon: BookOpenCheck, module: 'learning' },
        { label: 'Quizzes', to: '/employee/quizzes', icon: ListChecks, module: 'quizzes' },
        { label: 'Assignments', to: '/employee/assignments', icon: NotebookPen, module: 'assignments' },
      ],
    },
  ],
};

export const ROLE_HOME = {
  student: '/student/dashboard',
  admin: '/admin/dashboard',
  super_admin: '/super-admin/dashboard',
  employee: '/employee/dashboard',
  parent: '/parent/home',
};

export const ROLE_LABEL = {
  student: 'Student',
  admin: 'Institute Admin',
  super_admin: 'Platform Admin',
  employee: 'Employee',
  parent: 'Parent',
};

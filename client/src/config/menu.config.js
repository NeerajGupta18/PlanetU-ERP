import {
  ScanLine, Rocket,
  Inbox, BedDouble, Banknote, DoorOpen, Briefcase, NotebookPen, QrCode, BookOpen, BookOpenCheck, Boxes, Bus, Building2, CalendarCheck, CalendarOff, CalendarDays, CircleDollarSign, ClipboardCheck, CreditCard, FileBarChart2, FileText, LifeBuoy, Star, GraduationCap, LayoutDashboard, ListChecks, Megaphone, School, Network, Server, Settings2, Table2, UserRound, Users, Users2, Wallet,
} from 'lucide-react';

/**
 * Sidebar menus per role. To add a module later: build its page, add a <Route>
 * in App.jsx, and add one line here inside the right group.
 *
 * An entry is either a plain link (pinned at the top, like the Dashboard) or a group:
 *   { group: 'Academics', icon, items: [ ...links ] }
 *
 * A link can join several closely related pages under one menu item with `sections`:
 *   { label: 'Coursework', icon, sections: [{ label: 'Assignments', to, module }, { label: 'Quizzes', to, module }] }
 * The sidebar shows one item; the pages show tabs to move between them (see SectionTabs.jsx).
 * Search and breadcrumbs still know every section by name.
 *
 * Multi-tenant behaviour (see hooks/useTenantConfig.js):
 *   module - the server-side module key. The item is hidden when the institute's
 *            plan/config has that module switched off. Omit for always-on items.
 *   term   - [key, fallback]: the label comes from the institute's terminology
 *            (a school says "Teachers", a college says "Faculty").
 *   badge  - a key into the counts the notification service returns (shown as a number on the item).
 * A group with no visible items is hidden automatically. The most used pages are pinned at the top.
 */
export const MENU_TREE = {
  parent: [
    { label: 'Home', to: '/parent/home', icon: LayoutDashboard },
    { label: 'Attendance', to: '/student/attendance', icon: CalendarCheck, module: 'attendance' },
    { label: 'Fees', to: '/student/fees', icon: Wallet, module: 'fees' },
    { label: 'Results', to: '/student/results', icon: GraduationCap, module: 'exams' },
    { label: 'Timetable', to: '/student/timetable', icon: Table2, module: 'timetable' },
    { group: 'More', icon: Boxes, items: [
      { label: 'Notices & calendar', icon: Megaphone, sections: [
        { label: 'Notice board', to: '/student/notices', module: 'notices' },
        { label: 'Calendar', to: '/student/calendar', module: 'calendar' },
      ] },
      { label: 'Hostel & transport', icon: Bus, sections: [
        { label: 'Hostel', to: '/student/hostel', module: 'hostel' },
        { label: 'Transport', to: '/student/transport', module: 'transport' },
      ] },
      { label: 'Child profile', to: '/student/profile', icon: UserRound },
      { label: 'Help and feedback', to: '/parent/support', icon: LifeBuoy, module: 'grievance' },
      { label: 'How to use', to: '/parent/help', icon: BookOpenCheck },
    ] },
  ],
  student: [
    { label: 'Dashboard', to: '/student/dashboard', icon: LayoutDashboard },
    { label: 'Timetable', to: '/student/timetable', icon: Table2, module: 'timetable' },
    { label: 'Attendance', icon: CalendarCheck, sections: [
      { label: 'My attendance', to: '/student/attendance', module: 'attendance' },
      { label: 'Scan to mark attendance', to: '/student/checkin', module: 'qr_checkin' },
    ] },
    { label: 'Coursework', icon: NotebookPen, sections: [
      { label: 'Assignments', to: '/student/assignments', module: 'assignments' },
      { label: 'Quizzes', to: '/student/quizzes', module: 'quizzes' },
      { label: 'Learning', to: '/student/learning', module: 'learning' },
    ] },
    { label: 'Results', to: '/student/results', icon: GraduationCap, module: 'exams' },
    { label: 'Fees', to: '/student/fees', icon: Wallet, module: 'fees' },
    {
      group: 'Campus', icon: Building2, items: [
        { label: 'Notices & calendar', icon: Megaphone, sections: [
          { label: 'Notice board', to: '/student/notices', module: 'notices' },
          { label: 'Calendar', to: '/student/calendar', module: 'calendar' },
        ] },
        { label: 'Library', to: '/student/library', icon: BookOpen, module: 'library' },
        { label: 'Hostel & transport', icon: Bus, sections: [
          { label: 'Hostel', to: '/student/hostel', module: 'hostel' },
          { label: 'Transport', to: '/student/transport', module: 'transport' },
        ] },
        { label: 'Placement', to: '/student/placement', icon: Briefcase, module: 'placement' },
      ],
    },
    {
      group: 'My account', icon: UserRound, items: [
        { label: 'Profile', to: '/student/profile', icon: UserRound },
        { label: 'Certificates', to: '/student/certificates', icon: FileText, module: 'certificates' },
        { label: 'Help and feedback', to: '/student/support', icon: LifeBuoy, module: 'grievance' },
        { label: 'How to use', to: '/student/help', icon: BookOpenCheck },
        { label: 'Institute', to: '/student/institute', icon: Building2, term: ['institute', 'Institute'] },
      ],
    },
  ],
  admin: [
    { label: 'Dashboard', to: '/admin/dashboard', icon: LayoutDashboard },
    { label: 'Approvals', to: '/admin/approvals', icon: Inbox, badge: 'approvals' },
    {
      group: 'Students', icon: Users2, items: [
        { label: 'Admissions', to: '/admin/admissions', icon: ClipboardCheck, module: 'admissions', term: ['admission', 'Admissions'] },
        { label: 'Students', icon: Users2, term: ['students', 'Students'], sections: [
          { label: 'Students', to: '/admin/students', module: 'students', term: ['students', 'Students'] },
          { label: 'Certificates', to: '/admin/certificates', module: 'certificates' },
        ] },
      ],
    },
    {
      group: 'Academics', icon: GraduationCap, items: [
        { label: 'Courses', to: '/admin/courses', icon: School, term: ['courses', 'Courses'] },
        { label: 'Timetable', to: '/admin/timetable', icon: Table2, module: 'timetable' },
        { label: 'Attendance', to: '/admin/attendance', icon: CalendarCheck, module: 'attendance' },
        { label: 'Exams & Results', to: '/admin/exams', icon: GraduationCap, module: 'exams' },
        { label: 'Coursework', icon: NotebookPen, sections: [
          { label: 'Assignments', to: '/admin/assignments', module: 'assignments' },
          { label: 'Quizzes', to: '/admin/quizzes', module: 'quizzes' },
          { label: 'Learning', to: '/admin/learning', module: 'learning' },
        ] },
      ],
    },
    {
      group: 'Finance', icon: Wallet, items: [
        { label: 'Fees & Payments', to: '/admin/fees', icon: Wallet, module: 'fees' },
        { label: 'Payroll', to: '/admin/payroll', icon: Banknote, module: 'payroll' },
      ],
    },
    {
      group: 'Staff', icon: Users, items: [
        { label: 'Employees', icon: Users, term: ['employees', 'Employees'], sections: [
          { label: 'Employees', to: '/admin/employees', term: ['employees', 'Employees'] },
          { label: 'Departments & Designations', to: '/admin/departments' },
          { label: 'Staff roles', to: '/admin/staff-roles' },
        ] },
        { label: 'Leave', to: '/admin/leave', icon: CalendarOff, module: 'leave' },
      ],
    },
    {
      group: 'Campus', icon: Boxes, items: [
        { label: 'Library & assets', icon: BookOpen, sections: [
          { label: 'Library', to: '/admin/library', module: 'library' },
          { label: 'Assets', to: '/admin/assets', module: 'assets' },
        ] },
        { label: 'Hostel & transport', icon: Bus, sections: [
          { label: 'Hostel', to: '/admin/hostel', module: 'hostel' },
          { label: 'Transport', to: '/admin/transport', module: 'transport' },
        ] },
        { label: 'Visitors', to: '/admin/visitors', icon: DoorOpen, module: 'visitors' },
        { label: 'Placement', to: '/admin/placement', icon: Briefcase, module: 'placement' },
      ],
    },
    {
      group: 'Office', icon: Settings2, items: [
        { label: 'Notices & calendar', icon: Megaphone, sections: [
          { label: 'Notice board', to: '/admin/notices', module: 'notices' },
          { label: 'Calendar', to: '/admin/calendar', module: 'calendar' },
        ] },
        { label: 'Help desk', icon: LifeBuoy, sections: [
          { label: 'Grievances', to: '/admin/grievances', module: 'grievance' },
          { label: 'Feedback', to: '/admin/feedback', module: 'grievance' },
        ] },
        { label: 'Reports & Exports', to: '/admin/reports', icon: FileBarChart2 },
        { label: 'Set up your institute', to: '/admin/setup', icon: Rocket },
        { label: 'Institute settings', to: '/admin/institute', icon: Building2 },
        { label: 'Subscription', to: '/admin/billing', icon: CreditCard },
        { label: 'How to use', to: '/admin/help', icon: BookOpenCheck },
      ],
    },
  ],
  super_admin: [
    { label: 'Dashboard', to: '/super-admin/dashboard', icon: LayoutDashboard },
    { label: 'Institutes', to: '/super-admin/institutes', icon: Server },
    { label: 'Billing', to: '/super-admin/billing', icon: CircleDollarSign },
    { label: 'How to use', to: '/super-admin/help', icon: BookOpenCheck },
  ],
  employee: [
    { label: 'Dashboard', to: '/employee/dashboard', icon: LayoutDashboard },
    { label: 'Attendance', to: '/employee/attendance', icon: ClipboardCheck, module: 'attendance', teaching: true },
    { label: 'Coursework', icon: NotebookPen, teaching: true, sections: [
      { label: 'Assignments', to: '/employee/assignments', module: 'assignments' },
      { label: 'Quizzes', to: '/employee/quizzes', module: 'quizzes' },
      { label: 'Learning', to: '/employee/learning', module: 'learning' },
    ] },
    { label: 'Exam marks', to: '/employee/exams', icon: GraduationCap, module: 'exams', teaching: true },
    // Office pages from the employee's staff roles (principal, accountant, librarian...) go here - see useNav
    {
      group: 'Me', icon: UserRound, items: [
        { label: 'My leave', to: '/employee/leave', icon: CalendarOff, module: 'leave' },
        { label: 'My payslips', to: '/employee/payslips', icon: Banknote, module: 'payroll' },
        { label: 'My visitors', to: '/employee/visitors', icon: DoorOpen, module: 'visitors' },
        { label: 'Notice board', to: '/employee/notices', icon: Megaphone, module: 'notices' },
        { label: 'Help and feedback', to: '/employee/support', icon: LifeBuoy, module: 'grievance' },
        { label: 'How to use', to: '/employee/help', icon: BookOpenCheck },
      ],
    },
  ],
};

/**
 * The bar along the bottom of a phone screen: the four pages a role opens most, plus "Menu" for the rest.
 * Items whose module is switched off are left out.
 */
export const BOTTOM_NAV = {
  student: [
    { label: 'Home', to: '/student/dashboard', icon: LayoutDashboard },
    { label: 'Timetable', to: '/student/timetable', icon: Table2, module: 'timetable' },
    { label: 'Scan', to: '/student/checkin', icon: ScanLine, module: 'qr_checkin' },
    { label: 'Attendance', to: '/student/attendance', icon: CalendarCheck, module: 'attendance' },
    { label: 'Fees', to: '/student/fees', icon: Wallet, module: 'fees' },
  ],
  parent: [
    { label: 'Home', to: '/parent/home', icon: LayoutDashboard },
    { label: 'Attendance', to: '/student/attendance', icon: CalendarCheck, module: 'attendance' },
    { label: 'Fees', to: '/student/fees', icon: Wallet, module: 'fees' },
    { label: 'Results', to: '/student/results', icon: GraduationCap, module: 'exams' },
  ],
  employee: [
    { label: 'Home', to: '/employee/dashboard', icon: LayoutDashboard },
    { label: 'Attendance', to: '/employee/attendance', icon: ClipboardCheck, module: 'attendance', teaching: true },
    { label: 'Coursework', to: '/employee/assignments', icon: NotebookPen, module: 'assignments', also: ['/employee/quizzes', '/employee/learning'], teaching: true },
    { label: 'Leave', to: '/employee/leave', icon: CalendarOff, module: 'leave' },
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

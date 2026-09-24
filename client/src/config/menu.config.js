import { Building2, CalendarDays, LayoutDashboard, Table2, UserRound } from 'lucide-react';

/**
 * Sidebar menus per role. To add a module later: build its page, add a <Route>
 * in App.jsx, and add one line here.
 *
 * Naming note: the reference portal calls the first item "Admin Dashboard".
 * Students get a plain "Dashboard" - rename the label here if you need it changed.
 */
export const MENU = {
  student: [
    { label: 'Dashboard', to: '/student/dashboard', icon: LayoutDashboard },
    { label: 'Profile', to: '/student/profile', icon: UserRound },
    { label: 'Institute', to: '/student/institute', icon: Building2 },
    { label: 'Calendar', to: '/student/calendar', icon: CalendarDays },
    { label: 'Timetable', to: '/student/timetable', icon: Table2 },
  ],
  admin: [{ label: 'Dashboard', to: '/admin/dashboard', icon: LayoutDashboard }],
  super_admin: [{ label: 'Dashboard', to: '/super-admin/dashboard', icon: LayoutDashboard }],
  employee: [{ label: 'Dashboard', to: '/employee/dashboard', icon: LayoutDashboard }],
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
  super_admin: 'Super Admin',
  employee: 'Employee',
};

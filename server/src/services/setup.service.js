/**
 * The setup checklist on a new institute's admin dashboard: the few things to do, in order, before the system is
 * useful (and each one's page). Steps for switched-off modules are left out.
 */
import { q } from '../db/pool.js';

const STEPS = [
  { key: 'institute', label: 'Fill in the institute\'s address, phone and email', to: '/admin/institute', sql: "select (coalesce(address, '') <> '' and coalesce(phone, '') <> '' and coalesce(email, '') <> '') as done from institute_profiles" },
  { key: 'departments', label: 'Add departments and designations', to: '/admin/departments', sql: 'select (select count(*) from departments) > 0 and (select count(*) from designations) > 0 as done' },
  { key: 'courses', label: 'Add the courses or classes you teach', to: '/admin/courses', sql: 'select count(*) > 0 as done from courses' },
  { key: 'employees', label: 'Add staff and give them logins', to: '/admin/employees', sql: 'select count(*) > 0 as done from employees' },
  { key: 'timetable', module: 'timetable', label: 'Build the weekly timetable', to: '/admin/timetable', sql: 'select count(*) > 0 as done from timetable_slots' },
  { key: 'fees', module: 'fees', label: 'Create a fee structure', to: '/admin/fees?tab=structures', sql: 'select count(*) > 0 as done from fee_structures' },
  { key: 'students', module: 'students', label: 'Import or enrol students', to: '/admin/students/import', sql: 'select count(*) > 0 as done from students' },
  { key: 'leave', module: 'leave', label: 'Set up leave types', to: '/admin/leave?tab=types', sql: 'select count(*) > 0 as done from leave_types' },
];

export async function setupStatus(modules = []) {
  const steps = [];
  for (const s of STEPS) {
    if (s.module && !modules.includes(s.module)) continue;
    const { rows: [r] } = await q(s.sql);
    steps.push({ key: s.key, label: s.label, to: s.to, done: Boolean(r?.done) });
  }
  const done = steps.filter((s) => s.done).length;
  return { steps, done, total: steps.length, complete: done === steps.length };
}

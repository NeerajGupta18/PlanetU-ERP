import { db } from '../db/store.js';
import { addDays, parseISO, toISO } from '../utils/dates.js';

const shapeEmployee = (e) => e && ({
  id: e.id, name: e.name, designation: e.designation, shift: e.shift, department: e.department,
});

const uniqueSorted = (arr) => [...new Set(arr)].sort((a, b) => a.localeCompare(b));

/**
 * Builds the dated list of lectures + duties for one course between two dates.
 * Lectures come from the weekly template, skip holidays, and show a
 * "reassigned to" tag when a lecture was handed to another employee for that day.
 */
export function buildTimetable({ courseId, start, end, department, employeeId, subject, priority }) {
  const data = db();
  const course = data.courses.find((c) => c.id === courseId);
  const employees = new Map(data.employees.map((e) => [e.id, e]));
  const slots = data.timetableSlots.filter((s) => s.courseId === courseId);
  const duties = data.duties.filter((d) => d.courseId === courseId);

  const holidayDates = new Set();
  for (const ev of data.events.filter((e) => e.type === 'holiday')) {
    for (let d = parseISO(ev.start); d <= parseISO(ev.end); d = addDays(d, 1)) holidayDates.add(toISO(d));
  }
  const reassigned = new Map(data.reassignments.map((r) => [`${r.slotId}|${r.date}`, r]));

  let items = [];
  for (let d = parseISO(start); d <= parseISO(end); d = addDays(d, 1)) {
    const iso = toISO(d);
    if (holidayDates.has(iso)) continue;
    for (const s of slots.filter((x) => x.weekday === d.getDay())) {
      const emp = employees.get(s.employeeId);
      const re = reassigned.get(`${s.id}|${iso}`);
      items.push({
        id: `${s.id}@${iso}`, type: 'lecture', mode: s.mode, date: iso, start: s.start, end: s.end,
        title: s.subject, employee: shapeEmployee(emp), department: emp.department, course: course.name,
        location: s.location, priority: null,
        reassignedTo: re ? employees.get(re.toEmployeeId).name : null,
      });
    }
  }
  for (const du of duties.filter((x) => x.date >= start && x.date <= end)) {
    const emp = employees.get(du.employeeId);
    items.push({
      id: du.id, type: 'duty', mode: null, date: du.date, start: du.start, end: du.end,
      title: du.title, employee: shapeEmployee(emp), department: emp.department, course: course.name,
      location: du.location, priority: du.priority, reassignedTo: null,
    });
  }

  if (department) items = items.filter((i) => i.department === department);
  if (employeeId) items = items.filter((i) => i.employee.id === employeeId);
  if (subject) items = items.filter((i) => i.type === 'lecture' && i.title === subject);
  if (priority) items = items.filter((i) => i.type === 'duty' && i.priority === priority);

  items.sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start) || a.id.localeCompare(b.id));

  const staffIds = new Set([...slots.map((s) => s.employeeId), ...duties.map((d) => d.employeeId)]);
  return {
    items,
    summary: {
      lectures: items.filter((i) => i.type === 'lecture').length,
      duties: items.filter((i) => i.type === 'duty').length,
      timeSlots: new Set(items.filter((i) => i.type === 'lecture').map((i) => `${i.start}-${i.end}`)).size,
      start, end,
    },
    filters: {
      course: { id: course.id, name: course.name },
      departments: uniqueSorted([...staffIds].map((id) => employees.get(id).department)),
      employees: [...staffIds].map((id) => employees.get(id)).sort((a, b) => a.name.localeCompare(b.name))
        .map((e) => ({ id: e.id, name: e.name })),
      subjects: uniqueSorted(slots.map((s) => s.subject)),
      priorities: ['High', 'Medium', 'Low'],
    },
  };
}

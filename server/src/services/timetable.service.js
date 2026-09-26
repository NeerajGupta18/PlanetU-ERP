import { db, save } from '../db/store.js';
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

/**
 * Same dated-occurrence expansion as buildTimetable, but across every course
 * (or one, if courseId is given) instead of a single student's course - this
 * is what the Admin "Timetable / Lecture Reassignment" module lists.
 */
export function buildAdminTimetable({ start, end, department, employeeId, courseId }) {
  const data = db();
  const courses = new Map(data.courses.map((c) => [c.id, c]));
  const employees = new Map(data.employees.map((e) => [e.id, e]));
  const slots = courseId ? data.timetableSlots.filter((s) => s.courseId === courseId) : data.timetableSlots;
  const duties = courseId ? data.duties.filter((d) => d.courseId === courseId) : data.duties;

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
      const course = courses.get(s.courseId);
      const re = reassigned.get(`${s.id}|${iso}`);
      items.push({
        id: `${s.id}@${iso}`, slotId: s.id, type: 'lecture', mode: s.mode, date: iso, start: s.start, end: s.end,
        title: s.subject, employee: shapeEmployee(emp), department: emp.department, course: course?.name || s.courseId,
        location: s.location, priority: null,
        reassignedTo: re ? shapeEmployee(employees.get(re.toEmployeeId)) : null,
        reassignReason: re?.reason || null,
      });
    }
  }
  for (const du of duties.filter((x) => x.date >= start && x.date <= end)) {
    const emp = employees.get(du.employeeId);
    const course = courses.get(du.courseId);
    items.push({
      id: du.id, slotId: null, type: 'duty', mode: null, date: du.date, start: du.start, end: du.end,
      title: du.title, employee: shapeEmployee(emp), department: emp.department, course: course?.name || du.courseId,
      location: du.location, priority: du.priority, reassignedTo: null, reassignReason: null,
    });
  }

  if (department) items = items.filter((i) => i.department === department);
  if (employeeId) items = items.filter((i) => i.employee.id === employeeId);

  items.sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start) || a.id.localeCompare(b.id));

  return {
    items,
    summary: {
      lectures: items.filter((i) => i.type === 'lecture').length,
      duties: items.filter((i) => i.type === 'duty').length,
      timeSlots: new Set(items.filter((i) => i.type === 'lecture').map((i) => `${i.start}-${i.end}`)).size,
      start, end,
    },
  };
}

/** Reassigns a single dated lecture occurrence to another employee. */
export function reassignLecture({ slotId, date, toEmployeeId, reason }) {
  const data = db();
  const slot = data.timetableSlots.find((s) => s.id === slotId);
  if (!slot) throw new Error('Lecture slot not found');
  if (!data.employees.find((e) => e.id === toEmployeeId)) throw new Error('Employee not found');

  const existing = data.reassignments.find((r) => r.slotId === slotId && r.date === date);
  if (existing) {
    existing.toEmployeeId = toEmployeeId;
    existing.reason = reason || existing.reason;
  } else {
    data.reassignments.push({ slotId, date, toEmployeeId, reason: reason || '' });
  }
  save();
}

/** Reverts a lecture occurrence back to its original weekly-slot employee. */
export function clearReassignment({ slotId, date }) {
  const data = db();
  data.reassignments = data.reassignments.filter((r) => !(r.slotId === slotId && r.date === date));
  save();
}

import { db, save } from '../db/store.js';
import { HttpError } from '../middleware/error.js';
import { newId } from '../utils/ids.js';
import { buildAdminTimetable, clearReassignment, reassignLecture } from '../services/timetable.service.js';
import { addDays, isISO, pad, toISO } from '../utils/dates.js';

/* =========================================================
   Dashboard
   ========================================================= */
export function dashboard(req, res) {
  const data = db();
  const today = toISO(new Date());
  const upcomingEvents = [...data.events]
    .filter((e) => e.end >= today && e.start <= toISO(addDays(new Date(), 30)))
    .sort((a, b) => a.start.localeCompare(b.start))
    .slice(0, 5);

  const range = { start: today, end: toISO(addDays(new Date(), 6)) };
  const weekAhead = buildAdminTimetable(range);

  res.json({
    institute: data.institute,
    stats: {
      totalDepartments: data.departments.length,
      totalDesignations: data.designations.length,
      totalEmployees: data.employees.length,
      totalStudents: data.students.length,
      lecturesNext7Days: weekAhead.summary.lectures,
    },
    upcomingEvents,
  });
}

/* =========================================================
   Institute
   ========================================================= */
export function getInstitute(req, res) {
  res.json({ institute: db().institute });
}

export function updateInstituteDetails(req, res) {
  const i = db().institute;
  const { name, tagline, address, city, state, pincode, phone, email, website } = req.body || {};
  if (!name || !String(name).trim()) throw new HttpError(400, 'Institute name is required.');

  Object.assign(i, {
    name: String(name).trim(),
    tagline: tagline ?? i.tagline,
    address: address ?? i.address,
    city: city ?? i.city,
    state: state ?? i.state,
    pincode: pincode ?? i.pincode,
    phone: phone ?? i.phone,
    email: email ?? i.email,
    website: website ?? i.website,
  });
  save();
  res.json({ institute: i });
}

export function addAuthorizedPerson(req, res) {
  const i = db().institute;
  const { name, designation, email, phone, pan, aadhaar } = req.body || {};
  if (!name || !email) throw new HttpError(400, 'Name and email are required.');

  const person = { name, designation: designation || '', email, phone: phone || '', pan: pan || '', aadhaar: aadhaar || '' };
  i.authorizedPersons.push(person);
  save();
  res.status(201).json({ institute: i });
}

export function updateAuthorizedPerson(req, res) {
  const i = db().institute;
  const idx = Number(req.params.index);
  const person = i.authorizedPersons[idx];
  if (!person) throw new HttpError(404, 'Authorized person not found.');

  const { name, designation, email, phone, pan, aadhaar } = req.body || {};
  Object.assign(person, {
    name: name ?? person.name, designation: designation ?? person.designation, email: email ?? person.email,
    phone: phone ?? person.phone, pan: pan ?? person.pan, aadhaar: aadhaar ?? person.aadhaar,
  });
  save();
  res.json({ institute: i });
}

export function removeAuthorizedPerson(req, res) {
  const i = db().institute;
  const idx = Number(req.params.index);
  if (!i.authorizedPersons[idx]) throw new HttpError(404, 'Authorized person not found.');
  if (i.authorizedPersons.length <= 1) throw new HttpError(409, 'At least one authorized person is required.');

  i.authorizedPersons.splice(idx, 1);
  save();
  res.json({ institute: i });
}

/* ---- Stakeholders ---- */
export function addStakeholder(req, res) {
  const i = db().institute;
  const { name, role, email, phone } = req.body || {};
  if (!name || !role) throw new HttpError(400, 'Name and role are required.');

  i.stakeholders.push({ name, role, email: email || '', phone: phone || '' });
  save();
  res.status(201).json({ institute: i });
}

export function updateStakeholder(req, res) {
  const i = db().institute;
  const idx = Number(req.params.index);
  const s = i.stakeholders[idx];
  if (!s) throw new HttpError(404, 'Stakeholder not found.');

  const { name, role, email, phone } = req.body || {};
  Object.assign(s, { name: name ?? s.name, role: role ?? s.role, email: email ?? s.email, phone: phone ?? s.phone });
  save();
  res.json({ institute: i });
}

export function removeStakeholder(req, res) {
  const i = db().institute;
  const idx = Number(req.params.index);
  if (!i.stakeholders[idx]) throw new HttpError(404, 'Stakeholder not found.');

  i.stakeholders.splice(idx, 1);
  save();
  res.json({ institute: i });
}

/* ---- Documents ---- */
export function addDocument(req, res) {
  const i = db().institute;
  const { name, issuedBy, validTill, status } = req.body || {};
  if (!name || !issuedBy) throw new HttpError(400, 'Document name and issuing authority are required.');

  i.documents.push({ name, issuedBy, validTill: validTill || null, status: status || 'Verified' });
  save();
  res.status(201).json({ institute: i });
}

export function updateDocument(req, res) {
  const i = db().institute;
  const idx = Number(req.params.index);
  const d = i.documents[idx];
  if (!d) throw new HttpError(404, 'Document not found.');

  const { name, issuedBy, validTill, status } = req.body || {};
  Object.assign(d, {
    name: name ?? d.name, issuedBy: issuedBy ?? d.issuedBy,
    validTill: validTill !== undefined ? (validTill || null) : d.validTill, status: status ?? d.status,
  });
  save();
  res.json({ institute: i });
}

export function removeDocument(req, res) {
  const i = db().institute;
  const idx = Number(req.params.index);
  if (!i.documents[idx]) throw new HttpError(404, 'Document not found.');

  i.documents.splice(idx, 1);
  save();
  res.json({ institute: i });
}

/* ---- Beneficiaries (bank accounts) ---- */
export function addBeneficiary(req, res) {
  const i = db().institute;
  const { accountName, bank, branch, accountNumber, ifsc, type } = req.body || {};
  if (!accountName || !bank || !accountNumber) throw new HttpError(400, 'Account name, bank and account number are required.');

  i.beneficiaries.push({ accountName, bank, branch: branch || '', accountNumber, ifsc: ifsc || '', type: type || 'Current' });
  save();
  res.status(201).json({ institute: i });
}

export function updateBeneficiary(req, res) {
  const i = db().institute;
  const idx = Number(req.params.index);
  const b = i.beneficiaries[idx];
  if (!b) throw new HttpError(404, 'Bank account not found.');

  const { accountName, bank, branch, accountNumber, ifsc, type } = req.body || {};
  Object.assign(b, {
    accountName: accountName ?? b.accountName, bank: bank ?? b.bank, branch: branch ?? b.branch,
    accountNumber: accountNumber ?? b.accountNumber, ifsc: ifsc ?? b.ifsc, type: type ?? b.type,
  });
  save();
  res.json({ institute: i });
}

export function removeBeneficiary(req, res) {
  const i = db().institute;
  const idx = Number(req.params.index);
  if (!i.beneficiaries[idx]) throw new HttpError(404, 'Bank account not found.');

  i.beneficiaries.splice(idx, 1);
  save();
  res.json({ institute: i });
}

/* ---- Stamp & e-sign ---- */
export function updateStamp(req, res) {
  const i = db().institute;
  const { stampText, stampSub, signatory, signatoryTitle } = req.body || {};
  if (!stampText || !signatory) throw new HttpError(400, 'Stamp text and signatory name are required.');

  i.stamp = {
    stampText, stampSub: stampSub || '', signatory, signatoryTitle: signatoryTitle || '',
  };
  save();
  res.json({ institute: i });
}

/* =========================================================
   Departments
   ========================================================= */
export function listDepartments(req, res) {
  const data = db();
  const enriched = data.departments.map((d) => ({
    ...d,
    employeeCount: data.employees.filter((e) => e.department === d.name).length,
    designationCount: data.designations.filter((g) => g.department === d.name).length,
  }));
  res.json({ departments: enriched });
}

export function createDepartment(req, res) {
  const data = db();
  const { name, description } = req.body || {};
  if (!name || !String(name).trim()) throw new HttpError(400, 'Department name is required.');
  if (data.departments.some((d) => d.name.toLowerCase() === name.trim().toLowerCase())) {
    throw new HttpError(409, 'A department with this name already exists.');
  }

  const dept = { id: newId('DEPT'), name: name.trim(), description: description || '', createdDate: toISO(new Date()) };
  data.departments.push(dept);
  save();
  res.status(201).json({ department: dept });
}

export function updateDepartment(req, res) {
  const data = db();
  const dept = data.departments.find((d) => d.id === req.params.id);
  if (!dept) throw new HttpError(404, 'Department not found.');

  const { name, description } = req.body || {};
  const oldName = dept.name;
  if (name && name.trim()) dept.name = name.trim();
  if (description !== undefined) dept.description = description;

  // Keep employees / designations pointing at the renamed department.
  if (oldName !== dept.name) {
    data.employees.forEach((e) => { if (e.department === oldName) e.department = dept.name; });
    data.designations.forEach((g) => { if (g.department === oldName) g.department = dept.name; });
  }
  save();
  res.json({ department: dept });
}

export function removeDepartment(req, res) {
  const data = db();
  const dept = data.departments.find((d) => d.id === req.params.id);
  if (!dept) throw new HttpError(404, 'Department not found.');
  if (data.employees.some((e) => e.department === dept.name)) {
    throw new HttpError(409, 'Cannot delete: employees are still assigned to this department.');
  }

  data.departments = data.departments.filter((d) => d.id !== dept.id);
  data.designations = data.designations.filter((g) => g.department !== dept.name);
  save();
  res.json({ success: true });
}

/* =========================================================
   Designations
   ========================================================= */
export function listDesignations(req, res) {
  res.json({ designations: db().designations });
}

export function createDesignation(req, res) {
  const data = db();
  const { name, department } = req.body || {};
  if (!name || !String(name).trim() || !department) throw new HttpError(400, 'Name and department are required.');
  if (!data.departments.some((d) => d.name === department)) throw new HttpError(400, 'Unknown department.');
  if (data.designations.some((g) => g.name === name.trim() && g.department === department)) {
    throw new HttpError(409, 'This designation already exists in that department.');
  }

  const designation = { id: newId('DESG'), name: name.trim(), department };
  data.designations.push(designation);
  save();
  res.status(201).json({ designation });
}

export function removeDesignation(req, res) {
  const data = db();
  const designation = data.designations.find((g) => g.id === req.params.id);
  if (!designation) throw new HttpError(404, 'Designation not found.');
  if (data.employees.some((e) => e.designation === designation.name && e.department === designation.department)) {
    throw new HttpError(409, 'Cannot delete: employees currently hold this designation.');
  }

  data.designations = data.designations.filter((g) => g.id !== designation.id);
  save();
  res.json({ success: true });
}

/* =========================================================
   Employees
   ========================================================= */
export function listEmployees(req, res) {
  const data = db();
  const { department, search } = req.query;
  let list = data.employees;
  if (department) list = list.filter((e) => e.department === department);
  if (search) {
    const s = String(search).toLowerCase();
    list = list.filter((e) => e.name.toLowerCase().includes(s) || e.email.toLowerCase().includes(s));
  }
  res.json({ employees: list });
}

export function createEmployee(req, res) {
  const data = db();
  const { name, email, department, designation, shift } = req.body || {};
  if (!name || !email || !department || !designation) {
    throw new HttpError(400, 'Name, email, department and designation are required.');
  }
  if (!data.departments.some((d) => d.name === department)) throw new HttpError(400, 'Unknown department.');
  if (data.employees.some((e) => e.email.toLowerCase() === email.toLowerCase())) {
    throw new HttpError(409, 'An employee with this email already exists.');
  }

  const employee = {
    id: newId('EMP'), name, email, department, designation, shift: shift || 'Employee shift',
  };
  data.employees.push(employee);
  save();
  res.status(201).json({ employee });
}

export function updateEmployee(req, res) {
  const data = db();
  const employee = data.employees.find((e) => e.id === req.params.id);
  if (!employee) throw new HttpError(404, 'Employee not found.');

  const { name, email, department, designation, shift } = req.body || {};
  if (department && !data.departments.some((d) => d.name === department)) throw new HttpError(400, 'Unknown department.');

  Object.assign(employee, {
    name: name ?? employee.name, email: email ?? employee.email, department: department ?? employee.department,
    designation: designation ?? employee.designation, shift: shift ?? employee.shift,
  });
  save();
  res.json({ employee });
}

export function removeEmployee(req, res) {
  const data = db();
  const employee = data.employees.find((e) => e.id === req.params.id);
  if (!employee) throw new HttpError(404, 'Employee not found.');
  if (data.timetableSlots.some((s) => s.employeeId === employee.id) || data.duties.some((d) => d.employeeId === employee.id)) {
    throw new HttpError(409, 'Cannot delete: this employee has lectures or duties scheduled. Reassign them first.');
  }

  data.employees = data.employees.filter((e) => e.id !== employee.id);
  save();
  res.json({ success: true });
}

/* =========================================================
   Calendar (events) - admin sees and manages every event
   ========================================================= */
export function listEvents(req, res) {
  const year = Number(req.query.year);
  const month = Number(req.query.month);
  if (!Number.isInteger(year) || year < 2000 || year > 2100 || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new HttpError(400, 'Provide a valid year and month (1-12).');
  }
  const first = `${year}-${pad(month)}-01`;
  const last = toISO(new Date(year, month, 0));
  const events = db().events
    .filter((e) => e.start <= last && e.end >= first)
    .sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title))
    .map(({ rel, ...e }) => e);
  res.json({ year, month, events });
}

export function createEvent(req, res) {
  const data = db();
  const { title, type, start, end, allDay, startTime, endTime, location, description, audience } = req.body || {};
  if (!title || !type || !start) throw new HttpError(400, 'Title, type and start date are required.');
  if (!isISO(start) || (end && !isISO(end))) throw new HttpError(400, 'Dates must look like YYYY-MM-DD.');

  const event = {
    id: newId('EVT'), title, type, start, end: end || start, allDay: allDay !== false,
    startTime: startTime || null, endTime: endTime || null,
    location: location || null, description: description || '', audience: audience || 'all',
  };
  data.events.push(event);
  save();
  res.status(201).json({ event });
}

export function updateEvent(req, res) {
  const data = db();
  const event = data.events.find((e) => e.id === req.params.id);
  if (!event) throw new HttpError(404, 'Event not found.');

  const { title, type, start, end, allDay, startTime, endTime, location, description, audience } = req.body || {};
  if (start && !isISO(start)) throw new HttpError(400, 'Start date must look like YYYY-MM-DD.');
  if (end && !isISO(end)) throw new HttpError(400, 'End date must look like YYYY-MM-DD.');

  Object.assign(event, {
    title: title ?? event.title, type: type ?? event.type, start: start ?? event.start, end: end ?? (start ?? event.end),
    allDay: allDay ?? event.allDay, startTime: startTime ?? event.startTime, endTime: endTime ?? event.endTime,
    location: location ?? event.location, description: description ?? event.description, audience: audience ?? event.audience,
  });
  save();
  res.json({ event });
}

export function removeEvent(req, res) {
  const data = db();
  const before = data.events.length;
  data.events = data.events.filter((e) => e.id !== req.params.id);
  if (data.events.length === before) throw new HttpError(404, 'Event not found.');
  save();
  res.json({ success: true });
}

/* =========================================================
   Timetable / Lecture Reassignment
   ========================================================= */
const MAX_RANGE_DAYS = 93;

function validRange(start, end) {
  if (!isISO(start) || !isISO(end)) throw new HttpError(400, 'Dates must look like YYYY-MM-DD.');
  if (end < start) throw new HttpError(400, 'End date cannot be before the start date.');
}

export function timetableFilters(req, res) {
  const data = db();
  res.json({
    courses: data.courses.map((c) => ({ id: c.id, name: c.name })),
    departments: data.departments.map((d) => d.name),
    employees: data.employees.map((e) => ({ id: e.id, name: e.name, department: e.department })),
  });
}

export function listTimetable(req, res) {
  const today = new Date();
  const start = req.query.start || toISO(today);
  const end = req.query.end || toISO(addDays(today, 6));
  validRange(start, end);
  if (Math.round((new Date(end) - new Date(start)) / 86400000) > MAX_RANGE_DAYS) {
    throw new HttpError(400, `Choose a range of ${MAX_RANGE_DAYS} days or fewer.`);
  }

  const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
  res.json(buildAdminTimetable({
    start, end, department: str(req.query.department), employeeId: str(req.query.employeeId), courseId: str(req.query.courseId),
  }));
}

export function listSlots(req, res) {
  const data = db();
  const slots = data.timetableSlots.map((s) => ({
    ...s,
    employeeName: data.employees.find((e) => e.id === s.employeeId)?.name || '—',
    courseName: data.courses.find((c) => c.id === s.courseId)?.name || s.courseId,
  }));
  res.json({ slots });
}

export function createSlot(req, res) {
  const data = db();
  const { courseId, weekday, start, end, subject, employeeId, mode, location } = req.body || {};
  if (!courseId || weekday === undefined || !start || !end || !subject || !employeeId) {
    throw new HttpError(400, 'Course, weekday, start/end time, subject and employee are required.');
  }
  if (!data.courses.find((c) => c.id === courseId)) throw new HttpError(400, 'Unknown course.');
  if (!data.employees.find((e) => e.id === employeeId)) throw new HttpError(400, 'Unknown employee.');

  const slot = {
    id: newId('SLOT'), courseId, weekday: Number(weekday), start, end, subject,
    employeeId, mode: mode || 'Offline', location: location || '', type: 'lecture',
  };
  data.timetableSlots.push(slot);
  save();
  res.status(201).json({ slot });
}

export function updateSlot(req, res) {
  const data = db();
  const slot = data.timetableSlots.find((s) => s.id === req.params.id);
  if (!slot) throw new HttpError(404, 'Lecture slot not found.');

  const { weekday, start, end, subject, employeeId, mode, location } = req.body || {};
  if (employeeId && !data.employees.find((e) => e.id === employeeId)) throw new HttpError(400, 'Unknown employee.');

  Object.assign(slot, {
    weekday: weekday !== undefined ? Number(weekday) : slot.weekday, start: start ?? slot.start, end: end ?? slot.end,
    subject: subject ?? slot.subject, employeeId: employeeId ?? slot.employeeId, mode: mode ?? slot.mode, location: location ?? slot.location,
  });
  save();
  res.json({ slot });
}

export function removeSlot(req, res) {
  const data = db();
  const before = data.timetableSlots.length;
  data.timetableSlots = data.timetableSlots.filter((s) => s.id !== req.params.id);
  if (data.timetableSlots.length === before) throw new HttpError(404, 'Lecture slot not found.');
  data.reassignments = data.reassignments.filter((r) => r.slotId !== req.params.id);
  save();
  res.json({ success: true });
}

export function reassign(req, res) {
  const { slotId, date, toEmployeeId, reason } = req.body || {};
  if (!slotId || !date || !toEmployeeId) throw new HttpError(400, 'slotId, date and toEmployeeId are required.');
  if (!isISO(date)) throw new HttpError(400, 'Date must look like YYYY-MM-DD.');

  try {
    reassignLecture({ slotId, date, toEmployeeId, reason });
  } catch (err) {
    throw new HttpError(400, err.message);
  }
  res.json({ success: true });
}

export function undoReassign(req, res) {
  const { slotId, date } = req.body || {};
  if (!slotId || !date) throw new HttpError(400, 'slotId and date are required.');
  clearReassignment({ slotId, date });
  res.json({ success: true });
}

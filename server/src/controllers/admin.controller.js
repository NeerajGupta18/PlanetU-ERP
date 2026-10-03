import { isUuid, q } from '../db/pool.js';
import { HttpError } from '../middleware/error.js';
import { audit } from '../db/audit.js';
import { nextNumber } from '../db/series.js';
import {
  EVENT_COLUMNS, getInstitute, loadEvents,
} from '../db/repo.js';
import { buildAdminTimetable, clearReassignment, reassignLecture } from '../services/timetable.service.js';
import { addDays, isISO, pad, toISO } from '../utils/dates.js';

const EVENT_TYPES = ['holiday', 'exam', 'event', 'academic', 'deadline'];
const AUDIENCES = ['all', 'student'];

const need = (v, label) => {
  if (!isUuid(v)) throw new HttpError(400, `Invalid ${label}.`);
  return v;
};

/** Turns a database constraint failure into a clean 409/400 instead of a 500. */
async function guard(fn, { unique, foreign } = {}) {
  try {
    return await fn();
  } catch (err) {
    if (err.code === '23505' && unique) throw new HttpError(409, unique);
    if (err.code === '23503' && foreign) throw new HttpError(400, foreign);
    throw err;
  }
}

/* =========================================================
   Dashboard
   ========================================================= */
export async function dashboard(req, res) {
  const today = toISO(new Date());
  const { rows: [c] } = await q(`
    select (select count(*) from departments)::int as "totalDepartments",
           (select count(*) from designations)::int as "totalDesignations",
           (select count(*) from employees)::int as "totalEmployees",
           (select count(*) from students)::int as "totalStudents"`);

  const upcomingEvents = (await loadEvents({ from: today, to: toISO(addDays(new Date(), 30)) })).slice(0, 5);
  const weekAhead = await buildAdminTimetable({ start: today, end: toISO(addDays(new Date(), 6)) });

  res.json({
    institute: await getInstitute(),
    stats: { ...c, lecturesNext7Days: weekAhead.summary.lectures },
    upcomingEvents,
  });
}

/* =========================================================
   Institute
   ========================================================= */
export async function getInstituteDetails(req, res) {
  res.json({ institute: await getInstitute() });
}

export async function updateInstituteDetails(req, res) {
  const cur = await getInstitute();
  const { name, tagline, address, city, state, pincode, phone, email, website } = req.body || {};
  if (!name || !String(name).trim()) throw new HttpError(400, 'Institute name is required.');

  await q(
    `update institute_profiles set name = $1, tagline = $2, address = $3, city = $4, state = $5, pincode = $6,
       phone = $7, email = $8, website = $9`,
    [String(name).trim(), tagline ?? cur.tagline, address ?? cur.address, city ?? cur.city, state ?? cur.state,
      pincode ?? cur.pincode, phone ?? cur.phone, email ?? cur.email, website ?? cur.website],
  );
  await audit(req.user, 'institute.update', 'institute');
  res.json({ institute: await getInstitute() });
}

// The institute's list-type records (stakeholders, documents, ...) live as JSON arrays on the profile row.
const LISTS = {
  authorizedPersons: 'authorized_persons', stakeholders: 'stakeholders', documents: 'documents', beneficiaries: 'beneficiaries',
};

async function editList(name, edit) {
  const col = LISTS[name];
  const { rows: [r] } = await q(`select ${col} as arr from institute_profiles for update`);
  const arr = r.arr;
  edit(arr);
  await q(`update institute_profiles set ${col} = $1::jsonb`, [JSON.stringify(arr)]);
  return getInstitute();
}

const at = (arr, idx, label) => {
  const item = arr[Number(idx)];
  if (!item) throw new HttpError(404, `${label} not found.`);
  return item;
};

/* ---- Authorized persons ---- */
export async function addAuthorizedPerson(req, res) {
  const { name, designation, email, phone, pan, aadhaar } = req.body || {};
  if (!name || !email) throw new HttpError(400, 'Name and email are required.');
  const institute = await editList('authorizedPersons', (arr) => arr.push({
    name, designation: designation || '', email, phone: phone || '', pan: pan || '', aadhaar: aadhaar || '',
  }));
  res.status(201).json({ institute });
}

export async function updateAuthorizedPerson(req, res) {
  const { name, designation, email, phone, pan, aadhaar } = req.body || {};
  const institute = await editList('authorizedPersons', (arr) => {
    const p = at(arr, req.params.index, 'Authorized person');
    Object.assign(p, {
      name: name ?? p.name, designation: designation ?? p.designation, email: email ?? p.email,
      phone: phone ?? p.phone, pan: pan ?? p.pan, aadhaar: aadhaar ?? p.aadhaar,
    });
  });
  res.json({ institute });
}

export async function removeAuthorizedPerson(req, res) {
  const institute = await editList('authorizedPersons', (arr) => {
    at(arr, req.params.index, 'Authorized person');
    if (arr.length <= 1) throw new HttpError(409, 'At least one authorized person is required.');
    arr.splice(Number(req.params.index), 1);
  });
  res.json({ institute });
}

/* ---- Stakeholders ---- */
export async function addStakeholder(req, res) {
  const { name, role, email, phone } = req.body || {};
  if (!name || !role) throw new HttpError(400, 'Name and role are required.');
  const institute = await editList('stakeholders', (arr) => arr.push({ name, role, email: email || '', phone: phone || '' }));
  res.status(201).json({ institute });
}

export async function updateStakeholder(req, res) {
  const { name, role, email, phone } = req.body || {};
  const institute = await editList('stakeholders', (arr) => {
    const s = at(arr, req.params.index, 'Stakeholder');
    Object.assign(s, { name: name ?? s.name, role: role ?? s.role, email: email ?? s.email, phone: phone ?? s.phone });
  });
  res.json({ institute });
}

export async function removeStakeholder(req, res) {
  const institute = await editList('stakeholders', (arr) => {
    at(arr, req.params.index, 'Stakeholder');
    arr.splice(Number(req.params.index), 1);
  });
  res.json({ institute });
}

/* ---- Documents ---- */
export async function addDocument(req, res) {
  const { name, issuedBy, validTill, status } = req.body || {};
  if (!name || !issuedBy) throw new HttpError(400, 'Document name and issuing authority are required.');
  const institute = await editList('documents', (arr) => arr.push({
    name, issuedBy, validTill: validTill || null, status: status || 'Verified',
  }));
  res.status(201).json({ institute });
}

export async function updateDocument(req, res) {
  const { name, issuedBy, validTill, status } = req.body || {};
  const institute = await editList('documents', (arr) => {
    const d = at(arr, req.params.index, 'Document');
    Object.assign(d, {
      name: name ?? d.name, issuedBy: issuedBy ?? d.issuedBy,
      validTill: validTill !== undefined ? (validTill || null) : d.validTill, status: status ?? d.status,
    });
  });
  res.json({ institute });
}

export async function removeDocument(req, res) {
  const institute = await editList('documents', (arr) => {
    at(arr, req.params.index, 'Document');
    arr.splice(Number(req.params.index), 1);
  });
  res.json({ institute });
}

/* ---- Beneficiaries (bank accounts) ---- */
export async function addBeneficiary(req, res) {
  const { accountName, bank, branch, accountNumber, ifsc, type } = req.body || {};
  if (!accountName || !bank || !accountNumber) throw new HttpError(400, 'Account name, bank and account number are required.');
  const institute = await editList('beneficiaries', (arr) => arr.push({
    accountName, bank, branch: branch || '', accountNumber, ifsc: ifsc || '', type: type || 'Current',
  }));
  res.status(201).json({ institute });
}

export async function updateBeneficiary(req, res) {
  const { accountName, bank, branch, accountNumber, ifsc, type } = req.body || {};
  const institute = await editList('beneficiaries', (arr) => {
    const b = at(arr, req.params.index, 'Bank account');
    Object.assign(b, {
      accountName: accountName ?? b.accountName, bank: bank ?? b.bank, branch: branch ?? b.branch,
      accountNumber: accountNumber ?? b.accountNumber, ifsc: ifsc ?? b.ifsc, type: type ?? b.type,
    });
  });
  res.json({ institute });
}

export async function removeBeneficiary(req, res) {
  const institute = await editList('beneficiaries', (arr) => {
    at(arr, req.params.index, 'Bank account');
    arr.splice(Number(req.params.index), 1);
  });
  res.json({ institute });
}

/* ---- Stamp & e-sign ---- */
export async function updateStamp(req, res) {
  const { stampText, stampSub, signatory, signatoryTitle } = req.body || {};
  if (!stampText || !signatory) throw new HttpError(400, 'Stamp text and signatory name are required.');
  await q('update institute_profiles set stamp = $1::jsonb', [
    JSON.stringify({ stampText, stampSub: stampSub || '', signatory, signatoryTitle: signatoryTitle || '' }),
  ]);
  res.json({ institute: await getInstitute() });
}

/* =========================================================
   Departments
   ========================================================= */
const DEPT_SELECT = `
  select d.id, d.name, d.description, d.created_date as "createdDate",
         (select count(*) from employees e where e.department_id = d.id)::int as "employeeCount",
         (select count(*) from designations g where g.department_id = d.id)::int as "designationCount"
  from departments d`;

export async function listDepartments(req, res) {
  const { rows } = await q(`${DEPT_SELECT} order by d.created_date, d.name`);
  res.json({ departments: rows });
}

export async function createDepartment(req, res) {
  const { name, description } = req.body || {};
  if (!name || !String(name).trim()) throw new HttpError(400, 'Department name is required.');
  const { rows: [d] } = await guard(
    () => q('insert into departments (name, description) values ($1, $2) returning id', [name.trim(), description || '']),
    { unique: 'A department with this name already exists.' },
  );
  const { rows: [dept] } = await q(`${DEPT_SELECT} where d.id = $1`, [d.id]);
  res.status(201).json({ department: dept });
}

export async function updateDepartment(req, res) {
  const { name, description } = req.body || {};
  const { rowCount } = await guard(
    () => q(
      `update departments set name = coalesce(nullif(trim($1), ''), name), description = coalesce($2, description)
       where id = $3`,
      [name ?? '', description ?? null, req.params.id],
    ),
    { unique: 'A department with this name already exists.' },
  );
  if (!rowCount) throw new HttpError(404, 'Department not found.');
  const { rows: [dept] } = await q(`${DEPT_SELECT} where d.id = $1`, [req.params.id]);
  res.json({ department: dept });
}

export async function removeDepartment(req, res) {
  const { rows: [d] } = await q('select id from departments where id = $1', [req.params.id]);
  if (!d) throw new HttpError(404, 'Department not found.');
  const { rows: [use] } = await q(
    `select (select count(*) from employees where department_id = $1)::int as emps,
            (select count(*) from courses where department_id = $1)::int as courses`,
    [req.params.id],
  );
  if (use.emps) throw new HttpError(409, 'Cannot delete: employees are still assigned to this department.');
  if (use.courses) throw new HttpError(409, 'Cannot delete: courses still belong to this department.');
  await q('delete from departments where id = $1', [req.params.id]); // its designations go with it
  res.json({ success: true });
}

/* =========================================================
   Designations
   ========================================================= */
export async function listDesignations(req, res) {
  const { rows } = await q(`
    select g.id, g.name, d.name as department
    from designations g join departments d on d.id = g.department_id
    order by d.name, g.name`);
  res.json({ designations: rows });
}

async function deptId(name) {
  const { rows: [d] } = await q('select id from departments where lower(name) = lower($1)', [String(name)]);
  return d?.id;
}

export async function createDesignation(req, res) {
  const { name, department } = req.body || {};
  if (!name || !String(name).trim() || !department) throw new HttpError(400, 'Name and department are required.');
  const dId = await deptId(department);
  if (!dId) throw new HttpError(400, 'Unknown department.');
  const { rows: [g] } = await guard(
    () => q('insert into designations (department_id, name) values ($1, $2) returning id, name', [dId, name.trim()]),
    { unique: 'This designation already exists in that department.' },
  );
  res.status(201).json({ designation: { ...g, department } });
}

export async function removeDesignation(req, res) {
  const { rows: [g] } = await q('select id from designations where id = $1', [req.params.id]);
  if (!g) throw new HttpError(404, 'Designation not found.');
  const { rows: [{ n }] } = await q('select count(*)::int as n from employees where designation_id = $1', [req.params.id]);
  if (n) throw new HttpError(409, 'Cannot delete: employees currently hold this designation.');
  await q('delete from designations where id = $1', [req.params.id]);
  res.json({ success: true });
}

/* =========================================================
   Employees
   ========================================================= */
const EMP_SELECT = `
  select e.id, e.emp_code as code, e.name, e.email, e.shift, d.name as department, g.name as designation
  from employees e
  join departments d on d.id = e.department_id
  join designations g on g.id = e.designation_id`;

async function employeeById(id) {
  const { rows: [e] } = await q(`${EMP_SELECT} where e.id = $1`, [id]);
  return e;
}

async function designationId(departmentId, name) {
  const { rows: [g] } = await q(
    'select id from designations where department_id = $1 and lower(name) = lower($2)', [departmentId, String(name)],
  );
  return g?.id;
}

export async function listEmployees(req, res) {
  const { department, search } = req.query;
  const where = [];
  const params = [];
  if (department) { params.push(String(department)); where.push(`lower(d.name) = lower($${params.length})`); }
  if (search) { params.push(`%${String(search).toLowerCase()}%`); where.push(`(lower(e.name) like $${params.length} or lower(e.email) like $${params.length})`); }
  const { rows } = await q(`${EMP_SELECT} ${where.length ? `where ${where.join(' and ')}` : ''} order by e.emp_code`, params);
  res.json({ employees: rows });
}

export async function createEmployee(req, res) {
  const { name, email, department, designation, shift } = req.body || {};
  if (!name || !email || !department || !designation) {
    throw new HttpError(400, 'Name, email, department and designation are required.');
  }
  const dId = await deptId(department);
  if (!dId) throw new HttpError(400, 'Unknown department.');
  const gId = await designationId(dId, designation);
  if (!gId) throw new HttpError(400, 'Unknown designation for that department.');

  const code = await nextNumber('employee', { prefix: 'EMP', padding: 3 });
  const { rows: [e] } = await guard(
    () => q(
      `insert into employees (emp_code, name, email, department_id, designation_id, shift)
       values ($1, $2, $3, $4, $5, $6) returning id`,
      [code, name, email, dId, gId, shift || 'Employee shift'],
    ),
    { unique: 'An employee with this email already exists.' },
  );
  await audit(req.user, 'employee.create', 'employee', e.id, { code });
  res.status(201).json({ employee: await employeeById(e.id) });
}

export async function updateEmployee(req, res) {
  const cur = await employeeById(req.params.id);
  if (!cur) throw new HttpError(404, 'Employee not found.');
  const { name, email, department, designation, shift } = req.body || {};

  const dept = department ?? cur.department;
  const dId = await deptId(dept);
  if (!dId) throw new HttpError(400, 'Unknown department.');
  const gId = await designationId(dId, designation ?? cur.designation);
  if (!gId) throw new HttpError(400, 'Unknown designation for that department.');

  await guard(
    () => q(
      `update employees set name = $1, email = $2, department_id = $3, designation_id = $4, shift = $5 where id = $6`,
      [name ?? cur.name, email ?? cur.email, dId, gId, shift ?? cur.shift, req.params.id],
    ),
    { unique: 'An employee with this email already exists.' },
  );
  await audit(req.user, 'employee.update', 'employee', req.params.id);
  res.json({ employee: await employeeById(req.params.id) });
}

export async function removeEmployee(req, res) {
  const cur = await employeeById(req.params.id);
  if (!cur) throw new HttpError(404, 'Employee not found.');
  const { rows: [use] } = await q(
    `select (select count(*) from timetable_slots where employee_id = $1)::int
          + (select count(*) from duties where employee_id = $1)::int
          + (select count(*) from reassignments where to_employee_id = $1)::int as n`,
    [req.params.id],
  );
  if (use.n) throw new HttpError(409, 'Cannot delete: this employee has lectures or duties scheduled. Reassign them first.');
  await q('delete from employees where id = $1', [req.params.id]); // also removes their login account
  await audit(req.user, 'employee.delete', 'employee', req.params.id, { code: cur.code });
  res.json({ success: true });
}

/* =========================================================
   Calendar (events) - admin sees and manages every event
   ========================================================= */
export async function listEvents(req, res) {
  const year = Number(req.query.year);
  const month = Number(req.query.month);
  if (!Number.isInteger(year) || year < 2000 || year > 2100 || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new HttpError(400, 'Provide a valid year and month (1-12).');
  }
  const first = `${year}-${pad(month)}-01`;
  const last = toISO(new Date(year, month, 0));
  res.json({ year, month, events: await loadEvents({ from: first, to: last }) });
}

const eventById = async (id) => (await q(`select ${EVENT_COLUMNS} from events where id = $1`, [id])).rows[0];

export async function createEvent(req, res) {
  const { title, type, start, end, startTime, endTime, location, description, audience } = req.body || {};
  if (!title || !type || !start) throw new HttpError(400, 'Title, type and start date are required.');
  if (!EVENT_TYPES.includes(type)) throw new HttpError(400, 'Unknown event type.');
  if (audience && !AUDIENCES.includes(audience)) throw new HttpError(400, 'Unknown audience.');
  if (!isISO(start) || (end && !isISO(end))) throw new HttpError(400, 'Dates must look like YYYY-MM-DD.');
  if (end && end < start) throw new HttpError(400, 'End date cannot be before the start date.');

  const { rows: [e] } = await q(
    `insert into events (title, type, start_date, end_date, all_day, start_time, end_time, location, description, audience)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning id`,
    [title, type, start, end || start, !startTime, startTime || null, endTime || null, location || null,
      description || '', audience || 'all'],
  );
  res.status(201).json({ event: await eventById(e.id) });
}

export async function updateEvent(req, res) {
  const cur = await eventById(req.params.id);
  if (!cur) throw new HttpError(404, 'Event not found.');
  const { title, type, start, end, startTime, endTime, location, description, audience } = req.body || {};
  if (type && !EVENT_TYPES.includes(type)) throw new HttpError(400, 'Unknown event type.');
  if (audience && !AUDIENCES.includes(audience)) throw new HttpError(400, 'Unknown audience.');
  if (start && !isISO(start)) throw new HttpError(400, 'Start date must look like YYYY-MM-DD.');
  if (end && !isISO(end)) throw new HttpError(400, 'End date must look like YYYY-MM-DD.');

  const nStart = start ?? cur.start;
  const nEnd = end ?? (start ?? cur.end);
  if (nEnd < nStart) throw new HttpError(400, 'End date cannot be before the start date.');
  const nStartTime = startTime !== undefined ? (startTime || null) : cur.startTime;

  await q(
    `update events set title = $1, type = $2, start_date = $3, end_date = $4, all_day = $5, start_time = $6,
       end_time = $7, location = $8, description = $9, audience = $10, seed_key = null where id = $11`,
    [title ?? cur.title, type ?? cur.type, nStart, nEnd, !nStartTime, nStartTime,
      endTime !== undefined ? (endTime || null) : cur.endTime, location !== undefined ? (location || null) : cur.location,
      description ?? cur.description, audience ?? cur.audience, req.params.id],
  );
  res.json({ event: await eventById(req.params.id) });
}

export async function removeEvent(req, res) {
  const { rowCount } = await q('delete from events where id = $1', [req.params.id]);
  if (!rowCount) throw new HttpError(404, 'Event not found.');
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

export async function timetableFilters(req, res) {
  const [courses, departments, employees] = await Promise.all([
    q('select id, name from courses order by name'),
    q('select name from departments order by name'),
    q(`select e.id, e.name, d.name as department from employees e join departments d on d.id = e.department_id order by e.name`),
  ]);
  res.json({ courses: courses.rows, departments: departments.rows.map((d) => d.name), employees: employees.rows });
}

export async function listTimetable(req, res) {
  const today = new Date();
  const start = req.query.start || toISO(today);
  const end = req.query.end || toISO(addDays(today, 6));
  validRange(start, end);
  if (Math.round((new Date(end) - new Date(start)) / 86400000) > MAX_RANGE_DAYS) {
    throw new HttpError(400, `Choose a range of ${MAX_RANGE_DAYS} days or fewer.`);
  }

  const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
  const uid = (v) => (isUuid(str(v)) ? str(v) : undefined);
  if ((str(req.query.employeeId) && !uid(req.query.employeeId)) || (str(req.query.courseId) && !uid(req.query.courseId))) {
    throw new HttpError(400, 'Invalid filter.');
  }
  res.json(await buildAdminTimetable({
    start, end, department: str(req.query.department), employeeId: uid(req.query.employeeId), courseId: uid(req.query.courseId),
  }));
}

const SLOT_SELECT = `
  select s.id, s.course_id as "courseId", s.weekday, s.start_time as start, s.end_time as "end", s.subject,
         s.employee_id as "employeeId", s.mode, s.location, s.type,
         e.name as "employeeName", c.name as "courseName"
  from timetable_slots s
  join employees e on e.id = s.employee_id
  join courses c on c.id = s.course_id`;

const slotById = async (id) => (await q(`${SLOT_SELECT} where s.id = $1`, [id])).rows[0];

export async function listSlots(req, res) {
  const { rows } = await q(`${SLOT_SELECT} order by s.weekday, s.start_time, c.name`);
  res.json({ slots: rows });
}

export async function createSlot(req, res) {
  const { courseId, weekday, start, end, subject, employeeId, mode, location } = req.body || {};
  if (!courseId || weekday === undefined || !start || !end || !subject || !employeeId) {
    throw new HttpError(400, 'Course, weekday, start/end time, subject and employee are required.');
  }
  need(courseId, 'course'); need(employeeId, 'employee');
  if (mode && !['Online', 'Offline'].includes(mode)) throw new HttpError(400, 'Mode must be Online or Offline.');

  const { rows: [s] } = await guard(
    () => q(
      `insert into timetable_slots (course_id, weekday, start_time, end_time, subject, employee_id, mode, location)
       values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
      [courseId, Number(weekday), start, end, subject, employeeId, mode || 'Offline', location || ''],
    ),
    { foreign: 'Unknown course or employee.' },
  );
  res.status(201).json({ slot: await slotById(s.id) });
}

export async function updateSlot(req, res) {
  const cur = await slotById(req.params.id);
  if (!cur) throw new HttpError(404, 'Lecture slot not found.');
  const { weekday, start, end, subject, employeeId, mode, location } = req.body || {};
  if (employeeId) need(employeeId, 'employee');
  if (mode && !['Online', 'Offline'].includes(mode)) throw new HttpError(400, 'Mode must be Online or Offline.');

  await guard(
    () => q(
      `update timetable_slots set weekday = $1, start_time = $2, end_time = $3, subject = $4, employee_id = $5,
         mode = $6, location = $7 where id = $8`,
      [weekday !== undefined ? Number(weekday) : cur.weekday, start ?? cur.start, end ?? cur.end, subject ?? cur.subject,
        employeeId ?? cur.employeeId, mode ?? cur.mode, location ?? cur.location, req.params.id],
    ),
    { foreign: 'Unknown employee.' },
  );
  res.json({ slot: await slotById(req.params.id) });
}

export async function removeSlot(req, res) {
  const { rowCount } = await q('delete from timetable_slots where id = $1', [req.params.id]); // reassignments cascade
  if (!rowCount) throw new HttpError(404, 'Lecture slot not found.');
  res.json({ success: true });
}

export async function reassign(req, res) {
  const { slotId, date, toEmployeeId, reason } = req.body || {};
  if (!slotId || !date || !toEmployeeId) throw new HttpError(400, 'slotId, date and toEmployeeId are required.');
  need(slotId, 'slot'); need(toEmployeeId, 'employee');
  if (!isISO(date)) throw new HttpError(400, 'Date must look like YYYY-MM-DD.');

  try {
    await reassignLecture({ slotId, date, toEmployeeId, reason });
  } catch (err) {
    throw new HttpError(400, err.message);
  }
  await audit(req.user, 'timetable.reassign', 'slot', slotId, { date, toEmployeeId });
  res.json({ success: true });
}

export async function undoReassign(req, res) {
  const { slotId, date } = req.body || {};
  if (!slotId || !date) throw new HttpError(400, 'slotId and date are required.');
  need(slotId, 'slot');
  if (!isISO(date)) throw new HttpError(400, 'Date must look like YYYY-MM-DD.');
  await clearReassignment({ slotId, date });
  res.json({ success: true });
}

/* =========================================================
   Audit trail
   ========================================================= */
export async function listAudit(req, res) {
  const { rows } = await q(`
    select a.id, a.action, a.entity, a.entity_id as "entityId", a.meta, a.at, a.actor_role as "actorRole", u.name as "actorName"
    from audit_log a left join users u on u.id = a.actor_id
    order by a.at desc, a.id desc limit 100`);
  res.json({ entries: rows });
}

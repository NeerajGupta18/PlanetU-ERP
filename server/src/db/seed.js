import * as storage from '../storage/index.js';
/**
 * Demo data. Everything here is FICTIONAL sample data.
 *
 * seedDemoTenants() provisions the demo clients through the SAME service the
 * vendor console uses (provisionTenant), then fills each with sample records.
 * It connects as the restricted application role like the API does, so Row
 * Level Security applies to seeding too (nothing here bypasses tenant isolation).
 */
import { gradeAttempt } from '../services/quizGrading.js';
import * as feesSvc from '../services/fees.service.js';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { q, switchTenant, withTx } from './pool.js';
import { nextNumber } from './series.js';
import { provisionTenant } from '../services/tenant.service.js';
import {
  DEMO_PASSWORDS, DEMO_TENANTS, DIVISIONS, divisionCourse, rosterFor,
} from './demo-data.js';
import { addDays, parseISO, toISO } from '../utils/dates.js';

/* ---------- rolling demo data (dates re-anchored to "today") ---------- */

const FIXED_HOLIDAYS = [
  ['01-26', 'Republic Day'], ['04-14', 'Dr. B. R. Ambedkar Jayanti'], ['08-15', 'Independence Day'],
  ['10-02', 'Gandhi Jayanti'], ['12-25', 'Christmas'],
];
const LUNAR_2026 = [['2026-10-20', 'Dussehra'], ['2026-11-08', 'Diwali'], ['2026-11-24', 'Guru Nanak Gurpurab']];

const ROLLING_EVENTS = [
  { key: 'ptm', title: 'Parent-Teacher Meeting', type: 'academic', rel: [-5], time: ['10:00', '13:00'], location: 'Main Auditorium', description: 'Progress discussion with parents and guardians.' },
  { key: 'guest', title: 'Guest Lecture: Applied AI in Industry', type: 'event', rel: [3], time: ['11:00', '12:30'], location: 'Seminar Hall', description: 'Industry speaker session open to everyone.' },
  { key: 'fee', title: 'Fee Payment - Last Date', type: 'deadline', rel: [7], time: null, location: null, description: 'Pay the fee before this date to avoid a late fine.' },
  { key: 'mid', title: 'Mid-Term Examinations', type: 'exam', rel: [10, 15], time: ['10:00', '13:00'], location: 'Exam Halls 1-3', description: 'Admit cards will be available a week before the exams.' },
  { key: 'synopsis', title: 'Project Synopsis Submission', type: 'deadline', rel: [14], time: null, location: null, description: 'Submit the synopsis to your project guide.' },
  { key: 'fest', title: 'Annual Tech Fest', type: 'event', rel: [21, 22], time: ['09:30', '17:00'], location: 'Main Campus', description: 'Hackathon, project showcase and coding contests.' },
  { key: 'sports', title: 'Annual Sports Day', type: 'event', rel: [32], time: ['08:00', '16:00'], location: 'Campus Ground', description: 'Track and field events and inter-department matches.' },
  { key: 'end', title: 'End-Term Examinations', type: 'exam', rel: [62, 74], time: ['10:00', '13:00'], location: 'Exam Halls 1-3', description: 'Detailed date sheet will be shared by the exam cell.' },
];

const ROLLING_DUTIES = [
  { key: 'd1', title: 'Mid-Term Exam Invigilation', emp: 'EMP002', start: '10:00', end: '13:00', priority: 'High', location: 'Exam Hall 1', rel: 10 },
  { key: 'd2', title: 'Lab Inspection', emp: 'EMP004', start: '14:00', end: '15:00', priority: 'Medium', location: 'Main Lab', rel: 4 },
  { key: 'd3', title: 'Internal Marks Moderation', emp: 'EMP001', start: '11:00', end: '12:00', priority: 'Low', location: 'Staff Room', rel: 12 },
];

const ROLLING_NOTICES = [
  { key: 'n1', title: 'Mid-term examination schedule released', body: 'The date sheet is available on the Calendar page.', category: 'Exam', rel: -1, priority: 'important', pinned: true },
  { key: 'n2', title: 'Library timings extended', body: 'The library stays open until 7:00 PM on all working days during exam preparation.', category: 'General', rel: -3 },
  { key: 'n3', title: 'Tech fest registrations open', body: 'Register your team at the department office.', category: 'Event', rel: -4 },
  { key: 'n4', title: 'Fee reminder', body: 'Please clear pending dues before the last date shown on the Calendar.', category: 'Fees', rel: -6, audience: 'students' },
  { key: 'n5', title: 'Staff meeting on Friday', body: 'All faculty are requested to attend the monthly staff meeting in the conference room.', category: 'General', rel: -2, audience: 'employees' },
];

/**
 * Re-anchors the rolling sample data (relative events, duties, notices and the
 * sample lecture reassignment) for the CURRENT tenant to today's date. Rows are
 * matched by seed_key, so anything an admin added by hand is left alone.
 */
export async function refreshRollingData() {
  const now = new Date();
  const at = (o) => toISO(addDays(now, o));
  const year = now.getFullYear();

  const upsertEvent = (key, e) => q(
    `insert into events (title, type, start_date, end_date, all_day, start_time, end_time, location, description, audience, seed_key)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     on conflict (tenant_id, seed_key) where seed_key is not null
     do update set start_date = excluded.start_date, end_date = excluded.end_date`,
    [e.title, e.type, e.start, e.end, !e.time, e.time?.[0] ?? null, e.time?.[1] ?? null, e.location ?? null, e.description, e.audience, key],
  );

  for (const y of [year - 1, year, year + 1]) {
    for (const [md, title] of FIXED_HOLIDAYS) {
      await upsertEvent(`hol:${y}-${md}`, { title, type: 'holiday', start: `${y}-${md}`, end: `${y}-${md}`, description: 'Institute closed. Public holiday.', audience: 'all' });
    }
  }
  for (const [d, title] of LUNAR_2026) {
    await upsertEvent(`hol:${d}`, { title, type: 'holiday', start: d, end: d, description: 'Institute closed. Public holiday.', audience: 'all' });
  }
  for (const e of ROLLING_EVENTS) {
    await upsertEvent(`roll:${e.key}`, { ...e, start: at(e.rel[0]), end: at(e.rel[1] ?? e.rel[0]), audience: 'student' });
  }

  const { rows: [course] } = await q('select id from courses order by code limit 1');
  if (course) {
    for (const d of ROLLING_DUTIES) {
      await q(
        `insert into duties (course_id, title, employee_id, duty_date, start_time, end_time, priority, location, seed_key)
         select $1, $2, e.id, $3, $4, $5, $6, $7, $8 from employees e where e.emp_code = $9
         on conflict (tenant_id, seed_key) where seed_key is not null do update set duty_date = excluded.duty_date`,
        [course.id, d.title, at(d.rel), d.start, d.end, d.priority, d.location, `roll:${d.key}`, d.emp],
      );
    }
  }
  for (const n of ROLLING_NOTICES) {
    await q(
      `insert into notices (title, body, category, notice_date, audience, priority, pinned, seed_key) values ($1, $2, $3, $4, $5, $6, $7, $8)
       on conflict (tenant_id, seed_key) where seed_key is not null do update set notice_date = excluded.notice_date`,
      [n.title, n.body, n.category, at(n.rel), n.audience ?? 'all', n.priority ?? 'normal', n.pinned ?? false, `roll:${n.key}`],
    );
  }

  // Sample "lecture reassigned" case on the next working day (second period of the day)
  await q('delete from reassignments where seed_key is not null');
  const { rows: hol } = await q("select start_date as d from events where type = 'holiday'");
  const holidays = new Set(hol.map((h) => h.d));
  let day = new Date(now);
  for (let i = 0; i < 10; i += 1) {
    const wd = day.getDay();
    if (wd >= 1 && wd <= 5 && !holidays.has(toISO(day))) break;
    day = addDays(day, 1);
  }
  const { rows: slots } = await q(
    `select s.id, e.emp_code from timetable_slots s join employees e on e.id = s.employee_id
     where s.weekday = $1 and s.course_id = $2 order by s.start_time`,
    [day.getDay(), course?.id || null],
  );
  const target = slots[1];
  if (target) {
    const toCode = target.emp_code === 'EMP004' ? 'EMP003' : 'EMP004';
    await q(
      `insert into reassignments (slot_id, on_date, to_employee_id, reason, seed_key)
       select $1, $2, e.id, 'Faculty on leave', 'roll:reassign' from employees e where e.emp_code = $3
       on conflict (tenant_id, slot_id, on_date) do nothing`,
      [target.id, toISO(day), toCode],
    );
  }
  await topUpAttendanceHistory(now, holidays);
}

/** A fixed number in [0, 1) from a string, so the sample attendance is the same every time it is generated. */
const chance = (key) => crypto.createHash('md5').update(key).digest().readUInt32BE(0) / 2 ** 32;

/**
 * Sample attendance for the past six weeks or so, so the dashboards' attendance figures and trend have something to
 * show. Fills only lectures that have no attendance yet (a lecture someone marked by hand is left alone), never
 * today's or later, and skips holidays. Each student keeps roughly their usual rate (from the old static figures),
 * with the weakest student a little under the 75% minimum so the "below 75%" lists are not empty.
 */
async function topUpAttendanceHistory(now, holidays) {
  const { rows: [t] } = await q('select type from tenants where id = app_tenant()');
  const daily = t?.type === 'school';
  // A school takes one register a day (the first lecture of the class, by the class teacher); other institutes one per lecture
  const { rows: all } = await q(
    `select s.id, s.weekday, s.course_id, s.subject, s.start_time::text as start, s.end_time::text as "end",
            coalesce(c.class_teacher_id, s.employee_id) as class_teacher, s.employee_id
     from timetable_slots s join courses c on c.id = s.course_id order by s.course_id, s.weekday, s.start_time, s.id`,
  );
  const seen = new Set();
  const slots = daily
    ? all.filter((x) => { const k = `${x.course_id}|${x.weekday}`; if (seen.has(k)) return false; seen.add(k); return true; })
      .map((x) => ({ ...x, subject: 'Daily attendance', employee_id: x.class_teacher }))
    : all;
  if (!slots.length) return;
  const { rows: studs } = await q("select id, student_code as code, course_id, attendance from students where status = 'Active' order by student_code");
  const rate = new Map();
  for (const st of studs) {
    const a = (st.attendance || []).reduce((acc, x) => ({ att: acc.att + Number(x.attended || 0), tot: acc.tot + Number(x.total || 0) }), { att: 0, tot: 0 });
    rate.set(st.id, a.tot ? a.att / a.tot : 0.85);
  }
  const lowest = [...rate.entries()].sort((x, y) => x[1] - y[1])[0];
  if (lowest && lowest[1] < 0.8) rate.set(lowest[0], 0.74);
  const byCourse = new Map();
  for (const st of studs) { if (!byCourse.has(st.course_id)) byCourse.set(st.course_id, []); byCourse.get(st.course_id).push(st); }

  const { rows: done } = await q("select slot_id, on_date::text as d from attendance_sessions where on_date >= $1::date and slot_id is not null", [toISO(addDays(now, -46))]);
  const have = new Set(done.map((r) => `${r.slot_id}|${r.d}`));
  for (let back = 45; back >= 1; back -= 1) {
    const day = addDays(now, -back);
    const iso = toISO(day);
    if (holidays.has(iso) || day.getDay() === 0 || day.getDay() === 6) continue;
    for (const sl of slots.filter((x) => x.weekday === day.getDay() && !have.has(`${x.id}|${iso}`))) {
      const { rows: [sess] } = await q(
        `insert into attendance_sessions (slot_id, on_date, course_id, subject, start_time, end_time, taken_by, status, submitted_at)
         values ($1, $2, $3, $4, $5, $6, $7, 'submitted', ($2::date + $6::time)) on conflict do nothing returning id`,
        [sl.id, iso, sl.course_id, sl.subject, sl.start, sl.end, sl.employee_id],
      );
      if (!sess) continue;
      const ids = []; const marks = [];
      for (const st of byCourse.get(sl.course_id) || []) {
        const r = chance(`${st.code}|${iso}|${sl.start}`);
        ids.push(st.id);
        marks.push(r < rate.get(st.id) ? (chance(`late|${st.code}|${iso}|${sl.start}`) < 0.06 ? 'late' : 'present') : 'absent');
      }
      if (ids.length) {
        await q('insert into attendance_records (session_id, student_id, status) select $1, x.s, x.m from unnest($2::uuid[], $3::text[]) as x(s, m)', [sess.id, ids, marks]);
      }
    }
  }
}

/** Startup hook: keep every demo tenant's rolling dates current. */
export async function refreshDemoTenants() {
  const tenants = await withTx({ platform: true }, async () => (
    await q("select id from tenants where settings->>'demo' = 'true'")
  ).rows);
  for (const t of tenants) await withTx({ tenantId: t.id }, refreshRollingData);
}

/* ---------- seeding ---------- */

// A one-pixel picture, so a sample applicant's checked documents open on screen like real ones
const SAMPLE_DOC = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

/** Sample applicants at every stage of admissions, so the board and the dashboard's funnel show a real picture. */
async function seedApplicants(courseId) {
  const { rows: admin } = await q("select id from users where role = 'admin' and tenant_id = app_tenant() limit 1");
  const { rows: enrolled } = await q('select id, name, email from students where tenant_id = app_tenant() and course_id = $1 order by student_code desc limit 3', [courseId]);
  const people = [
    ['Nikhil Bhosale', 'draft'], ['Tanya Rao', 'draft'], ['Farah Shaikh', 'draft'], ['Ishan Pawar', 'draft'], ['Meghna Iyer', 'draft'], ['Sahil Verma', 'draft'],
    ['Aditi Nair', 'submitted'], ['Rohit Kale', 'submitted'], ['Kritika Joshi', 'submitted'],
    ['Vedant More', 'checked'], ['Sana Kapoor', 'checked'],
    ['Pranali Shinde', 'waitlisted'], ['Harsh Gupta', 'accepted'],
  ];
  for (const [name, stage] of people) {
    const email = `${name.toLowerCase().replace(' ', '.')}@applicant.example`;
    const status = stage === 'checked' ? 'submitted' : stage;
    const decided = ['waitlisted', 'accepted'].includes(stage);
    const no = await nextNumber('application', { prefix: `APP${new Date().getFullYear()}-`, padding: 5 });
    const { rows: [a] } = await q(
      `insert into applications (application_no, course_id, name, email, phone, access_hash, source, step, status, fee_status, submitted_at, decided_at)
       values ($1, $2, $3, $4, '+91 98000 00000', $5, 'walk_in', $6, $7, 'none', $8, $9) returning id`,
      [no, courseId, name, email, crypto.randomBytes(32).toString('hex'), status === 'draft' ? 1 : 6, status,
        status === 'draft' ? null : new Date(Date.now() - 5 * 86400000), decided ? new Date(Date.now() - 2 * 86400000) : null],
    );
    if (stage !== 'checked') continue;
    for (const docType of ['photo', 'id_proof', 'marksheet']) {
      const { rows: [{ t }] } = await q("select current_setting('app.tenant_id') as t");
      const key = `${t}/${crypto.randomUUID()}`;
      await storage.put(key, SAMPLE_DOC);
      const { rows: [f] } = await q(
        `insert into files (created_by, purpose, original_name, mime, size_bytes, sha256, storage_key)
         values ($1, 'admission', $2, 'image/png', $3, $4, $5) returning id`,
        [admin[0]?.id ?? null, `${docType}.png`, SAMPLE_DOC.length, crypto.createHash('sha256').update(SAMPLE_DOC).digest('hex'), key],
      );
      await q("insert into application_documents (application_id, doc_type, file_id, status) values ($1, $2, $3, 'verified')", [a.id, docType, f.id]);
    }
  }
  for (const st of enrolled) {
    const no = await nextNumber('application', { prefix: `APP${new Date().getFullYear()}-`, padding: 5 });
    await q(
      `insert into applications (application_no, course_id, name, email, access_hash, source, step, status, fee_status, submitted_at, decided_at, student_id)
       values ($1, $2, $3, $4, $5, 'walk_in', 6, 'enrolled', 'none', now() - interval '20 days', now() - interval '10 days', $6)`,
      [no, courseId, st.name, st.email, crypto.randomBytes(32).toString('hex'), st.id],
    );
  }
}

async function seedTenant(spec, hashes) {
  const { tenantId } = await provisionTenant({
    code: spec.code, name: spec.name, type: spec.type, shortName: spec.shortName, plan: 'demo',
    settings: { demo: true }, admin: { ...spec.admin, password: DEMO_PASSWORDS.admin },
  });
  await switchTenant(tenantId);

  const i = spec.institute;
  // The demo institutes are already through the setup wizard (contact details and academic year in place)
  const now = new Date(); const y = now.getMonth() >= 5 ? now.getFullYear() : now.getFullYear() - 1;
  const setup = { academicYear: { name: `${y}-${String(y + 1).slice(2)}`, start: `${y}-06-01`, end: `${y + 1}-04-30` } };
  await q(
    `update institute_profiles set tagline = $1, email = $2, website = $3, details = $4, stakeholders = $5,
       authorized_persons = $6, documents = $7, beneficiaries = $8, stamp = $9, address = $10, city = $11, phone = $12`,
    [i.tagline, i.email, i.website, { ...i.details, _setup: setup }, JSON.stringify(i.stakeholders), JSON.stringify(i.authorizedPersons),
      JSON.stringify(i.documents), JSON.stringify(i.beneficiaries), i.stamp, i.address || '', i.city || '', i.phone || ''],
  );

  const dept = {};
  for (const [name, description] of spec.departments) {
    dept[name] = (await q('insert into departments (name, description) values ($1, $2) returning id', [name, description])).rows[0].id;
  }
  const desig = {};
  for (const [name, d] of spec.designations) {
    desig[`${d}|${name}`] = (await q('insert into designations (department_id, name) values ($1, $2) returning id', [dept[d], name])).rows[0].id;
  }

  const emp = [];
  for (const [code, name, designation, department, shift] of spec.employees) {
    const email = `${name.toLowerCase().replace(/[^a-z]+/g, '.')}@${spec.code.replace('demo-', '')}.example`;
    const { rows: [e] } = await q(
      `insert into employees (emp_code, name, email, department_id, designation_id, shift)
       values ($1, $2, $3, $4, $5, $6) returning id`,
      [code, name, email, dept[department], desig[`${department}|${designation}`], shift],
    );
    emp.push(e.id);
    await q(
      `insert into users (role, login_id, email, name, password_hash, employee_id) values ('employee', $1, $2, $3, $4, $5)`,
      [code, email, name, hashes.employee, e.id],
    );
  }
  // Office staff who are not teachers, with their staff roles: they sign in as employees and see only their part of the office
  const office = [
    ['Principal', spec.institute.stamp?.signatory || 'Principal', ['principal']],
    ['Accountant', 'Prakash Kulkarni', ['accountant']],
    ['Librarian', 'Sunita Joshi', ['librarian']],
    ['Security Officer', 'Vikram Pawar', ['gate_security']],
    ['Head of Department', 'Dr. Rajiv Menon', ['hod']],
  ];
  const staffIds = [];
  // The head of department heads the department that teaches the demo course (EMP001's department)
  const { rows: [teaching] } = await q('select department_id from employees where id = $1', [emp[0]]);
  for (const [i, [title, name, roles]] of office.entries()) {
    const code = `EMP${String(spec.employees.length + 1 + i).padStart(3, '0')}`;
    const email = `${title.toLowerCase().replace(/[^a-z]+/g, '.')}@${spec.code.replace('demo-', '')}.example`;
    const deptId = roles.includes('hod') ? teaching.department_id : dept.Administration;
    const { rows: [dg] } = await q(
      `insert into designations (department_id, name) values ($1, $2)
       on conflict do nothing returning id`, [deptId, title],
    );
    const desigId = dg?.id || (await q('select id from designations where department_id = $1 and name = $2', [deptId, title])).rows[0].id;
    const { rows: [e] } = await q(
      "insert into employees (emp_code, name, email, department_id, designation_id, shift) values ($1, $2, $3, $4, $5, 'General shift') returning id",
      [code, name, email, deptId, desigId],
    );
    await q("insert into users (role, login_id, email, name, password_hash, employee_id) values ('employee', $1, $2, $3, $4, $5)", [code, email, name, hashes.employee, e.id]);
    for (const role of roles) await q('insert into staff_roles (employee_id, role, department_id) values ($1, $2, $3)', [e.id, role, role === 'hod' ? deptId : null]);
    staffIds.push(e.id);
  }
  // A second set of teachers (EMP012 onward), so each division has its own faculty for its lectures
  const more = [];
  for (const [code, name, designation, department, shift] of spec.moreEmployees || []) {
    const email = `${name.toLowerCase().replace(/[^a-z]+/g, '.')}@${spec.code.replace('demo-', '')}.example`;
    const { rows: [e] } = await q(
      `insert into employees (emp_code, name, email, department_id, designation_id, shift)
       values ($1, $2, $3, $4, $5, $6) returning id`,
      [code, name, email, dept[department], desig[`${department}|${designation}`], shift],
    );
    more.push(e.id);
    await q("insert into users (role, login_id, email, name, password_hash, employee_id) values ('employee', $1, $2, $3, $4, $5)", [code, email, name, hashes.employee, e.id]);
  }
  await q("insert into number_series (key, prefix, padding, next_value) values ('employee', 'EMP', 3, $1)", [spec.employees.length + office.length + more.length + 1]);
  const idByCode = new Map([...spec.employees, ...(spec.moreEmployees || [])].map(([code], i) => [code, i < spec.employees.length ? emp[i] : more[i - spec.employees.length]]));
  // Who teaches subject k in each division: A the first set, B the second set, C a mix of both (never two places at once)
  const teachersFor = (di) => {
    if (!more.length) return emp;
    return di === 0 ? emp : di === 1 ? more : emp.map((id, k) => (k % 2 ? more[k] : id));
  };

  // Leave: the standard types, one request waiting and one already approved, so the screens are not empty
  for (const [name, days] of [['Casual leave', 12], ['Sick leave', 10], ['Earned leave', 15], ['Leave without pay', null]]) {
    await q('insert into leave_types (name, days_per_year) values ($1, $2)', [name, days]);
  }
  if (emp.length >= 3) {
    const { rows: [casual] } = await q("select id from leave_types where name = 'Casual leave'");
    const { rows: [sick] } = await q("select id from leave_types where name = 'Sick leave'");
    const day = (n) => toISO(addDays(new Date(), n));
    await q(
      `insert into leave_requests (employee_id, leave_type_id, from_date, to_date, days, reason, status)
       values ($1, $2, $3, $4, 2, 'Family function out of town', 'pending')`, [emp[1], casual.id, day(3), day(4)],
    );
    await q(
      `insert into leave_requests (employee_id, leave_type_id, from_date, to_date, days, reason, status, decided_at)
       values ($1, $2, $3, $4, 1, 'Medical check-up', 'approved', now())`, [emp[2], sick.id, day(7), day(7)],
    );
  }

  // Feedback: one open form for students, so the screens are not empty
  const { rows: [form] } = await q(
    `insert into feedback_forms (title, description, audience, status) values ('Teaching and campus feedback', 'Tell us how this term is going. Your answers are anonymous.', 'students', 'open') returning id`,
  );
  for (const [i, [text, kind]] of [['The classes are well organised and easy to follow', 'rating'], ['Teachers explain clearly and answer questions', 'rating'],
    ['The library, labs and classrooms meet my needs', 'rating'], ['What one thing should we improve?', 'text']].entries()) {
    await q('insert into feedback_questions (form_id, position, text, kind, required) values ($1, $2, $3, $4, $5)', [form.id, i + 1, text, kind, kind === 'rating']);
  }

  // Three divisions, each its own class with its own students, timetable, fee plan and exams
  const courses = [];
  for (const [di, division] of DIVISIONS.entries()) {
    const c = divisionCourse(spec, division);
    const classTeacher = idByCode.get((spec.classTeachers || [])[di]) || null;
    const { rows: [row] } = await q(
      'insert into courses (code, name, full_name, department_id, years, class_teacher_id) values ($1, $2, $3, $4, $5, $6) returning id',
      [c.code, c.name, c.fullName, dept[c.department], c.years, classTeacher],
    );
    courses.push({ division, id: row.id, teachers: teachersFor(di) });
  }
  const course = courses[0];
  const courseOf = new Map(courses.map((c) => [c.division, c.id]));

  for (const s of rosterFor(spec)) {
    const attendance = s.att.map(([attended, total], k) => ({ subject: spec.subjects[k], attended, total }));
    const { rows: [st] } = await q(
      `insert into students (student_code, roll_no, enrollment_no, name, email, phone, dob, gender, blood_group, nationality,
         course_id, semester, section, batch, admission_date, status, address, guardian, attendance)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'Indian', $10, $11, $12, $13, $14, 'Active', $15, $16, $17) returning id`,
      [s.code, s.roll, s.enroll, s.name, s.email, s.phone, s.dob, s.gender, s.blood, courseOf.get(s.section), s.semester, s.section,
        s.batch, s.admitted, s.address, s.guardian, JSON.stringify(attendance)],
    );
    await q(
      `insert into users (role, login_id, email, name, password_hash, student_id) values ('student', $1, $2, $3, $4, $5)`,
      [s.code, s.email, s.name, hashes.student, st.id],
    );
  }

  // Parent accounts, each linked only to the children of that family (see `parents` in demo-data.js)
  for (const [i, family] of (spec.parents || []).entries()) {
    const { rows: kids } = await q('select id, guardian from students where tenant_id = app_tenant() and student_code = any($1) order by student_code', [family.children]);
    if (!kids.length) continue;
    const { rows: [pu] } = await q(
      `insert into users (role, login_id, email, name, password_hash) values ('parent', $1, $2, $3, $4) returning id`,
      [family.login, `parent${i ? i + 1 : ''}@${spec.code.replace('demo-', '')}.example`, kids[0].guardian?.name || 'Parent', hashes.parent],
    );
    for (const k of kids) await q("insert into parent_links (user_id, student_id, relation) values ($1, $2, 'Parent')", [pu.id, k.id]);
  }

  // One open grievance with an answer from the office
  const { rows: [firstStudent] } = await q("select id, student_id from users where role = 'student' and tenant_id = app_tenant() order by login_id limit 1");
  const ticket = await nextNumber('grievance', { prefix: `GRV${new Date().getFullYear()}-`, padding: 5 });
  const { rows: [grv] } = await q(
    `insert into grievances (ticket_no, raised_by, raiser_role, student_id, category, subject, details, status)
     values ($1, $2, 'student', $3, 'Facilities', 'Projector in Room 204 is not working', 'The projector has been showing a blue screen for a week, so lectures there are hard to follow.', 'in_progress') returning id`,
    [ticket, firstStudent.id, firstStudent.student_id],
  );
  await q("insert into grievance_messages (grievance_id, from_office, body) values ($1, true, 'Thank you for reporting this. The maintenance team has been asked to repair it this week.')", [grv.id]);

  // Hostel, transport and payroll: a little of each, so the screens are not empty
  const { rows: [bh] } = await q("insert into hostels (name, kind, warden_id, phone) values ('Boys Hostel A', 'boys', $1, '+91 20 5550 0101') returning id", [emp[0] || null]);
  const { rows: [gh] } = await q("insert into hostels (name, kind, warden_id, phone) values ('Girls Hostel B', 'girls', $1, '+91 20 5550 0102') returning id", [emp[1] || null]);
  for (const [hid, nums, fee] of [[bh.id, ['101', '102', '103', '201', '202'], 4500], [gh.id, ['101', '102', '103', '201'], 4800]]) {
    for (const no of nums) await q('insert into hostel_rooms (hostel_id, room_no, floor, beds, monthly_fee) values ($1, $2, $3, $4, $5)', [hid, no, Number(no[0]) - 1, 3, fee]);
  }
  const { rows: people } = await q('select id, gender from students where tenant_id = app_tenant() order by student_code limit 3');
  for (const st of people) {
    const girl = String(st.gender).toLowerCase().startsWith('f');
    const { rows: [room] } = await q('select id from hostel_rooms where hostel_id = $1 and room_no = $2', [girl ? gh.id : bh.id, '101']);
    await q('insert into hostel_stays (room_id, student_id, from_date) values ($1, $2, $3)', [room.id, st.id, toISO(addDays(new Date(), -60))]);
  }
  const routes = [
    ['Route 1 - City Centre', 'MH 12 AB 1201', 'Ramesh Patil', '+91 98900 11001', 40, 1500, [['Station Road', '07:10'], ['Market Chowk', '07:25'], ['Campus Gate', '07:50']]],
    ['Route 2 - North Suburbs', 'MH 12 CD 3402', 'Suresh Jadhav', '+91 98900 11002', 32, 1800, [['Green Park', '07:00'], ['Lake View', '07:20'], ['Campus Gate', '07:50']]],
  ];
  const stops = [];
  for (const [name, vehicle, driver, phone, seats, fee, list] of routes) {
    const { rows: [r] } = await q('insert into transport_routes (name, vehicle_no, driver_name, driver_phone, seats, monthly_fee) values ($1, $2, $3, $4, $5, $6) returning id', [name, vehicle, driver, phone, seats, fee]);
    for (const [i, [stop, time]] of list.entries()) {
      const { rows: [sp] } = await q('insert into transport_stops (route_id, name, position, pickup_time) values ($1, $2, $3, $4) returning id', [r.id, stop, i + 1, time]);
      stops.push({ route: r.id, stop: sp.id });
    }
  }
  for (const [i, st] of people.slice(0, 2).entries()) {
    await q('insert into transport_rides (route_id, stop_id, student_id, from_date) values ($1, $2, $3, $4)', [stops[i * 3 + 1].route, stops[i * 3 + 1].stop, st.id, toISO(addDays(new Date(), -45))]);
  }
  // Salaries for everyone, and last month's payroll already finalised
  await q("update employees set join_date = '2023-07-01' where tenant_id = app_tenant()");
  const lastMonth = toISO(new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1)).slice(0, 7);
  const { rows: run } = await q("insert into payroll_runs (month, status, finalised_at) values ($1, 'finalised', now()) returning id", [lastMonth]);
  for (const [i, id] of emp.entries()) {
    const basic = 30000 + i * 4000; const hra = Math.round(basic * 0.4); const allow = 3000;
    await q('insert into employee_salaries (employee_id, basic, hra, allowances, pf_percent, other_deductions) values ($1, $2, $3, $4, 12, 200)', [id, basic, hra, allow]);
    const gross = basic + hra + allow; const pf = Math.round(basic * 0.12 * 100) / 100; const total = pf + 200;
    await q(
      `insert into payslips (run_id, employee_id, basic, hra, allowances, gross, pf, other_deductions, unpaid_days, unpaid_amount, total_deductions, net)
       values ($1, $2, $3, $4, $5, $6, $7, 200, 0, 0, $8, $9)`, [run[0].id, id, basic, hra, allow, gross, pf, total, gross - total],
    );
  }

  // Weekly repeating timetable for every division. weekday: 1 = Mon ... 5 = Fri. Division A has subject k taught by the first
  // set's teacher k; B and C are shifted by one and two subjects, so at any hour the three divisions are in three different
  // lectures and no teacher is ever in two places.
  const periods = [['09:00', '10:00'], ['10:00', '11:00'], ['11:15', '12:15'], ['12:15', '13:15']];
  const grid = { 1: [0, 1, 5, 4], 2: [2, 0, 3, 1], 3: [5, 2, 4, 3], 4: [1, 3, 0, 2], 5: [4, 5, 0, 1] };
  const labs = new Set(['3-3', '4-2', '4-3']);
  const n = spec.subjects.length;
  for (const [di, dv] of courses.entries()) {
    for (const [weekday, subjectIdx] of Object.entries(grid)) {
      for (const [p, k0] of subjectIdx.entries()) {
        const k = (k0 + di) % n;
        const isLab = labs.has(`${weekday}-${p + 1}`);
        const online = k === 4;
        await q(
          `insert into timetable_slots (course_id, weekday, start_time, end_time, subject, employee_id, mode, location)
           values ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [dv.id, Number(weekday), periods[p][0], periods[p][1], isLab ? `${spec.subjects[k]} (Lab)` : spec.subjects[k],
            dv.teachers[k], online ? 'Online' : 'Offline', online ? 'Google Meet' : isLab ? spec.place.lab : spec.place.room],
        );
      }
    }
  }

  for (const dv of courses) {
    await seedExams(spec, dv.id, dv.teachers);
    await seedAssignments(spec, dv.id, dv.teachers);
    await seedFees(spec, dv.id);
  }
  await seedLearningAndQuizzes(spec, course.id, emp);
  await seedVisitors(emp);
  if (['college', 'university'].includes(spec.type)) await seedPlacement(courses.map((c) => c.id));
  if (spec.type === 'college') await seedApplicants(courses[0].id);
  await seedLibrary(spec, emp);
  await refreshRollingData();
}

/** Two assignments for the first subject: one with a graded answer, one still open. */
async function seedAssignments(spec, courseId, emp) {
  const subject = spec.subjects[0];
  const { rows: studs } = await q('select id from students where course_id = $1 order by student_code limit 3', [courseId]);
  const now = new Date();
  const { rows: [a1] } = await q(
    `insert into assignments (course_id, subject, title, description, due_at, max_marks, status, created_by_employee, published_at)
     values ($1, $2, 'Unit 1 problem set', 'Solve all the problems at the end of Unit 1 and write your working clearly.', $3, 20, 'published', $4, $5) returning id`,
    [courseId, subject, addDays(now, -3).toISOString(), emp[0] || null, addDays(now, -10).toISOString()],
  );
  await q(
    `insert into assignments (course_id, subject, title, description, due_at, max_marks, status, created_by_employee, published_at)
     values ($1, $2, 'Short note on the case study', 'Write a one-page note on the case study discussed in class.', $3, 10, 'published', $4, now())`,
    [courseId, subject, addDays(now, 6).toISOString(), emp[0] || null],
  );
  for (const [i, st] of studs.slice(0, 2).entries()) {
    await q(
      `insert into assignment_submissions (assignment_id, student_id, answer, status, marks, feedback, submitted_at, graded_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [a1.id, st.id, 'Worked solutions are attached in my notebook; question 5 uses the second method.', i === 0 ? 'graded' : 'submitted',
        i === 0 ? 17 : null, i === 0 ? 'Good working. Check the units in question 4.' : '', addDays(now, -4).toISOString(), i === 0 ? addDays(now, -2).toISOString() : null],
    );
  }
}

/**
 * Charges for every active student of the structure's class, in one statement. Gives the same result as the fee
 * service's bulkAssign, without a separate round trip per student (the sample classes have 40 students each).
 */
async function assignFast(structureId) {
  await q(
    `insert into student_fee_items (student_id, label, amount, due_date, source, structure_id)
     select st.id, i.label, i.amount, i.due_date, 'structure', i.structure_id
     from fee_structure_items i join fee_structures fs on fs.id = i.structure_id
     join students st on st.course_id = fs.course_id and st.status = 'Active'
     where i.structure_id = $1`, [structureId],
  );
}

/**
 * Sample payments in bulk. Each row pays one fee item in full or in part: { itemId, studentId, amount, method, paidAt }.
 * Receipt numbers come from the same series the fee desk uses, in the order given.
 */
async function payFast(rows) {
  if (!rows.length) return;
  const { rows: [r] } = await q(
    `insert into number_series (key, prefix, padding, next_value) values ('receipt', $2, 5, $1::int + 1)
     on conflict (tenant_id, key) do update set next_value = number_series.next_value + $1::int
     returning prefix, padding, next_value - $1::int as first`, [rows.length, `RCPT${new Date().getFullYear()}-`],
  );
  const receipts = rows.map((_, i) => `${r.prefix}${String(r.first + i).padStart(r.padding, '0')}`);
  const { rows: made } = await q(
    `insert into payments (student_id, receipt_no, amount, method, note, paid_at)
     select * from unnest($1::uuid[], $2::text[], $3::numeric[], $4::text[], $5::text[], $6::timestamptz[]) returning id, receipt_no`,
    [rows.map((x) => x.studentId), receipts, rows.map((x) => x.amount), rows.map((x) => x.method), rows.map(() => 'Demo payment'), rows.map((x) => x.paidAt.toISOString())],
  );
  const idOf = new Map(made.map((m) => [m.receipt_no, m.id]));
  await q(
    'insert into payment_allocations (payment_id, fee_item_id, amount) select * from unnest($1::uuid[], $2::uuid[], $3::numeric[])',
    [receipts.map((x) => idOf.get(x)), rows.map((x) => x.itemId), rows.map((x) => x.amount)],
  );
  await q(
    `update student_fee_items i set status = case when (select sum(a.amount) from payment_allocations a where a.fee_item_id = i.id) >= i.amount - 0.01 then 'paid' else 'partial' end
     where i.id = any ($1::uuid[])`, [[...new Set(rows.map((x) => x.itemId))]],
  );
}

/** A fee plan for the class with a realistic spread for the fee desk: about a quarter have paid term 1, a quarter part of it, the rest still owe it. */
async function seedFees(spec, courseId) {
  const school = spec.type === 'school';
  const now = new Date();
  await seedFeeHistory(spec, courseId, now);
  const year = `${now.getFullYear()}-${String((now.getFullYear() + 1) % 100).padStart(2, '0')}`;
  const term = school ? 18000 : 45000;
  const s = await feesSvc.createStructure({
    name: school ? 'Annual school fee' : 'Programme fee', courseId, academicYear: year,
    items: [
      { label: 'Term 1 tuition', amount: term, dueDate: toISO(addDays(now, -35)) },
      { label: 'Examination fee', amount: school ? 1500 : 2500, dueDate: toISO(addDays(now, 4)) },
      { label: 'Term 2 tuition', amount: term, dueDate: toISO(addDays(now, 40)) },
    ],
  });
  await assignFast(s.id);
  const { rows: items } = await q(
    `select i.id, i.student_id, i.label, i.amount::float8 as amount from student_fee_items i join students st on st.id = i.student_id
     where i.structure_id = $1 order by st.student_code, i.due_date`, [s.id],
  );
  const byStudent = new Map();
  for (const it of items) { if (!byStudent.has(it.student_id)) byStudent.set(it.student_id, []); byStudent.get(it.student_id).push(it); }
  const methods = ['upi', 'cash', 'bank_transfer', 'card'];
  const pays = [];
  for (const [k, [studentId, list]] of [...byStudent.entries()].entries()) {
    const kind = k % 4;
    if (kind > 1) continue;
    const paidAt = new Date(now.getTime() - (3 + (k % 9)) * 86400000);
    const method = methods[k % methods.length];
    const term1 = list.find((x) => x.label === 'Term 1 tuition');
    // The first student has paid term 1 only and the second half of it; from the fifth on, every fourth student has paid the whole year
    if (kind === 0 && k >= 4) for (const it of list) pays.push({ itemId: it.id, studentId, amount: it.amount, method, paidAt });
    else pays.push({ itemId: term1.id, studentId, amount: kind === 0 ? term : term / 2, method, paidAt });
  }
  await payFast(pays);
}

/**
 * Last term's monthly instalments, all paid on time over the past five months, so the fee collection chart has a
 * history. Fully paid, so they do not change what anyone owes now.
 */
async function seedFeeHistory(spec, courseId, now) {
  const school = spec.type === 'school';
  const amount = school ? 3000 : 7500;
  const items = [];
  for (let m = 5; m >= 1; m -= 1) {
    const due = new Date(now.getFullYear(), now.getMonth() - m, 10);
    items.push({ label: `Previous term instalment ${6 - m}`, amount, dueDate: toISO(due) });
  }
  const prevYear = `${now.getFullYear() - 1}-${String(now.getFullYear() % 100).padStart(2, '0')}`;
  const s = await feesSvc.createStructure({ name: 'Previous term (monthly)', courseId, academicYear: prevYear, items });
  await assignFast(s.id);
  const { rows: charges } = await q(
    `select i.id, i.label, i.student_id, st.student_code from student_fee_items i join students st on st.id = i.student_id
     where i.structure_id = $1 order by st.student_code`, [s.id],
  );
  const byStudent = new Map();
  for (const c of charges) { if (!byStudent.has(c.student_id)) byStudent.set(c.student_id, []); byStudent.get(c.student_id).push(c); }
  const methods = ['upi', 'cash', 'bank_transfer', 'card', 'upi'];
  // Most pay each month; a couple of times a student pays two instalments together the month after
  const late = { '4|2': 3, '2|1': 1 };
  const plan = [];
  for (let m = 5; m >= 1; m -= 1) {
    for (const [k, [sid, list]] of [...byStudent.entries()].entries()) {
      plan.push({ k, sid, m, item: list.find((x) => x.label === `Previous term instalment ${6 - m}`), paidIn: late[`${m}|${k}`] ?? m });
    }
  }
  plan.sort((a, b) => b.paidIn - a.paidIn || b.m - a.m);
  await payFast(plan.map(({ k, sid, m, item, paidIn }) => ({
    itemId: item.id, studentId: sid, amount, method: methods[(m + k) % methods.length],
    // Paid a few days either side of the 10th, the later students a little later
    paidAt: new Date(now.getFullYear(), now.getMonth() - paidIn, 6 + (k % 12) * 3 % 24 + (m % 3), 11, 30),
  })));
}

/** A small shelf and three loans (one overdue, one due back soon), so the library desk is not empty. */
async function seedLibrary(spec, emp) {
  const school = spec.type === 'school';
  const books = school
    ? [['9789352601332', 'Concise Physics for Class 9', 'S. Chand Editors', 'Science', 'S-01', 6], ['9789387153271', 'Mathematics Textbook for Class IX', 'NCERT', 'Mathematics', 'M-02', 8],
      ['9780143333623', 'Wings of Fire', 'A. P. J. Abdul Kalam', 'Biography', 'B-04', 3], ['9780141439518', 'Pride and Prejudice', 'Jane Austen', 'Fiction', 'F-11', 2]]
    : [['9780262046305', 'Introduction to Algorithms', 'Cormen, Leiserson, Rivest, Stein', 'Computer Science', 'CS-01', 5], ['9780132350884', 'Clean Code', 'Robert C. Martin', 'Computer Science', 'CS-04', 3],
      ['9781491950357', 'Designing Data-Intensive Applications', 'Martin Kleppmann', 'Computer Science', 'CS-07', 2], ['9780143333623', 'Wings of Fire', 'A. P. J. Abdul Kalam', 'Biography', 'B-04', 3]];
  const ids = [];
  for (const [isbn, title, author, category, shelf, copies] of books) {
    const { rows: [b] } = await q(
      'insert into books (isbn, title, author, category, shelf_location, total_copies, available_copies) values ($1, $2, $3, $4, $5, $6, $6) returning id',
      [isbn, title, author, category, shelf, copies],
    );
    ids.push(b.id);
  }
  const { rows: studs } = await q("select id from students where tenant_id = app_tenant() and status = 'Active' order by student_code limit 3");
  const now = new Date();
  const loans = [[ids[0], studs[0]?.id, null, -12, 2], [ids[1], studs[2]?.id, null, -17, -3], [ids[2], null, emp[0], -5, 9]];
  for (const [bookId, studentId, employeeId, issuedDaysAgo, dueIn] of loans) {
    if (!studentId && !employeeId) continue;
    await q(
      `insert into book_issues (book_id, borrower_type, student_id, employee_id, issued_at, due_date)
       values ($1, $2, $3, $4, now() + ($5::int || ' days')::interval, $6)`,
      [bookId, studentId ? 'student' : 'employee', studentId, employeeId, issuedDaysAgo, toISO(addDays(now, dueIn))],
    );
    await q('update books set available_copies = available_copies - 1 where id = $1', [bookId]);
  }
}

/** A small gate log: one visitor inside, one expected today, one who has left. */
async function seedVisitors(emp) {
  const today = toISO(new Date());
  const rows = [
    ['VIS00001', 'Rohit Deshmukh', '+91 98220 11223', 'Deshmukh Traders', 'Delivery', emp[0], 'checked_out', -190, -170],
    ['VIS00002', 'Neha Kulkarni', '+91 98220 33445', '', 'Parent visit', emp[1], 'checked_in', -35, null],
    ['VIS00003', 'Anil Mehta', '+91 98220 55667', 'Bluepeak Analytics', 'Meeting', emp[0], 'expected', null, null],
  ];
  for (const [pass, name, phone, org, purpose, host, status, inMin, outMin] of rows) {
    await q(
      `insert into visitor_visits (pass_no, visitor_name, phone, organisation, purpose, host_id, expected_on, status, check_in_at, check_out_at, id_shown)
       values ($1, $2, $3, $4, $5, $6, $7, $8, case when $9::int is null then null else now() + ($9::int || ' minutes')::interval end,
               case when $10::int is null then null else now() + ($10::int || ' minutes')::interval end, case when $8 = 'expected' then '' else 'Aadhaar' end)`,
      [pass, name, phone, org, purpose, host || null, today, status, inMin, outMin],
    );
  }
  await q("insert into number_series (key, prefix, padding, next_value) values ('visitor', 'VIS', 5, 4) on conflict (tenant_id, key) do update set next_value = 4");
}

/** Companies, drives and a few applications so the Placement screens have something to show. */
async function seedPlacement(courseIds) {
  const mk = async (name, industry, website) => (await q(
    'insert into placement_companies (name, industry, website, contact_name, contact_email) values ($1, $2, $3, $4, $5) returning id',
    [name, industry, website, 'Talent Acquisition', `careers@${website.replace(/^https?:\/\//, '')}`],
  )).rows[0].id;
  const c1 = await mk('Northwind Software', 'Information Technology', 'https://northwind.example');
  const c2 = await mk('Bluepeak Analytics', 'Data and Analytics', 'https://bluepeak.example');
  const c3 = await mk('Harbor Finance', 'Banking and Finance', 'https://harborfinance.example');
  const now = new Date();
  const drive = async (company, title, ctc, loc, driveIn, applyIn, status, extra = {}) => (await q(
    `insert into placement_drives (company_id, title, description, ctc_lpa, location, drive_date, apply_by, status, course_ids, min_semester, min_attendance)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning id`,
    [company, title, 'Campus drive. Bring a printed resume and your college ID. Details of the rounds will be shared with shortlisted students.', ctc, loc,
      toISO(addDays(now, driveIn)), toISO(addDays(now, applyIn)), status, extra.courses || [], extra.sem || null, extra.att ?? null],
  )).rows[0].id;
  const d1 = await drive(c1, 'Graduate Engineer Trainee', 6.5, 'Pune', 12, 8, 'open', { courses: courseIds, att: 60 });
  await drive(c2, 'Data Analyst', 8, 'Bengaluru', 20, 15, 'open', { courses: courseIds, sem: 6 });
  const d3 = await drive(c3, 'Associate Analyst', 5.2, 'Mumbai', -20, -25, 'closed');
  await drive(c1, 'Software Developer (Next Batch)', 9, 'Pune', 40, 34, 'draft');
  const { rows: studs } = await q('select id from students where tenant_id = app_tenant() order by student_code limit 3');
  const apps = [[d1, 0, 'shortlisted', null], [d1, 1, 'applied', null], [d3, 0, 'selected', 5.2], [d3, 2, 'rejected', null]];
  for (const [d, k, status, offer] of apps) {
    if (!studs[k]) continue;
    await q('insert into placement_applications (drive_id, student_id, status, offer_lpa, decided_at) values ($1, $2, $3, $4, $5)',
      [d, studs[k].id, status, offer, status === 'applied' ? null : new Date().toISOString()]);
  }
}

/**
 * Sample exams so the Exams & Results module has something to show on day one:
 *  - last semester's End-Semester exam: PUBLISHED, fully marked (students see grades, GPA and a report card;
 *    one student fails a paper so the fail path is visible)
 *  - this semester's Mid-Semester exam: DRAFT with no marks yet, so faculty have papers waiting for them.
 * Subject k is taught by employee k, exactly as in the timetable.
 */
async function seedExams(spec, courseId, emp) {
  const day = (offset) => { const d = new Date(); d.setDate(d.getDate() + offset); return d.toISOString().slice(0, 10); };
  const sem = spec.students[0].semester;
  const credits = [4, 4, 3, 3, 2, 2];
  const { rows: students } = await q('select id, student_code from students where course_id = $1 order by student_code', [courseId]);
  const mkExam = async (name, kind, semester, start, end, published) => (await q(
    `insert into exams (course_id, semester, name, kind, start_date, end_date, status, published_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
    [courseId, semester, name, kind, start, end, published ? 'published' : 'draft', published ? new Date(Date.now() - 60 * 86400000) : null],
  )).rows[0].id;
  const mkPapers = async (examId, max, pass, status) => {
    const ids = [];
    for (const [k, subject] of spec.subjects.entries()) {
      ids.push((await q(
        `insert into exam_papers (exam_id, subject, max_marks, pass_marks, credits, employee_id, marks_status, submitted_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
        [examId, subject, max, pass, credits[k % credits.length], emp[k], status, status === 'submitted' ? new Date() : null],
      )).rows[0].id);
    }
    return ids;
  };

  const past = await mkExam('End-Semester Examination', 'term', Math.max(1, sem - 1), day(-170), day(-158), true);
  const pastPapers = await mkPapers(past, 100, 40, 'submitted');
  const base = [84, 77, 62, 71, 66, 58];
  const wobble = [4, -3, 6, -5, 2, -8];
  const papersCol = []; const studentsCol = []; const marksCol = [];
  for (const [i, st] of students.entries()) {
    for (const [k, paperId] of pastPapers.entries()) {
      let marks = Math.max(0, Math.min(100, base[i % base.length] + wobble[(k + i) % wobble.length]));
      if (i === 2 && k === spec.subjects.length - 1) marks = 36; // one failed paper
      papersCol.push(paperId); studentsCol.push(st.id); marksCol.push(marks);
    }
  }
  if (papersCol.length) {
    await q('insert into exam_marks (paper_id, student_id, marks, absent) select x.p, x.s, x.m, false from unnest($1::uuid[], $2::uuid[], $3::numeric[]) as x(p, s, m)', [papersCol, studentsCol, marksCol]);
  }

  const upcoming = await mkExam('Mid-Semester Examination', 'mid_term', sem, day(10), day(15), false);
  await mkPapers(upcoming, 50, 20, 'draft');
}

/**
 * Sample Learning and Quiz data, so both modules are usable straight away:
 *  - three courses assigned to the class: an NPTEL MOOC (certificate, compulsory), an in-house lessons course (compulsory) and an optional one
 *  - students in different states: one finished a course and submitted a certificate, one is part-way, one had a certificate sent back
 *  - an open "Aptitude Warm-up" quiz to attempt, and a closed "Unit Test 1" with graded attempts so internal marks have something in them
 * The quiz content is general aptitude (it suits any subject); teachers write their own for real use.
 */
async function seedLearningAndQuizzes(spec, courseId, emp) {
  const sem = spec.students[0].semester;
  const day = (n) => new Date(Date.now() + n * 86400000);
  const iso = (n) => day(n).toISOString().slice(0, 10);
  const { rows: students } = await q('select id from students order by student_code');
  const mkCourse = async (title, provider, completion, subject, credits, hours, url, description, ownerIdx) => (await q(
    `insert into learning_courses (title, description, provider, url, subject, credits, duration_hours, level, completion, status, created_by_employee)
     values ($1,$2,$3,$4,$5,$6,$7,'beginner',$8,'published',$9) returning id`,
    [title, description, provider, url, subject, credits, hours, completion, emp[ownerIdx]],
  )).rows[0].id;
  const mkAssign = async (lcId, subject, credits, mandatory, due, ownerIdx, note) => {
    const id = (await q(
      `insert into learning_assignments (learning_course_id, target_course_id, target_semester, subject, credits, mandatory, due_date, note, created_by_employee)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`, [lcId, courseId, sem, subject, credits, mandatory, due, note, emp[ownerIdx]],
    )).rows[0].id;
    await q("insert into learning_enrollments (assignment_id, student_id) select $1, id from students where course_id = $2 and semester = $3 and status = 'Active'", [id, courseId, sem]);
    return id;
  };
  const s0 = spec.subjects[0]; const s1 = spec.subjects[1]; const s2 = spec.subjects[2];

  const mooc = await mkCourse('Programming Foundations (NPTEL)', 'NPTEL', 'evidence', s0, 2, 12, 'https://nptel.ac.in/courses', 'A 12-week introductory course on NPTEL. Register on the NPTEL site, complete the assignments and pass the proctored exam, then upload your e-certificate here.', 0);
  const study = await mkCourse('Effective Study Skills', 'Internal', 'lessons', s1, 1, 2, '', 'A short in-house course on planning, note-taking and revision. Finish all the lessons to earn the credit.', 1);
  const extra = await mkCourse('Introduction to Data Analysis (SWAYAM)', 'SWAYAM', 'evidence', s2, 1, 8, 'https://swayam.gov.in', 'Optional enrichment course on SWAYAM. Completing it earns bonus credits.', 2);
  const lessons = [
    ['Why planning beats cramming', 'reading', '', 'Spread your revision over weeks, not nights. Plan the syllabus backwards from the exam date, and reserve the last week for practice papers.', 10],
    ['Taking notes that you can use', 'reading', '', 'Write in your own words, leave margins for questions, and rewrite a one-page summary after every chapter.', 15],
    ['How memory works (video)', 'video', 'https://www.youtube.com/', '', 12],
    ['Build your revision timetable', 'link', 'https://calendar.google.com/', '', 20],
  ];
  for (const [i, [title, kind, link, body, min]] of lessons.entries()) {
    await q('insert into learning_lessons (course_id, position, title, kind, url, body, duration_min) values ($1,$2,$3,$4,$5,$6,$7)', [study, i + 1, title, kind, link, body, min]);
  }
  const aMooc = await mkAssign(mooc, s0, 2, true, iso(30), 0, 'Compulsory credit course for this semester.');
  const aStudy = await mkAssign(study, s1, 1, true, iso(14), 1, 'Complete before mid-semester.');
  await mkAssign(extra, s2, 1, false, iso(60), 2, 'Optional: earns bonus credits.');

  const lessonIds = (await q('select id from learning_lessons where course_id = $1 order by position', [study])).rows.map((r) => r.id);
  const enr = async (a, i) => (await q('select id from learning_enrollments where assignment_id = $1 and student_id = $2', [a, students[i]?.id])).rows[0]?.id;
  if (students[0]) {
    const e = await enr(aStudy, 0);
    for (const l of lessonIds) await q('insert into learning_progress (enrollment_id, lesson_id) values ($1,$2)', [e, l]);
    await q("update learning_enrollments set status='completed', started_at=now() - interval '5 days', completed_at=now() - interval '1 day', credits_awarded=1 where id=$1", [e]);
    await q("update learning_enrollments set status='submitted', started_at=now() - interval '20 days', submitted_at=now() - interval '2 days', evidence_url='https://archive.nptel.ac.in/noc/verify/PF-DEMO-001', certificate_id='NPTEL-PF-DEMO-001', score=78, evidence_note='Passed the proctored exam in the July term.' where id=$1", [await enr(aMooc, 0)]);
  }
  if (students[1]) {
    const e = await enr(aStudy, 1);
    for (const l of lessonIds.slice(0, 2)) await q('insert into learning_progress (enrollment_id, lesson_id) values ($1,$2)', [e, l]);
    await q("update learning_enrollments set status='in_progress', started_at=now() - interval '2 days' where id=$1", [e]);
    await q("update learning_enrollments set status='in_progress', started_at=now() - interval '6 days' where id=$1", [await enr(aMooc, 1)]);
  }
  if (students[2]) {
    await q("update learning_enrollments set status='rejected', started_at=now() - interval '12 days', submitted_at=now() - interval '4 days', reviewed_at=now() - interval '3 days', evidence_url='https://example.org/certificate', review_note='The link does not open. Please upload the certificate PDF or share a working verification link.' where id=$1", [await enr(aMooc, 2)]);
  }

  // ---- quizzes ----
  const BANK = [
    { kind: 'single', text: 'A train travels 180 km in 3 hours. What is its average speed?', marks: 2, options: [['40 km/h', false], ['60 km/h', true], ['90 km/h', false], ['540 km/h', false]], answers: [], explanation: 'Speed = distance / time = 180 / 3 = 60 km/h.' },
    { kind: 'multiple', text: 'Which of these are prime numbers?', marks: 3, options: [['2', true], ['9', false], ['11', true], ['15', false]], answers: [], explanation: '2 and 11 have no divisors other than 1 and themselves.' },
    { kind: 'truefalse', text: 'The sum of the angles of a triangle is 180 degrees.', marks: 1, options: [['True', true], ['False', false]], answers: [], explanation: 'True in plane geometry.' },
    { kind: 'short', text: 'What is 15% of 200?', marks: 2, options: [], answers: ['30'], explanation: '0.15 x 200 = 30.' },
    { kind: 'single', text: 'Which number comes next? 2, 4, 8, 16, ...', marks: 2, options: [['18', false], ['24', false], ['32', true], ['64', false]], answers: [], explanation: 'Each term doubles.' },
  ];
  const mkQuiz = async (title, status, openOff, closeOff, bank, weightage, attempts, instr) => {
    const id = (await q(
      `insert into quizzes (title, subject, course_id, semester, instructions, duration_minutes, open_at, close_at, max_attempts, weightage, negative_marks, show_results, status, published_at, created_by_employee)
       values ($1,$2,$3,$4,$5,20,$6,$7,$8,$9,0,'after_submit',$10,now(),$11) returning id`,
      [title, s0, courseId, sem, instr, day(openOff), day(closeOff), attempts, weightage, status, emp[0]],
    )).rows[0].id;
    for (const [i, x] of bank.entries()) {
      await q('insert into quiz_questions (quiz_id, position, kind, text, marks, options, answers, explanation) values ($1,$2,$3,$4,$5,$6,$7,$8)',
        [id, i + 1, x.kind, x.text, x.marks, JSON.stringify(x.options.map(([text, correct]) => ({ text, correct }))), JSON.stringify(x.answers), x.explanation]);
    }
    return id;
  };
  await mkQuiz('Aptitude Warm-up', 'published', -1, 10, BANK.slice(0, 4), 5, 2, 'Answer every question. You have 20 minutes and two attempts; your best attempt counts.');
  const closed = await mkQuiz('Unit Test 1', 'closed', -14, -7, BANK, 10, 1, 'Closed quiz kept for the internal marks sheet.');
  const qs = (await q('select id, kind, marks::float8 as marks, options, answers from quiz_questions where quiz_id = $1 order by position', [closed])).rows;
  const answerSets = [
    { 0: 1, 1: [0, 2], 2: 0, 3: '30', 4: 2 }, // student 1: everything right
    { 0: 1, 1: [0, 1], 2: 0, 3: '25', 4: 3 }, // student 2: a mix
  ];
  for (const [i, set] of answerSets.entries()) {
    if (!students[i]) continue;
    const answers = Object.fromEntries(qs.map((x, k) => [x.id, set[k]]));
    const r = gradeAttempt(qs, answers, 0);
    await q(
      `insert into quiz_attempts (quiz_id, student_id, attempt_no, status, started_at, deadline_at, submitted_at, answers, score, max_score)
       values ($1,$2,1,'submitted', now() - interval '10 days', now() - interval '10 days' + interval '20 minutes', now() - interval '10 days' + interval '12 minutes', $3, $4, $5)`,
      [closed, students[i].id, JSON.stringify(answers), r.score, r.max],
    );
  }
}

export async function seedDemoTenants({ log = console.log } = {}) {
  const hashes = {
    employee: bcrypt.hashSync(DEMO_PASSWORDS.employee, 10),
    student: bcrypt.hashSync(DEMO_PASSWORDS.student, 10),
    parent: bcrypt.hashSync(DEMO_PASSWORDS.parent, 10),
    super_admin: bcrypt.hashSync(DEMO_PASSWORDS.super_admin, 10),
  };
  await withTx({ platform: true }, async () => {
    await q("delete from tenants where settings->>'demo' = 'true'");
    await q("delete from users where role = 'super_admin' and lower(login_id) = 'sa001'");
    await q(
      `insert into users (role, login_id, email, name, password_hash)
       values ('super_admin', 'SA001', 'superadmin@planetu.example', 'Platform Admin', $1)`,
      [hashes.super_admin],
    );
    for (const spec of DEMO_TENANTS) {
      await seedTenant(spec, hashes);
      log(`[seed] ${spec.type.padEnd(7)} ${spec.code}  (${spec.name})`);
    }
  });
}

/**
 * Loads the sample institutes WITHOUT touching anything else. This is what a public demo uses (DEMO_MODE):
 *  - it never creates the SA001 platform-owner account (seedDemoTenants does, with a published password)
 *  - an institute is only created if it is missing; with `reset` the sample ones are rebuilt from scratch
 *  - a real institute that happens to use a sample code is left completely alone
 */
export async function ensureDemoInstitutes({ log = console.log, reset = false, specs = DEMO_TENANTS } = {}) {
  const hashes = { employee: bcrypt.hashSync(DEMO_PASSWORDS.employee, 10), student: bcrypt.hashSync(DEMO_PASSWORDS.student, 10), parent: bcrypt.hashSync(DEMO_PASSWORDS.parent, 10) };
  let created = 0;
  await withTx({ platform: true }, async () => {
    const { rows } = await q("select code, coalesce(settings->>'demo', 'false') = 'true' as demo from tenants");
    const known = new Map(rows.map((r) => [r.code, r.demo]));
    const todo = [];
    for (const spec of specs) {
      if (known.has(spec.code) && !known.get(spec.code)) { log(`[demo] "${spec.code}" belongs to a real institute, so it was left alone`); continue; }
      if (known.has(spec.code) && !reset) continue;
      todo.push(spec);
    }
    if (reset) for (const spec of todo) await q("delete from tenants where code = $1 and settings->>'demo' = 'true'", [spec.code]);
    for (const spec of todo) {
      await seedTenant(spec, hashes);
      created += 1;
      log(`[demo] loaded ${spec.type.padEnd(7)} ${spec.code}  (${spec.name})`);
    }
  });
  return { created };
}

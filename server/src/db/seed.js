/**
 * Demo data. Everything here is FICTIONAL sample data.
 *
 * seedDemoTenants() provisions the demo clients through the SAME service the
 * vendor console uses (provisionTenant), then fills each with sample records.
 * It connects as the restricted application role like the API does, so Row
 * Level Security applies to seeding too (nothing here bypasses tenant isolation).
 */
import { gradeAttempt } from '../services/quizGrading.js';
import bcrypt from 'bcryptjs';
import { q, switchTenant, withTx } from './pool.js';
import { provisionTenant } from '../services/tenant.service.js';
import { DEMO_PASSWORDS, DEMO_TENANTS } from './demo-data.js';
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
  { key: 'n1', title: 'Mid-term examination schedule released', body: 'The date sheet is available on the Calendar page.', category: 'Exam', rel: -1 },
  { key: 'n2', title: 'Library timings extended', body: 'The library stays open until 7:00 PM on all working days during exam preparation.', category: 'General', rel: -3 },
  { key: 'n3', title: 'Tech fest registrations open', body: 'Register your team at the department office.', category: 'Event', rel: -4 },
  { key: 'n4', title: 'Fee reminder', body: 'Please clear pending dues before the last date shown on the Calendar.', category: 'Fees', rel: -6 },
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
      `insert into notices (title, body, category, notice_date, seed_key) values ($1, $2, $3, $4, $5)
       on conflict (tenant_id, seed_key) where seed_key is not null do update set notice_date = excluded.notice_date`,
      [n.title, n.body, n.category, at(n.rel), `roll:${n.key}`],
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
     where s.weekday = $1 order by s.start_time`,
    [day.getDay()],
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
}

/** Startup hook: keep every demo tenant's rolling dates current. */
export async function refreshDemoTenants() {
  const tenants = await withTx({ platform: true }, async () => (
    await q("select id from tenants where settings->>'demo' = 'true'")
  ).rows);
  for (const t of tenants) await withTx({ tenantId: t.id }, refreshRollingData);
}

/* ---------- seeding ---------- */

async function seedTenant(spec, hashes) {
  const { tenantId } = await provisionTenant({
    code: spec.code, name: spec.name, type: spec.type, shortName: spec.shortName, plan: 'demo',
    settings: { demo: true }, admin: { ...spec.admin, password: DEMO_PASSWORDS.admin },
  });
  await switchTenant(tenantId);

  const i = spec.institute;
  await q(
    `update institute_profiles set tagline = $1, email = $2, website = $3, details = $4, stakeholders = $5,
       authorized_persons = $6, documents = $7, beneficiaries = $8, stamp = $9`,
    [i.tagline, i.email, i.website, i.details, JSON.stringify(i.stakeholders), JSON.stringify(i.authorizedPersons),
      JSON.stringify(i.documents), JSON.stringify(i.beneficiaries), i.stamp],
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
  await q("insert into number_series (key, prefix, padding, next_value) values ('employee', 'EMP', 3, $1)", [spec.employees.length + 1]);

  const c = spec.course;
  const { rows: [course] } = await q(
    'insert into courses (code, name, full_name, department_id, years) values ($1, $2, $3, $4, $5) returning id',
    [c.code, c.name, c.fullName, dept[c.department], c.years],
  );

  for (const s of spec.students) {
    const attendance = s.att.map(([attended, total], k) => ({ subject: spec.subjects[k], attended, total }));
    const { rows: [st] } = await q(
      `insert into students (student_code, roll_no, enrollment_no, name, email, phone, dob, gender, blood_group, nationality,
         course_id, semester, section, batch, admission_date, status, address, guardian, attendance)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'Indian', $10, $11, $12, $13, $14, 'Active', $15, $16, $17) returning id`,
      [s.code, s.roll, s.enroll, s.name, s.email, s.phone, s.dob, s.gender, s.blood, course.id, s.semester, s.section,
        s.batch, s.admitted, s.address, s.guardian, JSON.stringify(attendance)],
    );
    await q(
      `insert into users (role, login_id, email, name, password_hash, student_id) values ('student', $1, $2, $3, $4, $5)`,
      [s.code, s.email, s.name, hashes.student, st.id],
    );
  }

  // Weekly repeating timetable. weekday: 1 = Mon ... 5 = Fri. Subject k is taught by employee k.
  const periods = [['09:00', '10:00'], ['10:00', '11:00'], ['11:15', '12:15'], ['12:15', '13:15']];
  const grid = { 1: [0, 1, 5, 4], 2: [2, 0, 3, 1], 3: [5, 2, 4, 3], 4: [1, 3, 0, 2], 5: [4, 5, 0, 1] };
  const labs = new Set(['3-3', '4-2', '4-3']);
  for (const [weekday, subjectIdx] of Object.entries(grid)) {
    for (const [p, k] of subjectIdx.entries()) {
      const isLab = labs.has(`${weekday}-${p + 1}`);
      const online = k === 4;
      await q(
        `insert into timetable_slots (course_id, weekday, start_time, end_time, subject, employee_id, mode, location)
         values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [course.id, Number(weekday), periods[p][0], periods[p][1], isLab ? `${spec.subjects[k]} (Lab)` : spec.subjects[k],
          emp[k], online ? 'Online' : 'Offline', online ? 'Google Meet' : isLab ? spec.place.lab : spec.place.room],
      );
    }
  }

  await seedExams(spec, course.id, emp);
  await seedLearningAndQuizzes(spec, course.id, emp);
  await refreshRollingData();
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
  const { rows: students } = await q('select id, student_code from students order by student_code');
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
  for (const [i, st] of students.entries()) {
    for (const [k, paperId] of pastPapers.entries()) {
      let marks = Math.max(0, Math.min(100, base[i % base.length] + wobble[(k + i) % wobble.length]));
      if (i === 2 && k === spec.subjects.length - 1) marks = 36; // one failed paper
      await q('insert into exam_marks (paper_id, student_id, marks, absent) values ($1, $2, $3, false)', [paperId, st.id, marks]);
    }
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
  const hashes = { employee: bcrypt.hashSync(DEMO_PASSWORDS.employee, 10), student: bcrypt.hashSync(DEMO_PASSWORDS.student, 10) };
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

/**
 * Reports & exports.
 *
 * Every report is one definition: its filters ("params") and a run() that returns
 *   { columns: [{ header, key, type, width }], rows: [...], summary: [[label, value]], filters: [[label, value]] }
 * That single shape feeds the on-screen preview, CSV, Excel (.xlsx) and PDF, so the four can never disagree.
 * Reports are read-only and admin-only; each one is hidden when the module it draws on is switched off.
 */
import { q, isUuid } from '../db/pool.js';
import { HttpError } from '../middleware/error.js';
import { isISO, toISO } from '../utils/dates.js';
import { csvCell } from '../utils/csv.js';
import { buildXlsx } from './xlsx.js';
import { examResults } from './exams.service.js';
import { DEFAULT_THRESHOLD, report as attendanceReport } from './attendance.service.js';
import { compliance as learningCompliance } from './learning.service.js';
import { internalMarks as quizInternalMarks } from './quiz.service.js';

export const MAX_ROWS = 50000;
export const PREVIEW_ROWS = 200;

const inr = (n) => `Rs. ${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const PAY_METHODS = ['cash', 'cheque', 'bank_transfer', 'upi', 'card', 'online'];
const METHOD_LABEL = { cash: 'Cash', cheque: 'Cheque', bank_transfer: 'Bank transfer', upi: 'UPI', card: 'Card', online: 'Online' };
const STUDENT_STATUSES = ['Active', 'Inactive', 'Alumni'];

const ROLL_ORDER = "nullif(regexp_replace(s.roll_no, '\\D', '', 'g'), '')::numeric nulls last, s.roll_no, s.name";

async function courseName(id) {
  if (!id) return null;
  const { rows: [c] } = await q('select name from courses where id = $1', [id]);
  if (!c) throw new HttpError(404, 'Course not found.');
  return c.name;
}

/* ============================================================== definitions */

const DEFS = [
  {
    key: 'students', title: 'Student list', group: 'Students', module: 'students',
    description: 'Every student with contact and guardian details. Filter by course, semester and status.',
    params: [
      { key: 'courseId', label: 'Course', type: 'course' },
      { key: 'semester', label: 'Semester', type: 'int', min: 1, max: 20 },
      { key: 'status', label: 'Status', type: 'enum', options: STUDENT_STATUSES },
    ],
    async run(p) {
      const where = []; const params = [];
      if (p.courseId) { params.push(p.courseId); where.push(`s.course_id = $${params.length}`); }
      if (p.semester) { params.push(p.semester); where.push(`s.semester = $${params.length}`); }
      if (p.status) { params.push(p.status); where.push(`s.status = $${params.length}`); }
      const { rows } = await q(
        `select s.student_code as "studentCode", s.roll_no as "rollNo", s.enrollment_no as "enrollmentNo", s.name, c.name as course,
                s.semester, s.section, s.batch, s.status, s.gender, s.dob, s.phone, s.email, s.admission_date as "admissionDate",
                s.guardian->>'name' as "guardianName", s.guardian->>'phone' as "guardianPhone"
         from students s left join courses c on c.id = s.course_id
         ${where.length ? `where ${where.join(' and ')}` : ''}
         order by c.name nulls last, s.semester, ${ROLL_ORDER}`,
        params,
      );
      const n = (st) => rows.filter((r) => r.status === st).length;
      return {
        columns: [
          { header: 'Student ID', key: 'studentCode', width: 14 }, { header: 'Roll no.', key: 'rollNo', width: 12 }, { header: 'Name', key: 'name', width: 26 },
          { header: 'Course', key: 'course', width: 18 }, { header: 'Sem', key: 'semester', type: 'int', width: 6 }, { header: 'Section', key: 'section', width: 8 },
          { header: 'Batch', key: 'batch', width: 13, pdf: false }, { header: 'Status', key: 'status', width: 10 }, { header: 'Gender', key: 'gender', width: 9, pdf: false },
          { header: 'Date of birth', key: 'dob', type: 'date', pdf: false }, { header: 'Phone', key: 'phone', width: 14 }, { header: 'Email', key: 'email', width: 28 },
          { header: 'Admission date', key: 'admissionDate', type: 'date', pdf: false }, { header: 'Guardian', key: 'guardianName', width: 20, pdf: false }, { header: 'Guardian phone', key: 'guardianPhone', width: 14, pdf: false },
        ],
        rows,
        summary: [['Students', rows.length], ['Active', n('Active')], ['Inactive', n('Inactive')], ['Alumni', n('Alumni')]],
        filters: [['Course', await courseName(p.courseId)], ['Semester', p.semester], ['Status', p.status]],
      };
    },
  },
  {
    key: 'employees', title: 'Employee list', group: 'People',
    description: 'Every employee with department, designation and joining date.',
    params: [{ key: 'department', label: 'Department', type: 'text' }],
    async run(p) {
      const params = []; const where = [];
      if (p.department) { params.push(p.department.toLowerCase()); where.push(`lower(d.name) = $${params.length}`); }
      const { rows } = await q(
        `select e.emp_code as code, e.name, d.name as department, g.name as designation, e.email, e.shift, e.join_date as "joinDate"
         from employees e join departments d on d.id = e.department_id join designations g on g.id = e.designation_id
         ${where.length ? `where ${where.join(' and ')}` : ''} order by e.emp_code`,
        params,
      );
      return {
        columns: [
          { header: 'Code', key: 'code', width: 11 }, { header: 'Name', key: 'name', width: 26 }, { header: 'Department', key: 'department', width: 22 },
          { header: 'Designation', key: 'designation', width: 22 }, { header: 'Email', key: 'email', width: 30 }, { header: 'Shift', key: 'shift', width: 16 },
          { header: 'Joined', key: 'joinDate', type: 'date' },
        ],
        rows, summary: [['Employees', rows.length]], filters: [['Department', p.department]],
      };
    },
  },
  {
    key: 'fee-collection', title: 'Fee collection', group: 'Fees', module: 'fees',
    description: 'Every payment received in a period: receipt, student, method, what it paid for and who recorded it. Totals by method.',
    params: [
      { key: 'from', label: 'From', type: 'date' }, { key: 'to', label: 'To', type: 'date' },
      { key: 'method', label: 'Method', type: 'enum', options: PAY_METHODS, labels: METHOD_LABEL },
      { key: 'courseId', label: 'Course', type: 'course' },
    ],
    async run(p) {
      const where = []; const params = [];
      if (p.from) { params.push(p.from); where.push(`p.paid_at >= $${params.length}::date`); }
      if (p.to) { params.push(p.to); where.push(`p.paid_at < ($${params.length}::date + 1)`); }
      if (p.method) { params.push(p.method); where.push(`p.method = $${params.length}`); }
      if (p.courseId) { params.push(p.courseId); where.push(`s.course_id = $${params.length}`); }
      const { rows: raw } = await q(
        `select p.receipt_no as "receiptNo", to_char(p.paid_at, 'YYYY-MM-DD') as "paidOn", s.student_code as "studentCode", s.name as student,
                c.name as course, p.method, p.reference, p.amount::float8 as amount,
                (select string_agg(i.label, '; ' order by i.label) from payment_allocations a join student_fee_items i on i.id = a.fee_item_id where a.payment_id = p.id) as "appliedTo",
                case when p.method = 'online' and p.received_by is null then 'Online payment' else u.name end as "receivedBy"
         from payments p join students s on s.id = p.student_id left join courses c on c.id = s.course_id left join users u on u.id = p.received_by
         ${where.length ? `where ${where.join(' and ')}` : ''} order by p.paid_at, p.receipt_no`,
        params,
      );
      const rows = raw.map((r) => ({ ...r, method: METHOD_LABEL[r.method] || r.method }));
      const total = round2(rows.reduce((a, r) => a + r.amount, 0));
      const byMethod = PAY_METHODS.map((m) => {
        const mine = rows.filter((r) => r.method === METHOD_LABEL[m]);
        return mine.length ? [`${METHOD_LABEL[m]} (${mine.length})`, inr(round2(mine.reduce((a, r) => a + r.amount, 0)))] : null;
      }).filter(Boolean);
      return {
        columns: [
          { header: 'Receipt no.', key: 'receiptNo', width: 16 }, { header: 'Date', key: 'paidOn', type: 'date' }, { header: 'Student ID', key: 'studentCode', width: 13 },
          { header: 'Student', key: 'student', width: 24 }, { header: 'Course', key: 'course', width: 16 }, { header: 'Method', key: 'method', width: 13 },
          { header: 'Reference', key: 'reference', width: 18 }, { header: 'Applied to', key: 'appliedTo', width: 30 }, { header: 'Received by', key: 'receivedBy', width: 18 },
          { header: 'Amount (INR)', key: 'amount', type: 'money', width: 15 },
        ],
        rows, summary: [['Total collected', inr(total)], ['Payments', rows.length], ...byMethod],
        filters: [['From', p.from], ['To', p.to], ['Method', p.method ? METHOD_LABEL[p.method] : null], ['Course', await courseName(p.courseId)]],
      };
    },
  },
  {
    key: 'fee-dues', title: 'Outstanding fees', group: 'Fees', module: 'fees',
    description: 'Who owes what: charged, waived, paid, outstanding and overdue per student, largest balance first.',
    params: [
      { key: 'courseId', label: 'Course', type: 'course' },
      { key: 'overdueOnly', label: 'Only students with overdue fees', type: 'bool' },
    ],
    async run(p) {
      const params = []; const where = [];
      if (p.courseId) { params.push(p.courseId); where.push(`s.course_id = $${params.length}`); }
      const { rows } = await q(
        `with items as (
           select i.student_id, i.amount, i.status, i.due_date,
                  coalesce((select sum(a.amount) from payment_allocations a where a.fee_item_id = i.id), 0) as paid
           from student_fee_items i)
         select s.student_code as "studentCode", s.name as student, c.name as course,
                coalesce(sum(it.amount) filter (where it.status <> 'waived'), 0)::float8 as charged,
                coalesce(sum(it.amount) filter (where it.status = 'waived'), 0)::float8 as waived,
                coalesce(sum(it.paid), 0)::float8 as paid,
                coalesce(sum(it.amount - it.paid) filter (where it.status in ('unpaid', 'partial')), 0)::float8 as outstanding,
                coalesce(sum(it.amount - it.paid) filter (where it.status in ('unpaid', 'partial') and it.due_date < current_date), 0)::float8 as overdue,
                min(it.due_date) filter (where it.status in ('unpaid', 'partial')) as "nextDue"
         from students s join items it on it.student_id = s.id left join courses c on c.id = s.course_id
         ${where.length ? `where ${where.join(' and ')}` : ''}
         group by s.id, c.name
         having coalesce(sum(it.amount - it.paid) filter (where it.status in ('unpaid', 'partial')), 0) > 0
         ${p.overdueOnly ? "and coalesce(sum(it.amount - it.paid) filter (where it.status in ('unpaid', 'partial') and it.due_date < current_date), 0) > 0" : ''}
         order by outstanding desc, s.student_code`,
        params,
      );
      const sum = (k) => round2(rows.reduce((a, r) => a + r[k], 0));
      return {
        columns: [
          { header: 'Student ID', key: 'studentCode', width: 13 }, { header: 'Student', key: 'student', width: 26 }, { header: 'Course', key: 'course', width: 18 },
          { header: 'Charged', key: 'charged', type: 'money' }, { header: 'Waived', key: 'waived', type: 'money' }, { header: 'Paid', key: 'paid', type: 'money' },
          { header: 'Outstanding', key: 'outstanding', type: 'money' }, { header: 'Overdue', key: 'overdue', type: 'money' }, { header: 'Next due', key: 'nextDue', type: 'date' },
        ],
        rows, summary: [['Students with dues', rows.length], ['Total outstanding', inr(sum('outstanding'))], ['Of which overdue', inr(sum('overdue'))], ['Total charged', inr(sum('charged'))]],
        filters: [['Course', await courseName(p.courseId)], ['Overdue only', p.overdueOnly ? 'Yes' : null], ['As of', toISO(new Date())]],
      };
    },
  },
  {
    key: 'attendance', title: 'Attendance summary', group: 'Attendance', module: 'attendance',
    description: `Overall attendance per student from submitted registers. Anyone under ${DEFAULT_THRESHOLD}% is flagged.`,
    params: [
      { key: 'courseId', label: 'Course', type: 'course' }, { key: 'from', label: 'From', type: 'date' }, { key: 'to', label: 'To', type: 'date' },
      { key: 'below', label: 'Only students below %', type: 'percent' },
    ],
    async run(p) {
      const r = await attendanceReport({ courseId: p.courseId, from: p.from, to: p.to, below: p.below });
      const rows = r.students.map((s) => ({ ...s, flag: s.pct < DEFAULT_THRESHOLD ? `Below ${DEFAULT_THRESHOLD}%` : 'OK' }));
      const avg = rows.length ? round2(rows.reduce((a, s) => a + s.pct, 0) / rows.length) : null;
      return {
        columns: [
          { header: 'Roll no.', key: 'rollNo', width: 12 }, { header: 'Student ID', key: 'code', width: 13 }, { header: 'Student', key: 'name', width: 26 }, { header: 'Course', key: 'course', width: 18 },
          { header: 'Attended', key: 'attended', type: 'int' }, { header: 'Classes held', key: 'total', type: 'int' }, { header: 'Attendance %', key: 'pct', type: 'percent' }, { header: 'Status', key: 'flag', width: 12 },
        ],
        rows,
        summary: [['Students', rows.length], ['Registers counted', r.sessions], ['Average attendance', avg === null ? '-' : `${avg}%`], [`Below ${DEFAULT_THRESHOLD}%`, rows.filter((s) => s.pct < DEFAULT_THRESHOLD).length]],
        filters: [['Course', await courseName(p.courseId)], ['From', p.from], ['To', p.to], ['Below %', p.below]],
      };
    },
  },
  {
    key: 'attendance-subject', title: 'Attendance by subject', group: 'Attendance', module: 'attendance',
    description: 'One row per student per subject, ready to sort and pivot in Excel.',
    params: [
      { key: 'courseId', label: 'Course', type: 'course' }, { key: 'from', label: 'From', type: 'date' }, { key: 'to', label: 'To', type: 'date' },
    ],
    async run(p) {
      const r = await attendanceReport({ courseId: p.courseId, from: p.from, to: p.to });
      const rows = r.students.flatMap((s) => s.subjects.map((x) => ({ rollNo: s.rollNo, code: s.code, name: s.name, course: s.course, subject: x.subject, attended: x.attended, total: x.total, pct: x.pct })));
      return {
        columns: [
          { header: 'Roll no.', key: 'rollNo', width: 12 }, { header: 'Student ID', key: 'code', width: 13 }, { header: 'Student', key: 'name', width: 26 }, { header: 'Course', key: 'course', width: 18 },
          { header: 'Subject', key: 'subject', width: 26 }, { header: 'Attended', key: 'attended', type: 'int' }, { header: 'Classes held', key: 'total', type: 'int' }, { header: 'Attendance %', key: 'pct', type: 'percent' },
        ],
        rows, summary: [['Rows', rows.length], ['Registers counted', r.sessions]],
        filters: [['Course', await courseName(p.courseId)], ['From', p.from], ['To', p.to]],
      };
    },
  },
  {
    key: 'learning-credits', title: 'Learning credits (compulsory MOOCs)', group: 'Learning', module: 'learning',
    description: 'For each student: compulsory credits required, earned, still pending, how many assignments are overdue, and anything waiting for review.',
    params: [{ key: 'courseId', label: 'Class', type: 'course' }, { key: 'semester', label: 'Semester', type: 'int', min: 1, max: 20 }, { key: 'subject', label: 'Subject', type: 'text' }],
    async run(p) {
      const rows = (await learningCompliance({ role: 'admin' }, { courseId: p.courseId, semester: p.semester, subject: p.subject })).map((r) => ({
        ...r, standing: { complete: 'Complete', overdue: 'Overdue', on_track: 'On track', none: 'No compulsory work' }[r.standing],
      }));
      const n = (st) => rows.filter((r) => r.standing === st).length;
      return {
        columns: [
          { header: 'Roll no.', key: 'rollNo', width: 12 }, { header: 'Student ID', key: 'code', width: 13 }, { header: 'Student', key: 'name', width: 26 }, { header: 'Class', key: 'class', width: 16 },
          { header: 'Sem', key: 'semester', type: 'int', width: 6 }, { header: 'Credits required', key: 'required', type: 'number', width: 11 }, { header: 'Credits earned', key: 'earned', type: 'number', width: 10 },
          { header: 'Credits pending', key: 'pending', type: 'number', width: 10 }, { header: 'Bonus credits', key: 'bonus', type: 'number', width: 9 }, { header: 'Overdue', key: 'overdue', type: 'int', width: 8 },
          { header: 'Awaiting review', key: 'pendingReview', type: 'int', width: 9 }, { header: 'Standing', key: 'standing', width: 16 },
        ],
        rows, summary: [['Students', rows.length], ['Complete', n('Complete')], ['On track', n('On track')], ['Overdue', n('Overdue')]],
        filters: [['Class', await courseName(p.courseId)], ['Semester', p.semester], ['Subject', p.subject]],
      };
    },
  },
  {
    key: 'internal-marks', title: 'Internal marks (quizzes)', group: 'Exams', module: 'quizzes',
    description: 'A subject\'s internal marks from its quizzes: one column per quiz, scaled to what each is worth, with the total.',
    params: [
      { key: 'courseId', label: 'Class', type: 'course', required: true }, { key: 'semester', label: 'Semester', type: 'int', min: 1, max: 20, required: true },
      { key: 'subject', label: 'Subject', type: 'text', required: true },
    ],
    async run(p) {
      const m = await quizInternalMarks({ role: 'admin' }, { courseId: p.courseId, semester: p.semester, subject: p.subject });
      const rows = m.students.map((s) => {
        const row = { rollNo: s.rollNo, code: s.code, name: s.name, obtained: s.obtained, outOf: s.outOf, pct: s.pct };
        s.cells.forEach((c, i) => { row[`z${i}`] = c.eligible ? c.marks : null; });
        return row;
      });
      const avg = rows.length && m.totalWeightage ? Math.round((rows.reduce((a, r) => a + r.obtained, 0) / rows.length) * 100) / 100 : null;
      return {
        columns: [
          { header: 'Roll no.', key: 'rollNo', width: 12 }, { header: 'Student ID', key: 'code', width: 13 }, { header: 'Student', key: 'name', width: 26 },
          ...m.quizzes.map((z, i) => ({ header: `${z.title} (/${z.weightage})`, key: `z${i}`, type: 'number', width: 16 })),
          { header: 'Internal marks', key: 'obtained', type: 'number', width: 11 }, { header: 'Out of', key: 'outOf', type: 'number', width: 8 }, { header: 'Percentage', key: 'pct', type: 'percent', width: 10 },
        ],
        rows, summary: [['Students', rows.length], ['Quizzes counted', m.quizzes.length], ['Total weightage', m.totalWeightage], ['Class average', avg === null ? '-' : avg]],
        filters: [['Class', await courseName(p.courseId)], ['Semester', p.semester], ['Subject', p.subject]],
      };
    },
  },
  {
    key: 'exam-results', title: 'Exam results', group: 'Exams', module: 'exams',
    description: 'Marks per subject, total, percentage, GPA and pass/fail for one exam. Absent shows as AB.',
    params: [{ key: 'examId', label: 'Exam', type: 'exam', required: true }],
    async run(p) {
      const { exam, papers, students, stats } = await examResults(p.examId);
      const rows = students.map((s) => {
        const row = { rollNo: s.rollNo, code: s.code, name: s.name, total: s.total, maxTotal: s.maxTotal, pct: s.pct, gpa: s.gpa, result: s.result.toUpperCase() };
        s.subjects.forEach((x, i) => { row[`p${i}`] = x.status === 'pending' ? null : x.absent ? 'AB' : x.marks; });
        return row;
      });
      return {
        columns: [
          { header: 'Roll no.', key: 'rollNo', width: 12 }, { header: 'Student ID', key: 'code', width: 13 }, { header: 'Student', key: 'name', width: 26 },
          ...papers.map((x, i) => ({ header: `${x.subject} (/${x.maxMarks})`, key: `p${i}`, type: 'number', width: 14 })),
          { header: 'Total', key: 'total', type: 'number' }, { header: 'Out of', key: 'maxTotal', type: 'number' }, { header: 'Percentage', key: 'pct', type: 'percent' },
          { header: 'GPA', key: 'gpa', type: 'number', width: 8 }, { header: 'Result', key: 'result', width: 11 },
        ],
        rows,
        summary: [['Students', stats.students], ['Pass rate', stats.passRate === null ? '-' : `${stats.passRate}%`], ['Class average', stats.average === null ? '-' : `${stats.average}%`], ['Highest', stats.highest === null ? '-' : `${stats.highest}%`]],
        filters: [['Exam', exam.name], ['Course', exam.course], ['Semester', exam.semester], ['Status', exam.status === 'published' ? 'Published' : 'Draft (not yet published)']],
      };
    },
  },
];

const BY_KEY = new Map(DEFS.map((d) => [d.key, d]));

/* ============================================================== catalogue + params */

export function catalogue(tenantModules) {
  return DEFS.filter((d) => !d.module || tenantModules.includes(d.module)).map(({ run, ...d }) => d);
}

export function findReport(key, tenantModules) {
  const def = BY_KEY.get(key);
  if (!def) throw new HttpError(404, 'Unknown report.');
  if (def.module && !tenantModules.includes(def.module)) throw new HttpError(403, 'This report needs a module that is not enabled for your institute.');
  return def;
}

export function readParams(def, query) {
  const out = {};
  for (const p of def.params) {
    let v = query[p.key];
    if (Array.isArray(v)) [v] = v;
    if (v === undefined || v === null || String(v).trim() === '') {
      if (p.required) throw new HttpError(400, `${p.label} is required.`);
      continue;
    }
    v = String(v).trim();
    switch (p.type) {
      case 'course': case 'exam':
        if (!isUuid(v)) throw new HttpError(400, `${p.label} is not valid.`);
        break;
      case 'date':
        if (!isISO(v)) throw new HttpError(400, `${p.label} must look like YYYY-MM-DD.`);
        break;
      case 'int': {
        const n = Number(v);
        if (!Number.isInteger(n) || n < p.min || n > p.max) throw new HttpError(400, `${p.label} must be a whole number from ${p.min} to ${p.max}.`);
        v = n; break;
      }
      case 'percent': {
        const n = Number(v);
        if (!Number.isFinite(n) || n < 0 || n > 100) throw new HttpError(400, `${p.label} must be a percentage from 0 to 100.`);
        v = n; break;
      }
      case 'enum':
        if (!p.options.includes(v)) throw new HttpError(400, `${p.label} must be one of: ${p.options.join(', ')}.`);
        break;
      case 'bool': v = ['1', 'true', 'yes', 'on'].includes(v.toLowerCase()); break;
      case 'text':
        if (v.length > 80) throw new HttpError(400, `${p.label} is too long.`);
        break;
      default: break;
    }
    out[p.key] = v;
  }
  if (out.from && out.to && out.to < out.from) throw new HttpError(400, 'The end date cannot be before the start date.');
  return out;
}

export async function runReport(def, params) {
  const result = await def.run(params);
  if (result.rows.length > MAX_ROWS) throw new HttpError(413, `This report has ${result.rows.length} rows, more than the ${MAX_ROWS} that can be exported at once. Narrow the filters.`);
  return result;
}

/* ============================================================== renderers */

const cellValue = (r, c, i) => (Array.isArray(r) ? r[i] : r[c.key]);

export function toCsv({ columns, rows }) {
  const lines = [columns.map((c) => csvCell(c.header)).join(',')];
  for (const r of rows) lines.push(columns.map((c, i) => csvCell(cellValue(r, c, i))).join(','));
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

const stamp = () => {
  const d = new Date();
  return `${toISO(d)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

export function toXlsx(def, result, { institute, generatedBy }) {
  const about = [
    ['Report', def.title], ['Institute', institute.name], ['Generated', stamp()], ['Generated by', generatedBy || ''], ['Rows', result.rows.length],
    ['', ''], ...result.filters.filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k, v]) => [`Filter: ${k}`, v]),
    ['', ''], ...result.summary.map(([k, v]) => [k, v]),
  ];
  return buildXlsx([
    { name: def.title, columns: result.columns, rows: result.rows },
    { name: 'About this report', columns: [{ header: 'Item', width: 28 }, { header: 'Value', width: 44 }], rows: about, autoFilter: false, freeze: false },
  ]);
}

export const fileName = (def, ext) => `${def.key}-${toISO(new Date())}.${ext}`;

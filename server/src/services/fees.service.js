import { toISO } from '../utils/dates.js';
import { isUuid, q } from '../db/pool.js';
import { HttpError } from '../middleware/error.js';
import { audit } from '../db/audit.js';
import { nextNumber } from '../db/series.js';
import { notifyStudent } from './inbox.service.js';
import { tenantInfo } from './notifications.service.js';
import { env } from '../config/env.js';
import { isISO } from '../utils/dates.js';

const METHODS = ['cash', 'cheque', 'bank_transfer', 'upi', 'card', 'online'];
const money = (n, label) => {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) throw new HttpError(400, `${label} must be a positive amount.`);
  return Math.round(v * 100) / 100;
};

/* ---------------- fee structures (templates) ---------------- */

const STRUCT_SELECT = `
  select s.id, s.name, s.academic_year as "academicYear", s.course_id as "courseId", c.name as course, s.created_at as "createdAt",
         coalesce(json_agg(json_build_object('id', i.id, 'label', i.label, 'amount', i.amount, 'dueDate', i.due_date) order by i.due_date nulls last, i.label)
                  filter (where i.id is not null), '[]') as items,
         coalesce(sum(i.amount), 0) as total,
         (select count(*) from student_fee_items sfi where sfi.structure_id = s.id)::int as "assignedCount"
  from fee_structures s left join courses c on c.id = s.course_id left join fee_structure_items i on i.structure_id = s.id`;
const STRUCT_GROUP = 'group by s.id, c.name';

export async function listStructures() {
  const { rows } = await q(`${STRUCT_SELECT} ${STRUCT_GROUP} order by s.academic_year desc, c.name`);
  return rows;
}

export async function createStructure(body) {
  const { name, courseId, academicYear, items } = body || {};
  if (!name?.trim()) throw new HttpError(400, 'Name is required.');
  if (!academicYear?.trim()) throw new HttpError(400, 'Academic year is required.');
  const { rowCount } = await q('select 1 from courses where id = $1', [courseId]);
  if (!rowCount) throw new HttpError(400, 'Choose a valid course.');
  if (!Array.isArray(items) || !items.length) throw new HttpError(400, 'Add at least one fee item.');
  for (const it of items) { if (!it.label?.trim()) throw new HttpError(400, 'Every item needs a label.'); money(it.amount, `"${it.label}"`); }

  const { rows: [s] } = await q('insert into fee_structures (course_id, name, academic_year) values ($1, $2, $3) returning id', [courseId, name.trim(), academicYear.trim()]);
  for (const it of items) {
    await q('insert into fee_structure_items (structure_id, label, amount, due_date) values ($1, $2, $3, $4)',
      [s.id, it.label.trim(), money(it.amount, it.label), it.dueDate || null]);
  }
  const { rows: [full] } = await q(`${STRUCT_SELECT} where s.id = $1 ${STRUCT_GROUP}`, [s.id]);
  return full;
}

export async function deleteStructure(id) {
  const { rows: [{ n }] } = await q('select count(*)::int as n from student_fee_items where structure_id = $1', [id]);
  if (n) throw new HttpError(409, 'This fee structure has already been assigned to students and cannot be deleted.');
  const { rowCount } = await q('delete from fee_structures where id = $1', [id]);
  if (!rowCount) throw new HttpError(404, 'Fee structure not found.');
}

/**
 * Copies a structure's items onto one student as concrete charges. Refuses to double-assign the
 * same structure to the same student. Editing the structure afterwards never changes what was charged.
 */
export async function assignStructure(structureId, studentId, admin) {
  const { rows: [s] } = await q('select id from fee_structures where id = $1', [structureId]);
  if (!s) throw new HttpError(404, 'Fee structure not found.');
  const { rows: [student] } = await q('select id from students where id = $1', [studentId]);
  if (!student) throw new HttpError(404, 'Student not found.');
  const { rows: [{ n }] } = await q('select count(*)::int as n from student_fee_items where student_id = $1 and structure_id = $2', [studentId, structureId]);
  if (n) throw new HttpError(409, 'This fee structure is already assigned to this student.');

  const { rows: items } = await q('select label, amount, due_date from fee_structure_items where structure_id = $1', [structureId]);
  for (const it of items) {
    await q('insert into student_fee_items (student_id, label, amount, due_date, source, structure_id) values ($1, $2, $3, $4, $5, $6)',
      [studentId, it.label, it.amount, it.due_date, 'structure', structureId]);
  }
  await audit(admin, 'fees.assign_structure', 'student', studentId, { structureId, items: items.length });
  return items.length;
}

/** Assigns a structure to every currently-unassigned student of the structure's course. Returns how many. */
export async function bulkAssign(structureId, admin) {
  const { rows: [s] } = await q('select course_id from fee_structures where id = $1', [structureId]);
  if (!s) throw new HttpError(404, 'Fee structure not found.');
  const { rows: targets } = await q(
    `select id from students where course_id = $1 and status = 'Active'
       and not exists (select 1 from student_fee_items sfi where sfi.student_id = students.id and sfi.structure_id = $2)`,
    [s.course_id, structureId],
  );
  for (const t of targets) await assignStructure(structureId, t.id, admin);
  return targets.length;
}

/* ---------------- a student's charges ---------------- */

const ITEM_SELECT = `
  select i.id, i.label, i.amount, i.due_date as "dueDate", i.status, i.source, i.created_at as "createdAt", i.waived_reason as "waivedReason",
         coalesce((select sum(a.amount) from payment_allocations a where a.fee_item_id = i.id), 0) as paid
  from student_fee_items i where i.student_id = $1 order by i.due_date nulls last, i.created_at`;

export async function studentFees(studentId) {
  const { rowCount } = await q('select 1 from students where id = $1', [studentId]);
  if (!rowCount) throw new HttpError(404, 'Student not found.');
  const { rows: items } = await q(ITEM_SELECT, [studentId]);
  // A waived charge (or the waived part of a concession) is not owed, so it is left out of the total
  const total = items.filter((i) => i.status !== 'waived').reduce((a, i) => a + Number(i.amount), 0);
  const paid = items.reduce((a, i) => a + Number(i.paid), 0);
  return { items, summary: { total, paid, outstanding: Math.round((total - paid) * 100) / 100 } };
}

export async function addManualItem(studentId, body, admin) {
  const { label, amount, dueDate } = body || {};
  if (!label?.trim()) throw new HttpError(400, 'Label is required.');
  const { rowCount } = await q('select 1 from students where id = $1', [studentId]);
  if (!rowCount) throw new HttpError(404, 'Student not found.');
  const { rows: [item] } = await q(
    "insert into student_fee_items (student_id, label, amount, due_date, source) values ($1, $2, $3, $4, 'manual') returning id",
    [studentId, label.trim(), money(amount, label), dueDate || null],
  );
  await audit(admin, 'fees.add_item', 'student', studentId, { label: label.trim(), amount });
  return item.id;
}

export async function waiveItem(itemId, reason, admin) {
  if (!reason?.trim()) throw new HttpError(400, 'Say why this charge is being waived.');
  const { rows: [item] } = await q('select student_id, status from student_fee_items where id = $1 for update', [itemId]);
  if (!item) throw new HttpError(404, 'Fee item not found.');
  if (item.status === 'paid') throw new HttpError(409, 'A fully paid item cannot be waived.');
  const { rows: [{ n }] } = await q('select count(*)::int as n from payment_allocations where fee_item_id = $1', [itemId]);
  if (n) throw new HttpError(409, 'This item already has a payment allocated to it and cannot be waived. Refund the payment first.');
  await q("update student_fee_items set status = 'waived', waived_reason = $1 where id = $2", [reason.trim(), itemId]);
  await audit(admin, 'fees.waive_item', 'student_fee_item', itemId, { reason: reason.trim() });
  return item.student_id;
}

/**
 * A concession (scholarship, staff ward, sibling): takes part of an unpaid charge off. The charge is reduced and the
 * part taken off is kept beside it as a waived line ("Concession: Tuition"), so the ledger still shows what was given and why.
 */
export async function giveConcession(itemId, { amount, reason } = {}, admin) {
  if (!String(reason || '').trim()) throw new HttpError(400, 'Say why the concession is given (for example: merit scholarship).');
  const off = money(amount, 'The concession');
  const { rows: [item] } = await q('select id, student_id, label, amount, due_date, status from student_fee_items where id = $1 for update', [itemId]);
  if (!item) throw new HttpError(404, 'Fee item not found.');
  if (!['unpaid', 'partial'].includes(item.status)) throw new HttpError(409, 'A concession can only be given on a charge that is still to be paid.');
  const { rows: [{ paid }] } = await q('select coalesce(sum(amount), 0)::float8 as paid from payment_allocations where fee_item_id = $1', [itemId]);
  const balance = Math.round((Number(item.amount) - paid) * 100) / 100;
  if (off > balance + 0.001) throw new HttpError(400, `The concession cannot be more than what is still due on "${item.label}" (₹${balance.toLocaleString('en-IN')}).`);
  const left = Math.round((Number(item.amount) - off) * 100) / 100;
  if (left <= 0) {
    // The whole charge is let off and nothing was paid on it: that is a waiver
    await q("update student_fee_items set status = 'waived', waived_reason = $1 where id = $2", [`Concession: ${reason.trim()}`, itemId]);
  } else {
    await q('update student_fee_items set amount = $1, status = $2 where id = $3', [left, left - paid <= 0.01 ? 'paid' : item.status, itemId]);
    await q(
      "insert into student_fee_items (student_id, label, amount, due_date, source, status, waived_reason) values ($1, $2, $3, $4, 'manual', 'waived', $5)",
      [item.student_id, `Concession: ${item.label}`.slice(0, 200), off, item.due_date, reason.trim()],
    );
  }
  await audit(admin, 'fees.concession', 'student_fee_item', itemId, { amount: off, reason: reason.trim() });
  return item.student_id;
}

const LATE_PREFIX = 'Late fee: ';

/**
 * Adds a late fee to every overdue charge (of one class, or the whole institute) that does not have one yet.
 * With `preview` nothing is saved; the office sees how many students and how much first.
 */
export async function applyLateFees({ courseId, amount, preview } = {}, admin) {
  const fee = money(amount, 'The late fee');
  if (courseId && !isUuid(courseId)) throw new HttpError(400, 'Choose a class, or leave it empty for all classes.');
  const params = [LATE_PREFIX];
  let where = '';
  if (courseId) { params.push(courseId); where = `and s.course_id = $${params.length}`; }
  const { rows } = await q(
    `select i.id, i.student_id, i.label from student_fee_items i join students s on s.id = i.student_id
     where s.status = 'Active' and i.status in ('unpaid', 'partial') and i.due_date < current_date and i.label not like $1 || '%' ${where}
       and not exists (select 1 from student_fee_items l where l.student_id = i.student_id and l.label = $1 || i.label)
     order by s.student_code, i.due_date`, params,
  );
  const students = new Set(rows.map((r) => r.student_id)).size;
  const out = { charges: rows.length, students, amount: fee, total: Math.round(rows.length * fee * 100) / 100 };
  if (preview || !rows.length) return { ...out, applied: false };
  for (const r of rows) {
    await q("insert into student_fee_items (student_id, label, amount, due_date, source) values ($1, $2, $3, current_date, 'manual')",
      [r.student_id, `${LATE_PREFIX}${r.label}`.slice(0, 200), fee]);
  }
  await audit(admin, 'fees.late_fees', 'course', courseId || null, out);
  return { ...out, applied: true };
}

/* ---------------- reminders ---------------- */

const inrText = (n) => `Rs. ${Math.round(Number(n)).toLocaleString('en-IN')}`;
const dayText = (d) => new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

/** The ready-to-send reminder for one student. Plain text so it reads the same on WhatsApp, SMS and email. */
export function reminderText({ institute, guardianName, studentName, studentCode, outstanding, overdue, oldestDue, link }) {
  const hello = guardianName ? `Dear ${guardianName},` : 'Dear Parent,';
  const due = overdue > 0
    ? `${inrText(overdue)} of fees for ${studentName} (${studentCode}) is overdue since ${dayText(oldestDue)}${outstanding > overdue ? `, and ${inrText(outstanding)} is due in all` : ''}.`
    : `${inrText(outstanding)} of fees for ${studentName} (${studentCode}) is due.`;
  return `${hello} This is a reminder from ${institute}. ${due} Please pay at the fee office or online: ${link} Thank you.`;
}

/** Digits only, with India's 91 in front of a 10-digit mobile, as wa.me links need. Empty if it does not look like a mobile. */
export function whatsappNumber(phone) {
  const d = String(phone || '').replace(/\D/g, '');
  if (d.length === 10) return `91${d}`;
  if (d.length === 12 && d.startsWith('91')) return d;
  return '';
}

/** Every active student who owes something (or only those overdue), with a ready reminder and a WhatsApp link. */
export async function reminders({ courseId, overdueOnly } = {}) {
  if (courseId && !isUuid(courseId)) throw new HttpError(400, 'Choose a class, or leave it empty for all classes.');
  const params = []; let where = '';
  if (courseId) { params.push(courseId); where = `and s.course_id = $${params.length}`; }
  const OPEN = '(i.amount - coalesce((select sum(a.amount) from payment_allocations a where a.fee_item_id = i.id), 0))';
  const { rows } = await q(
    `select s.id, s.name, s.student_code as "studentCode", c.name as course, s.phone,
            s.guardian->>'name' as "guardianName", s.guardian->>'phone' as "guardianPhone",
            sum(${OPEN})::float8 as outstanding,
            coalesce(sum(${OPEN}) filter (where i.due_date < current_date), 0)::float8 as overdue,
            min(i.due_date) filter (where i.due_date < current_date) as "oldestDue",
            exists (select 1 from parent_links l where l.student_id = s.id) as "parentLinked"
     from student_fee_items i join students s on s.id = i.student_id left join courses c on c.id = s.course_id
     where s.status = 'Active' and i.status in ('unpaid', 'partial') ${where}
     group by s.id, c.name
     having sum(${OPEN}) > 0.009 ${overdueOnly ? `and coalesce(sum(${OPEN}) filter (where i.due_date < current_date), 0) > 0` : ''}
     order by min(i.due_date) nulls last, s.student_code`, params,
  );
  const info = await tenantInfo();
  const link = `${env.APP_URL}/login`;
  return {
    students: rows.map((r) => {
      const message = reminderText({ institute: info.name, ...r, link });
      const wa = whatsappNumber(r.guardianPhone || r.phone);
      return { ...r, message, whatsapp: wa ? `https://wa.me/${wa}?text=${encodeURIComponent(message)}` : null };
    }),
  };
}

/** Sends the reminder inside the app to each student and their linked parents (their bell and inbox). */
export async function sendReminders({ studentIds, courseId, overdueOnly } = {}, admin) {
  if (!Array.isArray(studentIds) || !studentIds.length) throw new HttpError(400, 'Choose at least one student to remind.');
  if (!studentIds.every(isUuid)) throw new HttpError(400, 'One of the chosen students is not valid. Reload the page.');
  const wanted = new Set(studentIds);
  const { students } = await reminders({ courseId, overdueOnly });
  let sent = 0;
  for (const s of students.filter((x) => wanted.has(x.id))) {
    await notifyStudent(s.id, { kind: 'fees', title: s.overdue > 0 ? 'Fee overdue' : 'Fee due', body: s.message.slice(0, 500), link: '/student/fees' }, { parents: true });
    sent += 1;
  }
  await audit(admin, 'fees.remind', 'student', null, { sent });
  return { sent, skipped: wanted.size - sent };
}

/* ---------------- payments ---------------- */

const PAYMENT_SELECT = `
  select p.id, p.receipt_no as "receiptNo", p.amount, p.method, p.reference, p.note, p.paid_at as "paidAt",
         s.name as "studentName", s.student_code as "studentCode", s.id as "studentId", c.name as course,
         coalesce(json_agg(json_build_object('feeItemId', a.fee_item_id, 'label', i.label, 'amount', a.amount)) filter (where a.id is not null), '[]') as allocations
  from payments p
  join students s on s.id = p.student_id
  left join courses c on c.id = s.course_id
  left join payment_allocations a on a.payment_id = p.id
  left join student_fee_items i on i.id = a.fee_item_id`;

export async function listPayments({ studentId, search } = {}) {
  const where = []; const params = [];
  if (studentId) { params.push(studentId); where.push(`p.student_id = $${params.length}`); }
  if (search) { params.push(`%${String(search).toLowerCase()}%`); where.push(`(lower(s.name) like $${params.length} or lower(s.student_code) like $${params.length} or lower(p.receipt_no) like $${params.length})`); }
  const { rows } = await q(`${PAYMENT_SELECT} ${where.length ? `where ${where.join(' and ')}` : ''} group by p.id, s.name, s.student_code, s.id, c.name order by p.paid_at desc`, params);
  return rows;
}

export async function getPayment(id) {
  const { rows: [p] } = await q(`${PAYMENT_SELECT} where p.id = $1 group by p.id, s.name, s.student_code, s.id, c.name`, [id]);
  if (!p) throw new HttpError(404, 'Payment not found.');
  return p;
}

/**
 * Records a payment and allocates it to fee items. If `allocations` is omitted, the amount is
 * applied automatically to the student's oldest unpaid/partially-paid items first (the common
 * case - "the parent paid ₹20,000, apply it to whatever is due"). Over-allocation and
 * allocating more than an item's remaining balance are both rejected.
 *
 * `admin` is the staff member recording it. Online (Razorpay) payments are recorded by the
 * system, not a person, and pass `{ id: null, role: 'student' | 'webhook' }` - the audit log
 * keeps the label and `received_by` stays empty.
 */
export async function recordPayment(body, admin) {
  const { studentId, amount, method, reference, note, allocations } = body || {};
  if (!METHODS.includes(method)) throw new HttpError(400, `Method must be one of: ${METHODS.join(', ')}.`);
  const total = money(amount, 'Amount');
  const { rowCount } = await q('select 1 from students where id = $1', [studentId]);
  if (!rowCount) throw new HttpError(404, 'Student not found.');

  const { rows: open } = await q(
    `select i.id, i.amount - coalesce((select sum(a.amount) from payment_allocations a where a.fee_item_id = i.id), 0) as balance
     from student_fee_items i where i.student_id = $1 and i.status in ('unpaid', 'partial') order by i.due_date nulls last, i.created_at`,
    [studentId],
  );
  const balanceOf = (id) => open.find((o) => o.id === id)?.balance;

  let plan;
  if (Array.isArray(allocations) && allocations.length) {
    plan = allocations.map((a) => ({ feeItemId: a.feeItemId, amount: money(a.amount, 'Allocation') }));
    for (const a of plan) {
      const bal = balanceOf(a.feeItemId);
      if (bal === undefined) throw new HttpError(400, 'One of the fee items is not open for this student.');
      if (a.amount > bal + 0.001) throw new HttpError(400, 'An allocation cannot exceed the item\'s remaining balance.');
    }
    const sum = plan.reduce((a, x) => a + x.amount, 0);
    if (Math.abs(sum - total) > 0.01) throw new HttpError(400, 'Allocations must add up to the payment amount.');
  } else {
    plan = []; let remaining = total;
    for (const o of open) {
      if (remaining <= 0) break;
      const take = Math.min(Number(o.balance), remaining);
      if (take > 0) { plan.push({ feeItemId: o.id, amount: Math.round(take * 100) / 100 }); remaining -= take; }
    }
    if (remaining > 0.01) throw new HttpError(400, `This student only has ₹${open.reduce((a, o) => a + Number(o.balance), 0).toFixed(2)} outstanding - the payment amount is too large. Specify allocations to record an advance.`);
  }

  const receiptNo = await nextNumber('receipt', { prefix: `RCPT${new Date().getFullYear()}-`, padding: 5 });
  const { rows: [p] } = await q(
    'insert into payments (student_id, receipt_no, amount, method, reference, note, received_by) values ($1, $2, $3, $4, $5, $6, $7) returning id',
    [studentId, receiptNo, total, method, (reference || '').trim(), (note || '').trim(), admin?.id ?? null],
  );
  for (const a of plan) {
    await q('insert into payment_allocations (payment_id, fee_item_id, amount) values ($1, $2, $3)', [p.id, a.feeItemId, a.amount]);
    const bal = balanceOf(a.feeItemId) - a.amount;
    await q("update student_fee_items set status = $1 where id = $2", [bal <= 0.01 ? 'paid' : 'partial', a.feeItemId]);
  }
  await audit(admin, 'fees.payment', 'student', studentId, { receiptNo, amount: total, method });
  await notifyStudent(studentId, { kind: 'fees', title: `Payment of ₹${total.toLocaleString('en-IN')} received`, body: `Receipt ${receiptNo}. Thank you.`, link: '/student/fees' }, { parents: true });
  return getPayment(p.id);
}

/**
 * Every active student of one class or division with what they have been charged, paid and what is overdue, so the fee
 * desk can work down a whole class and collect from each in turn.
 */
export async function classDues(courseId) {
  if (!isUuid(courseId)) throw new HttpError(400, 'Choose a class.');
  const { rows } = await q(
    `select s.id, s.name, s.student_code as "studentCode", s.roll_no as "rollNo",
            coalesce(sum(i.amount) filter (where i.status <> 'waived'), 0)::float8 as total,
            coalesce(sum(p.paid) filter (where i.status <> 'waived'), 0)::float8 as paid,
            coalesce(sum(i.amount - p.paid) filter (where i.status in ('unpaid', 'partial') and i.due_date < current_date), 0)::float8 as overdue
     from students s
     left join student_fee_items i on i.student_id = s.id
     left join lateral (select coalesce(sum(a.amount), 0) as paid from payment_allocations a where a.fee_item_id = i.id) p on true
     where s.course_id = $1 and s.status = 'Active'
     group by s.id order by s.student_code`, [courseId],
  );
  const students = rows.map((r) => ({ ...r, outstanding: Math.round((r.total - r.paid) * 100) / 100 }));
  return {
    students,
    totals: {
      total: students.reduce((a, r) => a + r.total, 0), paid: students.reduce((a, r) => a + r.paid, 0),
      outstanding: Math.round(students.reduce((a, r) => a + r.outstanding, 0) * 100) / 100,
      overdue: students.reduce((a, r) => a + r.overdue, 0), clear: students.filter((r) => r.outstanding <= 0 && r.total > 0).length,
    },
  };
}

/* ---------------- overview for the Fees page ---------------- */

/**
 * The figures the office needs first: what came in, what is still to collect, what is already overdue,
 * what falls due this week, and the students who owe the most overdue money.
 */
export async function summary() {
  const now = new Date();
  const today = toISO(now);
  const monthStart = `${today.slice(0, 8)}01`;
  const lastMonthStart = toISO(new Date(now.getFullYear(), now.getMonth() - 1, 1));
  const OPEN = `(i.amount - coalesce((select sum(a.amount) from payment_allocations a where a.fee_item_id = i.id), 0))`;
  const { rows: [t] } = await q(
    `select coalesce((select sum(amount) from payments where paid_at >= $1::date), 0)::float8 as "collectedToday",
            coalesce((select sum(amount) from payments where paid_at >= $2::date), 0)::float8 as "collectedThisMonth",
            coalesce((select sum(amount) from payments where paid_at >= $3::date and paid_at < $2::date), 0)::float8 as "collectedLastMonth",
            coalesce(sum(${OPEN}), 0)::float8 as outstanding,
            coalesce(sum(${OPEN}) filter (where i.due_date < $1::date), 0)::float8 as overdue,
            coalesce(sum(${OPEN}) filter (where i.due_date between $1::date and $1::date + 7), 0)::float8 as "dueThisWeek",
            count(distinct i.student_id)::int as "studentsWithDues",
            count(distinct i.student_id) filter (where i.due_date < $1::date)::int as "studentsOverdue",
            (select count(*) from student_fee_items)::int as "itemsTotal"
     from student_fee_items i where i.status in ('unpaid', 'partial')`, [today, monthStart, lastMonthStart],
  );
  const { rows: overdueStudents } = await q(
    `select s.id as "studentId", s.name, s.student_code as "studentCode", c.name as course,
            sum(${OPEN})::float8 as overdue, min(i.due_date) as "oldestDue"
     from student_fee_items i join students s on s.id = i.student_id left join courses c on c.id = s.course_id
     where i.status in ('unpaid', 'partial') and i.due_date < $1::date
     group by s.id, c.name order by min(i.due_date), sum(${OPEN}) desc limit 8`, [today],
  );
  const { rows: [{ n: structures }] } = await q('select count(*)::int as n from fee_structures');
  // Active students of a class that has a fee plan but who have been charged nothing from any plan yet
  const { rows: [{ n: unassigned }] } = await q(
    `select count(*)::int as n from students s
     where s.status = 'Active' and exists (select 1 from fee_structures f where f.course_id = s.course_id)
       and not exists (select 1 from student_fee_items i where i.student_id = s.id and i.source = 'structure')`,
  );
  return { ...t, structures, unassigned, overdueStudents };
}

/* ---------------- day-end summary ---------------- */

const METHOD_LABEL = { cash: 'Cash', cheque: 'Cheque', bank_transfer: 'Bank transfer', upi: 'UPI', card: 'Card', online: 'Online' };

/** Everything collected on one day: by method (to match the cash drawer and the bank), by who took it, and each receipt. */
export async function dayEnd(date) {
  const day = date || toISO(new Date());
  if (!isISO(day)) throw new HttpError(400, 'Choose a date.');
  const { rows: receipts } = await q(
    `select p.id, p.receipt_no as "receiptNo", p.amount::float8 as amount, p.method, p.reference, p.paid_at as "paidAt",
            s.name as "studentName", s.student_code as "studentCode", c.name as course, coalesce(u.name, 'Online') as "receivedBy"
     from payments p join students s on s.id = p.student_id left join courses c on c.id = s.course_id left join users u on u.id = p.received_by
     where p.paid_at >= $1::date and p.paid_at < $1::date + 1 order by p.paid_at`, [day],
  );
  const group = (key, label) => {
    const m = new Map();
    for (const r of receipts) {
      const k = r[key]; const g = m.get(k) || { key: k, label: label(k), count: 0, amount: 0 };
      g.count += 1; g.amount = Math.round((g.amount + r.amount) * 100) / 100; m.set(k, g);
    }
    return [...m.values()].sort((a, b) => b.amount - a.amount);
  };
  return {
    date: day,
    total: Math.round(receipts.reduce((a, r) => a + r.amount, 0) * 100) / 100,
    count: receipts.length,
    byMethod: group('method', (k) => METHOD_LABEL[k] || k),
    byStaff: group('receivedBy', (k) => k),
    receipts: receipts.map((r) => ({ ...r, methodLabel: METHOD_LABEL[r.method] || r.method })),
  };
}

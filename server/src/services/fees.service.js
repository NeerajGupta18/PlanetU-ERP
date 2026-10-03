import { q } from '../db/pool.js';
import { HttpError } from '../middleware/error.js';
import { audit } from '../db/audit.js';
import { nextNumber } from '../db/series.js';

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
  select i.id, i.label, i.amount, i.due_date as "dueDate", i.status, i.source, i.created_at as "createdAt",
         coalesce((select sum(a.amount) from payment_allocations a where a.fee_item_id = i.id), 0) as paid
  from student_fee_items i where i.student_id = $1 order by i.due_date nulls last, i.created_at`;

export async function studentFees(studentId) {
  const { rowCount } = await q('select 1 from students where id = $1', [studentId]);
  if (!rowCount) throw new HttpError(404, 'Student not found.');
  const { rows: items } = await q(ITEM_SELECT, [studentId]);
  const total = items.reduce((a, i) => a + Number(i.amount), 0);
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

/* ---------------- payments ---------------- */

const PAYMENT_SELECT = `
  select p.id, p.receipt_no as "receiptNo", p.amount, p.method, p.reference, p.note, p.paid_at as "paidAt",
         s.name as "studentName", s.student_code as "studentCode", s.id as "studentId",
         coalesce(json_agg(json_build_object('feeItemId', a.fee_item_id, 'label', i.label, 'amount', a.amount)) filter (where a.id is not null), '[]') as allocations
  from payments p
  join students s on s.id = p.student_id
  left join payment_allocations a on a.payment_id = p.id
  left join student_fee_items i on i.id = a.fee_item_id`;

export async function listPayments({ studentId, search } = {}) {
  const where = []; const params = [];
  if (studentId) { params.push(studentId); where.push(`p.student_id = $${params.length}`); }
  if (search) { params.push(`%${String(search).toLowerCase()}%`); where.push(`(lower(s.name) like $${params.length} or lower(s.student_code) like $${params.length} or lower(p.receipt_no) like $${params.length})`); }
  const { rows } = await q(`${PAYMENT_SELECT} ${where.length ? `where ${where.join(' and ')}` : ''} group by p.id, s.name, s.student_code, s.id order by p.paid_at desc`, params);
  return rows;
}

export async function getPayment(id) {
  const { rows: [p] } = await q(`${PAYMENT_SELECT} where p.id = $1 group by p.id, s.name, s.student_code, s.id`, [id]);
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
  return getPayment(p.id);
}

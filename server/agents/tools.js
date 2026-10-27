/**
 * The assistants' tools: small, read-only questions answered by SQL.
 *
 * Every tool runs inside the signed-in person's own request transaction, so Row Level Security keeps it to their
 * institute, and runTool() checks that their office role covers the tool's area and that the module is switched
 * on. Inputs are checked against a strict schema (known keys only, enums, bounded numbers) before any SQL runs.
 * Results carry codes and first names only: no phone numbers, emails or addresses ever reach a model.
 * Every figure the assistant talks about comes from these results and is shown on screen as "Figures used".
 */
import { q } from '../src/db/pool.js';
import { HttpError } from '../src/middleware/error.js';
import { addDays, toISO } from '../src/utils/dates.js';
import { approvalCounts } from '../src/services/approvals.service.js';

/* ---------------- strict input checking ---------------- */

/** A small JSON-schema subset: object, string (enum, maxLength), integer (minimum, maximum). Unknown keys are refused. */
export function checkArgs(schema, args) {
  if (args === null || typeof args !== 'object' || Array.isArray(args)) throw new Error('arguments must be an object');
  const props = schema.properties || {};
  for (const k of Object.keys(args)) if (!props[k]) throw new Error(`unknown argument "${k}"`);
  for (const k of schema.required || []) if (args[k] === undefined) throw new Error(`"${k}" is required`);
  const out = {};
  for (const [k, p] of Object.entries(props)) {
    const v = args[k];
    if (v === undefined) continue;
    if (p.type === 'string') {
      if (typeof v !== 'string') throw new Error(`"${k}" must be text`);
      if (p.enum && !p.enum.includes(v)) throw new Error(`"${k}" must be one of ${p.enum.join(', ')}`);
      if (p.maxLength && v.length > p.maxLength) throw new Error(`"${k}" is too long`);
      out[k] = v;
    } else if (p.type === 'integer') {
      if (!Number.isInteger(v)) throw new Error(`"${k}" must be a whole number`);
      if ((p.minimum !== undefined && v < p.minimum) || (p.maximum !== undefined && v > p.maximum)) throw new Error(`"${k}" is out of range`);
      out[k] = v;
    } else {
      throw new Error(`"${k}" has an unsupported type`);
    }
  }
  return out;
}

/* ---------------- periods ---------------- */

export const PERIODS = ['today', 'yesterday', 'this_week', 'last_week', 'last_7_days', 'this_month'];
const PERIOD_LABEL = { today: 'Today', yesterday: 'Yesterday', this_week: 'This week', last_week: 'Last week', last_7_days: 'Last 7 days', this_month: 'This month' };

/** Calendar dates for a period, weeks starting on Monday. */
export function periodRange(period, now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const monday = addDays(today, -((today.getDay() + 6) % 7));
  switch (period) {
    case 'today': return { from: toISO(today), to: toISO(today) };
    case 'yesterday': return { from: toISO(addDays(today, -1)), to: toISO(addDays(today, -1)) };
    case 'this_week': return { from: toISO(monday), to: toISO(today) };
    case 'last_week': return { from: toISO(addDays(monday, -7)), to: toISO(addDays(monday, -1)) };
    case 'last_7_days': return { from: toISO(addDays(today, -6)), to: toISO(today) };
    case 'this_month': return { from: toISO(new Date(today.getFullYear(), today.getMonth(), 1)), to: toISO(today) };
    default: throw new Error('unknown period');
  }
}

const pct = (a, t) => (t ? Math.round((a / t) * 1000) / 10 : null);
const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || '';
const OPEN = '(i.amount - coalesce((select sum(a.amount) from payment_allocations a where a.fee_item_id = i.id), 0))';
const period = { type: 'string', enum: PERIODS, description: 'Which dates to cover.' };

/* ---------------- the tools ---------------- */

export const TOOLS = {
  attendance_by_class: {
    area: 'attendance', module: 'attendance',
    description: 'Attendance percentage for each class over a period (only submitted registers), lowest first.',
    parameters: { type: 'object', properties: { period }, required: ['period'], additionalProperties: false },
    async run({ period: p }) {
      const r = periodRange(p);
      const { rows } = await q(
        `select c.code as class_code, c.name as class, count(distinct a.id)::int as registers,
                count(*)::int as marks, count(*) filter (where rec.status in ('present', 'late'))::int as attended
         from attendance_records rec join attendance_sessions a on a.id = rec.session_id join courses c on c.id = a.course_id
         where a.status = 'submitted' and a.on_date between $1 and $2
         group by c.code, c.name`, [r.from, r.to],
      );
      const classes = rows.map((x) => ({ ...x, percent: pct(x.attended, x.marks) })).sort((a, b) => a.percent - b.percent || a.class_code.localeCompare(b.class_code));
      return { label: `Attendance by class, ${PERIOD_LABEL[p].toLowerCase()} (${r.from} to ${r.to})`, from: r.from, to: r.to, classes };
    },
  },
  students_below_attendance: {
    area: 'attendance', module: 'attendance',
    description: 'Active students whose attendance this term is below a percentage. Gives the count and the lowest ten (student code and first name).',
    parameters: {
      type: 'object',
      properties: {
        threshold: { type: 'integer', minimum: 40, maximum: 95, description: 'The percentage, for example 75.' },
        class_code: { type: 'string', maxLength: 40, description: 'Only this class code. Leave out for every class.' },
      },
      required: ['threshold'], additionalProperties: false,
    },
    async run({ threshold, class_code: cc }) {
      const params = [threshold]; let where = '';
      if (cc) { params.push(cc); where = 'and lower(c.code) = lower($2)'; }
      const { rows } = await q(
        `select st.student_code as code, st.name, c.code as class_code,
                count(*) filter (where rec.status in ('present', 'late'))::int as attended, count(*)::int as marks
         from attendance_records rec join attendance_sessions a on a.id = rec.session_id
         join students st on st.id = rec.student_id left join courses c on c.id = st.course_id
         where a.status = 'submitted' and st.status = 'Active' ${where}
         group by st.id, st.student_code, st.name, c.code
         having count(*) > 0 and 100.0 * count(*) filter (where rec.status in ('present', 'late')) / count(*) < $1`, params,
      );
      const list = rows.map((x) => ({ code: x.code, first_name: firstName(x.name), class_code: x.class_code, percent: pct(x.attended, x.marks) }))
        .sort((a, b) => a.percent - b.percent || a.code.localeCompare(b.code));
      return { label: `Students below ${threshold}% attendance${cc ? ` in ${cc}` : ''}`, threshold, count: list.length, lowest: list.slice(0, 10) };
    },
  },
  fee_dues: {
    area: 'fees', module: 'fees',
    description: 'Fees still to be paid: total outstanding, overdue (past the due date), how many students, and overdue by class.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    async run() {
      const { rows: [t] } = await q(
        `select coalesce(sum(${OPEN}), 0)::float8 as outstanding,
                coalesce(sum(${OPEN}) filter (where i.due_date < current_date), 0)::float8 as overdue,
                count(distinct i.student_id)::int as students_with_dues,
                count(distinct i.student_id) filter (where i.due_date < current_date)::int as students_overdue
         from student_fee_items i where i.status in ('unpaid', 'partial')`,
      );
      const { rows: byClass } = await q(
        `select coalesce(c.code, '-') as class_code, coalesce(sum(${OPEN}) filter (where i.due_date < current_date), 0)::float8 as overdue,
                count(distinct i.student_id) filter (where i.due_date < current_date)::int as students_overdue
         from student_fee_items i join students s on s.id = i.student_id left join courses c on c.id = s.course_id
         where i.status in ('unpaid', 'partial') group by c.code order by 2 desc`,
      );
      return { label: 'Fee dues today (amounts in rupees)', ...t, by_class: byClass };
    },
  },
  fee_collections: {
    area: 'fees', module: 'fees',
    description: 'Fees collected over a period: total in rupees, number of receipts, and by payment method.',
    parameters: { type: 'object', properties: { period }, required: ['period'], additionalProperties: false },
    async run({ period: p }) {
      const r = periodRange(p);
      const { rows } = await q(
        `select method, count(*)::int as receipts, sum(amount)::float8 as amount
         from payments where paid_at >= $1::date and paid_at < $2::date + 1 group by method order by 3 desc`, [r.from, r.to],
      );
      const total = Math.round(rows.reduce((s, x) => s + x.amount, 0) * 100) / 100;
      return { label: `Fees collected, ${PERIOD_LABEL[p].toLowerCase()} (${r.from} to ${r.to}, rupees)`, from: r.from, to: r.to, total, receipts: rows.reduce((s, x) => s + x.receipts, 0), by_method: rows };
    },
  },
  student_counts: {
    area: 'students', module: 'students',
    description: 'How many students there are: active students per class, and totals by status.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    async run() {
      const { rows: byClass } = await q(
        `select coalesce(c.code, '-') as class_code, count(*)::int as active
         from students s left join courses c on c.id = s.course_id where s.status = 'Active' group by c.code order by c.code`,
      );
      const { rows: byStatus } = await q('select status, count(*)::int as students from students group by status order by status');
      return { label: 'Students', by_class: byClass, by_status: byStatus };
    },
  },
  admissions_summary: {
    area: 'admissions', module: 'admissions',
    description: 'Applications by stage (draft, submitted, documents pending, accepted, waitlisted, rejected, enrolled).',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    async run() {
      const { rows } = await q('select status, count(*)::int as applications from applications group by status order by status');
      return { label: 'Applications by stage', by_stage: rows, total: rows.reduce((s, x) => s + x.applications, 0) };
    },
  },
  staff_on_leave: {
    area: 'leave', module: 'leave',
    description: 'Staff on approved leave over a period (staff code and first name).',
    parameters: { type: 'object', properties: { period: { type: 'string', enum: ['today', 'this_week', 'last_7_days'] } }, required: ['period'], additionalProperties: false },
    async run({ period: p }) {
      const r = periodRange(p);
      const { rows } = await q(
        `select distinct e.emp_code as code, e.name from leave_requests l join employees e on e.id = l.employee_id
         where l.status = 'approved' and l.from_date <= $2 and l.to_date >= $1 order by e.emp_code`, [r.from, r.to],
      );
      return { label: `Staff on leave, ${PERIOD_LABEL[p].toLowerCase()}`, count: rows.length, staff: rows.map((x) => ({ code: x.code, first_name: firstName(x.name) })) };
    },
  },
  waiting_for_decision: {
    area: 'approvals', module: null,
    description: 'How many items wait for the office: leave requests, certificate requests, submitted applications, open help-desk tickets, and assistant proposals.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    async run(args, ctx) {
      const counts = await approvalCounts(ctx.tenant?.modules || []);
      const { rows: [p] } = await q("select count(*)::int as n from agent_proposals where status = 'pending'");
      return { label: 'Waiting for a decision', ...counts, assistant_proposals: p.n };
    },
  },
  exams_status: {
    area: 'exams', module: 'exams',
    description: 'Exams by status (draft or published) and how many exam papers still wait for marks.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    async run() {
      const { rows: [r] } = await q(
        `select (select count(*) from exams where status = 'draft')::int as exams_draft,
                (select count(*) from exams where status = 'published')::int as exams_published,
                (select count(*) from exam_papers p join exams x on x.id = p.exam_id where x.status = 'draft' and p.marks_status = 'draft')::int as papers_waiting_for_marks`,
      );
      return { label: 'Exams', ...r };
    },
  },
};

/* ---------------- permission check ---------------- */

/** Does this person's office role cover an area? The institute admin covers all; staff need the area for the whole institute. */
export function hasArea(ctx, area) {
  if (ctx.office?.full) return true;
  return ctx.office?.areas?.[area]?.scope === 'all';
}

export function toolAllowed(ctx, name) {
  const t = TOOLS[name];
  if (!t) return false;
  if (t.module && !ctx.tenant?.modules?.includes(t.module)) return false;
  return hasArea(ctx, t.area);
}

/** The tool list in the chat-completions format, only with the tools this person may use. */
export function toolSpecs(ctx, names) {
  return names.filter((n) => toolAllowed(ctx, n)).map((n) => ({
    type: 'function',
    function: { name: n, description: TOOLS[n].description, parameters: TOOLS[n].parameters },
  }));
}

/**
 * Runs one tool for a model's request. Never throws for a bad request from the model: it answers
 * { error } so the model can correct itself, and the run log records it.
 */
export async function runTool(ctx, allowed, name, rawArgs) {
  if (!allowed.includes(name) || !TOOLS[name]) return { ok: false, result: { error: `No tool called ${String(name).slice(0, 40)}.` } };
  if (!toolAllowed(ctx, name)) return { ok: false, result: { error: 'Your role does not cover this information.' } };
  let args;
  try {
    const parsed = typeof rawArgs === 'string' ? JSON.parse(rawArgs || '{}') : (rawArgs || {});
    args = checkArgs(TOOLS[name].parameters, parsed);
  } catch (err) {
    return { ok: false, result: { error: `Wrong input: ${err.message}.` } };
  }
  try {
    return { ok: true, args, result: await TOOLS[name].run(args, ctx) };
  } catch (err) {
    if (err instanceof HttpError) return { ok: false, args, result: { error: err.message } };
    throw err;
  }
}

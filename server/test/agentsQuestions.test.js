/**
 * Ask PlanetU: the fixed set of 20 questions. Each question goes through the real route, tool layer and SQL;
 * a stub model picks the tool (as a real model would) and words the answer from the result. Every figure is then
 * checked against the database with a separate query, and the wording must be grounded in those figures.
 * The real model API is never called.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { env } from '../src/config/env.js';
import { createApp } from '../src/app.js';
import { closePool, q, withTx } from '../src/db/pool.js';
import { issueCaptchaToken } from '../src/services/captcha.service.js';
import { useStubModel } from '../agents/llm.js';
import { periodRange } from '../agents/tools.js';

process.env.AGENT_DAILY_TOKENS = '100000000';
process.env.AGENT_RUNS_PER_MINUTE = '1000';

let server; let base; let principal; let tenantId; let classCode;
const db = (sql, params = []) => withTx({ tenantId }, async () => (await q(sql, params)).rows);
const r2 = (n) => Math.round(Number(n) * 100) / 100;

before(async () => {
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tenantCode: 'demo-college', role: 'employee', identifier: 'EMP007', password: 'Employee@123', captchaToken: issueCaptchaToken() }) });
  principal = r.headers.getSetCookie().map((c) => c.split(';')[0]).find((c) => c.startsWith(`${env.COOKIE_NAME}=`));
  tenantId = (await withTx({ platform: true }, () => q("select id from tenants where code = 'demo-college'"))).rows[0].id;
  classCode = (await db("select code from courses where code = 'BCA-B'"))[0].code;
});
after(async () => { useStubModel(null); server.close(); await closePool(); });

/* ---------------- the truth, by separate SQL ---------------- */

const attendanceTruth = async (period) => {
  const { from, to } = periodRange(period);
  return (await db(
    `select c.code, round(100.0 * sum(case when rec.status in ('present', 'late') then 1 else 0 end) / count(*), 1)::float8 as pct
     from attendance_sessions a join attendance_records rec on rec.session_id = a.id join courses c on c.id = a.course_id
     where a.status = 'submitted' and a.on_date >= $1 and a.on_date <= $2 group by c.code`, [from, to],
  )).map((x) => [x.code, x.pct]).sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]));
};
const belowTruth = async (t, code) => (await db(
  `select count(*)::int as n from (
     select s.id from students s join attendance_records rec on rec.student_id = s.id join attendance_sessions a on a.id = rec.session_id
     left join courses c on c.id = s.course_id
     where a.status = 'submitted' and s.status = 'Active' and ($2::text is null or c.code = $2)
     group by s.id having sum(case when rec.status in ('present', 'late') then 1 else 0 end) * 100.0 / count(*) < $1) x`, [t, code ?? null],
))[0].n;
const OPEN_ITEMS = `from student_fee_items i left join (select fee_item_id, sum(amount) as paid from payment_allocations group by fee_item_id) p on p.fee_item_id = i.id
  where i.status in ('unpaid', 'partial')`;
const collectedTruth = async (period) => {
  const { from, to } = periodRange(period);
  const [x] = await db("select coalesce(sum(amount), 0)::float8 as total, count(*)::int as receipts from payments where paid_at >= $1::date and paid_at < $2::date + 1", [from, to]);
  return [r2(x.total), x.receipts];
};

/* ---------------- the 20 questions ---------------- */

const fig = (body) => body.figures[0];
const QUESTIONS = [
  ['Which classes had the lowest attendance this week?', 'attendance_by_class', { period: 'this_week' }, (f) => f.classes.map((c) => [c.class_code, c.percent]), () => attendanceTruth('this_week')],
  ['How was attendance yesterday, class by class?', 'attendance_by_class', { period: 'yesterday' }, (f) => f.classes.map((c) => [c.class_code, c.percent]), () => attendanceTruth('yesterday')],
  ['Which class had the lowest attendance last week?', 'attendance_by_class', { period: 'last_week' }, (f) => f.classes.map((c) => [c.class_code, c.percent]), () => attendanceTruth('last_week')],
  ['Attendance by class over the last 7 days?', 'attendance_by_class', { period: 'last_7_days' }, (f) => f.classes.map((c) => [c.class_code, c.percent]), () => attendanceTruth('last_7_days')],
  ['What is attendance by class this month?', 'attendance_by_class', { period: 'this_month' }, (f) => f.classes.map((c) => [c.class_code, c.percent]), () => attendanceTruth('this_month')],
  ['How many students are below 75% attendance?', 'students_below_attendance', { threshold: 75 }, (f) => f.count, () => belowTruth(75)],
  ['How many students are below 60% attendance?', 'students_below_attendance', { threshold: 60 }, (f) => f.count, () => belowTruth(60)],
  ['How many students in BCA-B are below 75%?', 'students_below_attendance', { threshold: 75, class_code: 'BCA-B' }, (f) => f.count, () => belowTruth(75, classCode)],
  ['How much fee is overdue?', 'fee_dues', {}, (f) => r2(f.overdue), async () => r2((await db(`select coalesce(sum(i.amount - coalesce(p.paid, 0)), 0)::float8 as n ${OPEN_ITEMS} and i.due_date < current_date`))[0].n)],
  ['How many students have overdue fees?', 'fee_dues', {}, (f) => f.students_overdue, async () => (await db(`select count(distinct i.student_id)::int as n ${OPEN_ITEMS} and i.due_date < current_date`))[0].n],
  ['How much fee is still to be collected in all?', 'fee_dues', {}, (f) => r2(f.outstanding), async () => r2((await db(`select coalesce(sum(i.amount - coalesce(p.paid, 0)), 0)::float8 as n ${OPEN_ITEMS}`))[0].n)],
  ['Which class owes the most overdue fees?', 'fee_dues', {}, (f) => r2(f.by_class[0]?.overdue ?? 0), async () => r2((await db(`select coalesce(max(x.o), 0)::float8 as n from (select s.course_id, sum(i.amount - coalesce(p.paid, 0)) filter (where i.due_date < current_date) as o ${OPEN_ITEMS.replace('from student_fee_items i', 'from student_fee_items i join students s on s.id = i.student_id')} group by s.course_id) x`))[0].n)],
  ['How much was collected today?', 'fee_collections', { period: 'today' }, (f) => [r2(f.total), f.receipts], () => collectedTruth('today')],
  ['How much was collected this month?', 'fee_collections', { period: 'this_month' }, (f) => [r2(f.total), f.receipts], () => collectedTruth('this_month')],
  ['How much did we collect last week, and how many receipts?', 'fee_collections', { period: 'last_week' }, (f) => [r2(f.total), f.receipts], () => collectedTruth('last_week')],
  ['How many active students are there?', 'student_counts', {}, (f) => f.by_class.reduce((s, c) => s + c.active, 0), async () => (await db("select count(*)::int as n from students where status = 'Active'"))[0].n],
  ['How many students are in BCA-B?', 'student_counts', {}, (f) => f.by_class.find((c) => c.class_code === 'BCA-B')?.active ?? 0, async () => (await db("select count(*)::int as n from students s join courses c on c.id = s.course_id where s.status = 'Active' and c.code = 'BCA-B'"))[0].n],
  ['How many applications are there at each stage?', 'admissions_summary', {}, (f) => [f.total, ...f.by_stage.map((x) => `${x.status}:${x.applications}`)], async () => { const rows = await db('select status, count(*)::int as n from applications group by status order by status'); return [rows.reduce((s, x) => s + x.n, 0), ...rows.map((x) => `${x.status}:${x.n}`)]; }],
  ['Who is on leave today?', 'staff_on_leave', { period: 'today' }, (f) => f.staff.map((s) => s.code), async () => (await db("select distinct e.emp_code from leave_requests l join employees e on e.id = l.employee_id where l.status = 'approved' and l.from_date <= current_date and l.to_date >= current_date order by 1")).map((x) => x.emp_code)],
  ['How many exam papers are still waiting for marks?', 'exams_status', {}, (f) => [f.exams_draft, f.exams_published, f.papers_waiting_for_marks], async () => { const [x] = await db("select (select count(*) from exams where status = 'draft')::int as d, (select count(*) from exams where status = 'published')::int as p, (select count(*) from exam_papers ep join exams e on e.id = ep.exam_id where e.status = 'draft' and ep.marks_status = 'draft')::int as w"); return [x.d, x.p, x.w]; }],
];

/** Words the answer from the figure the stub would see, as a careful model would. */
function wording(value) {
  const flat = [value].flat(2).filter((v) => typeof v === 'number');
  return flat.length ? `The figure is ${flat[0]}.` : 'Here are the figures.';
}

describe('Ask PlanetU: 20 fixed questions, answers checked against the database', () => {
  it('has twenty questions', () => assert.equal(QUESTIONS.length, 20));
  for (const [question, tool, args, pick, truth] of QUESTIONS) {
    it(question, async () => {
      let step = 0;
      useStubModel(async (req) => {
        step += 1;
        if (step === 1) {
          assert.ok(req.tools.some((t) => t.function.name === tool), `${tool} is offered to the principal`);
          return { content: null, tool_calls: [{ id: 't1', type: 'function', function: { name: tool, arguments: JSON.stringify(args) } }] };
        }
        return { content: wording(pick(JSON.parse(req.messages.at(-1).content))) };
      });
      const r = await fetch(`${base}/api/assistants/ask`, { method: 'POST', headers: { cookie: principal, 'content-type': 'application/json' }, body: JSON.stringify({ question }) });
      const body = await r.json();
      assert.equal(r.status, 200, JSON.stringify(body));
      assert.equal(fig(body).tool, tool);
      assert.deepEqual(fig(body).args, args);
      assert.deepEqual(pick(fig(body)), await truth(), 'the figures shown match the database');
      assert.equal(body.grounded, true, `the wording uses only the figures: ${body.answer}`);
    });
  }
});

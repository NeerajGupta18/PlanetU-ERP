import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { env } from "../src/config/env.js";
import { createApp } from "../src/app.js";
import { closePool, q, withTx } from "../src/db/pool.js";
import { issueCaptchaToken } from "../src/services/captcha.service.js";

let server; let base; let tenantId;
const json = async (method, path, { cookie, body } = {}) => {
  const r = await fetch(`${base}${path}`, { method, headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let b = null; try { b = await r.json(); } catch { /* empty or not json */ }
  return { status: r.status, body: b, headers: r.headers };
};
async function login(tenantCode, role, identifier, password) {
  const r = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tenantCode, role, identifier, password, captchaToken: issueCaptchaToken() }) });
  assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
  return r.headers.getSetCookie().map((c) => c.split(";")[0]).find((c) => c.startsWith(`${env.COOKIE_NAME}=`));
}
const start = async () => {
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  tenantId = (await withTx({ platform: true }, () => q("select id from tenants where code = 'demo-college'"))).rows[0].id;
};
const stop = async () => { await new Promise((r) => server.close(r)); await closePool(); };

import { toISO } from "../src/utils/dates.js";

let admin; let schoolAdmin; let emp1; let emp2; let studentCk; let ids = {}; let orig = [];
const A = '/api/admin/payroll';
const ym = (back) => toISO(new Date(new Date().getFullYear(), new Date().getMonth() - back, 1)).slice(0, 7);
const M2 = ym(2); const M3 = ym(3);
const cleanup = async () => withTx({ tenantId }, async () => {
  await q('delete from payroll_runs where month = any($1)', [[M2, M3]]);
  await q("delete from leave_requests where reason like 'PT %'");
  await q("delete from notifications where template = 'payslipReady'");
  await q('delete from employee_salaries where employee_id = any($1)', [Object.values(ids)]);
  for (const o of orig) {
    await q('insert into employee_salaries (employee_id, basic, hra, allowances, pf_percent, other_deductions) values ($1, $2, $3, $4, $5, $6)', [o.employee_id, o.basic, o.hra, o.allowances, o.pf_percent, o.other_deductions]);
  }
});
const daysInMonth = (m) => new Date(Number(m.slice(0, 4)), Number(m.slice(5)), 0).getDate();
async function workingBetween(from, to) {
  const hol = (await withTx({ tenantId }, () => q("select start_date::text s, end_date::text e from events where type = 'holiday'"))).rows;
  let n = 0;
  for (let d = new Date(from); d <= new Date(to); d.setDate(d.getDate() + 1)) {
    const iso = d.toISOString().slice(0, 10);
    if (new Date(`${iso}T12:00:00`).getDay() !== 0 && !hol.some((h) => h.s <= iso && iso <= h.e)) n += 1;
  }
  return n;
}

before(async () => {
  await start();
  admin = await login('demo-college', 'admin', 'ADM001', 'Admin@123');
  schoolAdmin = await login('demo-school', 'admin', 'ADM001', 'Admin@123');
  emp1 = await login('demo-college', 'employee', 'EMP001', 'Employee@123');
  emp2 = await login('demo-college', 'employee', 'EMP002', 'Employee@123');
  studentCk = await login('demo-college', 'student', 'STU2026001', 'Student@123');
  const rows = (await withTx({ tenantId }, () => q("select id, emp_code from employees where emp_code in ('EMP001','EMP002')"))).rows;
  for (const r of rows) ids[r.emp_code] = r.id;
  orig = (await withTx({ tenantId }, () => q('select * from employee_salaries where employee_id = any($1)', [Object.values(ids)]))).rows;
  await cleanup();
  await withTx({ tenantId }, () => q('delete from employee_salaries where employee_id = any($1)', [Object.values(ids)]));
});
after(async () => { await cleanup(); await stop(); });

let run;

describe('Salaries', () => {
  it('lists every employee, with or without a salary', async () => {
    const r = await json('GET', `${A}/salaries`, { cookie: admin });
    assert.equal(r.status, 200);
    const e = r.body.employees.find((x) => x.empCode === 'EMP001');
    assert.equal(e.hasSalary, false); assert.equal(e.gross, null);
  });

  it('rejects bad amounts and deductions larger than the gross', async () => {
    const put = (body) => json('PUT', `${A}/salaries/${ids.EMP001}`, { cookie: admin, body });
    assert.equal((await put({})).status, 400);
    assert.equal((await put({ basic: -5 })).status, 400);
    assert.equal((await put({ basic: 1000, pfPercent: 150 })).status, 400);
    assert.equal((await put({ basic: 1000, otherDeductions: 5000 })).status, 400);
    assert.equal((await json('PUT', `${A}/salaries/11111111-1111-4111-8111-111111111111`, { cookie: admin, body: { basic: 1000 } })).status, 404);
  });

  it('saves a salary and shows the gross', async () => {
    const a = await json('PUT', `${A}/salaries/${ids.EMP001}`, { cookie: admin, body: { basic: 20000, hra: 8000, allowances: 2000, pfPercent: 12, otherDeductions: 500 } });
    assert.equal(a.status, 200); assert.equal(a.body.salary.gross, 30000);
    const b = await json('PUT', `${A}/salaries/${ids.EMP002}`, { cookie: admin, body: { basic: 31000, hra: 0, allowances: 0, pfPercent: 0, otherDeductions: 0 } });
    assert.equal(b.body.salary.gross, 31000);
  });
});

describe('Monthly run', () => {
  it('refuses a month that has not started, and a malformed month', async () => {
    assert.equal((await json('POST', `${A}/runs`, { cookie: admin, body: { month: ym(-2) } })).status, 400);
    assert.equal((await json('POST', `${A}/runs`, { cookie: admin, body: { month: '2026-13' } })).status, 400);
  });

  it('makes payslips with PF and other deductions worked out', async () => {
    const r = await json('POST', `${A}/runs`, { cookie: admin, body: { month: M2 } });
    assert.equal(r.status, 201);
    run = r.body.run.id;
    const s = r.body.payslips.find((x) => x.empCode === 'EMP001');
    assert.equal(s.gross, 30000); assert.equal(s.pf, 2400); assert.equal(s.otherDeductions, 500);
    assert.equal(s.unpaidDays, 0); assert.equal(s.net, 27100);
  });

  it('deducts approved leave without pay, and nothing for paid leave', async () => {
    const [from, to] = [`${M2}-10`, `${M2}-13`];
    const lwp = (await withTx({ tenantId }, () => q("select id from leave_types where name = 'Leave without pay'"))).rows[0].id;
    const casual = (await withTx({ tenantId }, () => q("select id from leave_types where name = 'Casual leave'"))).rows[0].id;
    await withTx({ tenantId }, async () => {
      await q("insert into leave_requests (employee_id, leave_type_id, from_date, to_date, days, reason, status) values ($1, $2, $3, $4, 3, 'PT unpaid', 'approved')", [ids.EMP002, lwp, from, to]);
      await q("insert into leave_requests (employee_id, leave_type_id, from_date, to_date, days, reason, status) values ($1, $2, $3, $3, 1, 'PT paid', 'approved')", [ids.EMP002, casual, `${M2}-20`]);
      await q("insert into leave_requests (employee_id, leave_type_id, from_date, to_date, days, reason, status) values ($1, $2, $3, $4, 2, 'PT pending', 'pending')", [ids.EMP002, lwp, `${M2}-24`, `${M2}-25`]);
    });
    const r = await json('POST', `${A}/runs`, { cookie: admin, body: { month: M2 } }); // a draft can be made again
    assert.equal(r.status, 201);
    const s = r.body.payslips.find((x) => x.empCode === 'EMP002');
    const expectDays = await workingBetween(from, to);
    assert.equal(s.unpaidDays, expectDays);
    const expectAmt = Math.round((31000 / daysInMonth(M2)) * expectDays * 100) / 100;
    assert.equal(s.unpaidAmount, expectAmt);
    assert.equal(s.net, Math.round((31000 - expectAmt) * 100) / 100);
    assert.equal(r.body.payslips.filter((x) => x.empCode === 'EMP001').length, 1);
    run = r.body.run.id;
  });

  it('only counts the part of a leave that falls in the month', async () => {
    await withTx({ tenantId }, async () => {
      const lwp = (await q("select id from leave_types where name = 'Leave without pay'")).rows[0].id;
      const prevLast = toISO(new Date(Number(M2.slice(0, 4)), Number(M2.slice(5)) - 1, 0));
      await q("insert into leave_requests (employee_id, leave_type_id, from_date, to_date, days, reason, status) values ($1, $2, $3, $4, 5, 'PT edge', 'approved')", [ids.EMP001, lwp, prevLast, `${M2}-02`]);
    });
    const r = await json('POST', `${A}/runs`, { cookie: admin, body: { month: M2 } });
    const s = r.body.payslips.find((x) => x.empCode === 'EMP001');
    assert.equal(s.unpaidDays, await workingBetween(`${M2}-01`, `${M2}-02`));
    run = r.body.run.id;
  });

  it('leaves out someone who joined after the month ended', async () => {
    await withTx({ tenantId }, () => q("update employees set join_date = current_date where id = $1", [ids.EMP002]));
    try {
      const r = await json('POST', `${A}/runs`, { cookie: admin, body: { month: M2 } });
      assert.equal(r.status, 201);
      assert.ok(!r.body.payslips.some((x) => x.empCode === 'EMP002'));
      run = r.body.run.id;
    } finally {
      await withTx({ tenantId }, () => q("update employees set join_date = '2023-07-01' where id = $1", [ids.EMP002]));
    }
    run = (await json('POST', `${A}/runs`, { cookie: admin, body: { month: M2 } })).body.run.id;
  });

  it('keeps old payslips as they were when a salary changes later, until the month is made again', async () => {
    await json('PUT', `${A}/salaries/${ids.EMP001}`, { cookie: admin, body: { basic: 99000 } });
    const got = await json('GET', `${A}/runs/${run}`, { cookie: admin });
    assert.equal(got.body.payslips.find((x) => x.empCode === 'EMP001').basic, 20000);
    await json('PUT', `${A}/salaries/${ids.EMP001}`, { cookie: admin, body: { basic: 20000, hra: 8000, allowances: 2000, pfPercent: 12, otherDeductions: 500 } });
  });
});

describe('Finalising and payslips', () => {
  it('employees see nothing until the month is finalised', async () => {
    const r = await json('GET', '/api/employee/payslips', { cookie: emp1 });
    assert.equal(r.status, 200); assert.ok(!r.body.payslips.some((p) => p.month === M2));
    const slip = (await json('GET', `${A}/runs/${run}`, { cookie: admin })).body.payslips.find((x) => x.empCode === 'EMP001');
    assert.equal((await json('GET', `/api/employee/payslips/${slip.id}/pdf`, { cookie: emp1 })).status, 404);
  });

  it('finalises, emails the staff, and locks the month', async () => {
    const f = await json('POST', `${A}/runs/${run}/finalise`, { cookie: admin });
    assert.equal(f.status, 200); assert.equal(f.body.run.status, 'finalised');
    const n = (await withTx({ tenantId }, () => q("select count(*)::int n from notifications where template = 'payslipReady'"))).rows[0].n;
    assert.ok(n >= 2);
    assert.equal((await json('POST', `${A}/runs/${run}/finalise`, { cookie: admin })).status, 409);
    assert.equal((await json('POST', `${A}/runs`, { cookie: admin, body: { month: M2 } })).status, 409);
    assert.equal((await json('DELETE', `${A}/runs/${run}`, { cookie: admin })).status, 409);
  });

  it('an employee sees only their own payslip and can download it as a PDF', async () => {
    const mine = (await json('GET', '/api/employee/payslips', { cookie: emp1 })).body.payslips.filter((p) => p.month === M2);
    assert.equal(mine.length, 1); assert.equal(mine[0].empCode, 'EMP001');
    const pdf = await fetch(`${base}/api/employee/payslips/${mine[0].id}/pdf`, { headers: { cookie: emp1 } });
    assert.equal(pdf.status, 200); assert.match(pdf.headers.get('content-type'), /pdf/);
    assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');
    const other = await json('GET', `/api/employee/payslips/${mine[0].id}/pdf`, { cookie: emp2 });
    assert.equal(other.status, 404);
  });

  it('students cannot reach payroll, and the office can download any payslip', async () => {
    assert.equal((await json('GET', '/api/employee/payslips', { cookie: studentCk })).status, 403);
    assert.equal((await json('GET', `${A}/runs`, { cookie: emp1 })).status, 403);
    const slip = (await json('GET', `${A}/runs/${run}`, { cookie: admin })).body.payslips[0];
    const pdf = await fetch(`${base}${A}/payslips/${slip.id}/pdf`, { headers: { cookie: admin } });
    assert.equal(pdf.status, 200);
  });

  it('a draft can be deleted, and another institute cannot see any of it', async () => {
    const d = await json('POST', `${A}/runs`, { cookie: admin, body: { month: M3 } });
    assert.equal(d.status, 201);
    assert.equal((await json('GET', `${A}/runs/${d.body.run.id}`, { cookie: schoolAdmin })).status, 404);
    assert.equal((await json('DELETE', `${A}/runs/${d.body.run.id}`, { cookie: admin })).status, 200);
    const list = await json('GET', `${A}/runs`, { cookie: schoolAdmin });
    assert.ok(!list.body.runs.some((r) => r.month === M2));
  });
});

/** Leave management (Phase 3) - run with `npm test` (needs `npm run db:setup` first). */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { env } from '../src/config/env.js';
import { createApp } from '../src/app.js';
import { closePool, q, withTx } from '../src/db/pool.js';
import { issueCaptchaToken } from '../src/services/captcha.service.js';
import { addDays, toISO } from '../src/utils/dates.js';

let server; let base; let tenantId; let admin; let emp; let emp2; let student; let schoolAdmin; let empId; let typeIds = {};

const json = async (method, path, { cookie, body } = {}) => {
  const r = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let b = null; try { b = await r.json(); } catch { /* empty */ }
  return { status: r.status, body: b };
};
async function login(tenantCode, role, identifier, password) {
  const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tenantCode, role, identifier, password, captchaToken: issueCaptchaToken() }) });
  assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
  return r.headers.getSetCookie().map((c) => c.split(';')[0]).find((c) => c.startsWith(`${env.COOKIE_NAME}=`));
}
const day = (n) => toISO(addDays(new Date(), n));
// the next date that is not a Sunday or a calendar holiday, `from` days ahead or later
async function workday(from) {
  for (let n = from; n < from + 30; n += 1) {
    const d = addDays(new Date(), n);
    if (d.getDay() === 0) continue;
    const { rowCount } = await withTx({ tenantId }, () => q("select 1 from events where type = 'holiday' and start_date <= $1 and end_date >= $1", [toISO(d)]));
    if (!rowCount) return toISO(d);
  }
  throw new Error('no working day found');
}
const NEXT = new Date().getFullYear() + 1; // allowances count per calendar year, so test them inside one year
async function workdayIn(year, afterDay) {
  for (let n = afterDay; n < afterDay + 40; n += 1) {
    const d = new Date(year, 2, 1 + n);
    if (d.getDay() === 0) continue;
    const { rowCount } = await withTx({ tenantId }, () => q("select 1 from events where type = 'holiday' and start_date <= $1 and end_date >= $1", [toISO(d)]));
    if (!rowCount) return toISO(d);
  }
  throw new Error('no working day found');
}
const apply = (cookie, body) => json('POST', '/api/employee/leave', { cookie, body });
const cleanup = async () => withTx({ tenantId }, async () => {
  await q("delete from leave_requests where reason like 'LT %'");
  await q("delete from leave_types where name like 'LT %'");
  await q("delete from notifications where template = 'leaveUpdate'");
});

before(async () => {
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  admin = await login('demo-college', 'admin', 'ADM001', 'Admin@123');
  emp = await login('demo-college', 'employee', 'EMP001', 'Employee@123');
  emp2 = await login('demo-college', 'employee', 'EMP002', 'Employee@123');
  student = await login('demo-college', 'student', 'STU2026001', 'Student@123');
  schoolAdmin = await login('demo-school', 'admin', 'ADM001', 'Admin@123');
  tenantId = (await withTx({ platform: true }, () => q("select id from tenants where code = 'demo-college'"))).rows[0].id;
  empId = (await withTx({ tenantId }, () => q("select id from employees where emp_code = 'EMP001'"))).rows[0].id;
  await cleanup();
  // a small, known allowance to test against
  const small = await json('POST', '/api/admin/leave/types', { cookie: admin, body: { name: 'LT Small', daysPerYear: 2 } });
  const free = await json('POST', '/api/admin/leave/types', { cookie: admin, body: { name: 'LT Unlimited', daysPerYear: '' } });
  typeIds = { small: small.body.type.id, free: free.body.type.id };
});
after(async () => {
  await cleanup();
  await new Promise((r) => server.close(r));
  await closePool();
});

describe('Leave types (office)', () => {
  it('lists the types with their allowance, and rejects duplicates and bad numbers', async () => {
    const r = await json('GET', '/api/admin/leave/types', { cookie: admin });
    assert.equal(r.status, 200);
    const small = r.body.types.find((t) => t.name === 'LT Small');
    assert.equal(small.daysPerYear, 2);
    assert.equal(r.body.types.find((t) => t.name === 'LT Unlimited').daysPerYear, null);
    assert.equal((await json('POST', '/api/admin/leave/types', { cookie: admin, body: { name: 'lt small', daysPerYear: 3 } })).status, 409);
    assert.equal((await json('POST', '/api/admin/leave/types', { cookie: admin, body: { name: 'LT Bad', daysPerYear: -1 } })).status, 400);
    assert.equal((await json('POST', '/api/admin/leave/types', { cookie: admin, body: { name: '  ' } })).status, 400);
  });
  it('a type that has been used cannot be deleted, an unused one can', async () => {
    const t = await json('POST', '/api/admin/leave/types', { cookie: admin, body: { name: 'LT Temp', daysPerYear: 1 } });
    assert.equal((await json('DELETE', `/api/admin/leave/types/${t.body.type.id}`, { cookie: admin })).status, 200);
    const d = await workday(40);
    assert.equal((await apply(emp, { typeId: typeIds.free, fromDate: d, reason: 'LT used' })).status, 201);
    const del = await json('DELETE', `/api/admin/leave/types/${typeIds.free}`, { cookie: admin });
    assert.equal(del.status, 409);
    assert.match(del.body.message, /Switch it off/);
    await withTx({ tenantId }, () => q("delete from leave_requests where reason = 'LT used'"));
  });
  it('the standard types can be added once without duplicating', async () => {
    const a = await json('POST', '/api/admin/leave/types/defaults', { cookie: admin });
    const b = await json('POST', '/api/admin/leave/types/defaults', { cookie: admin });
    assert.equal(a.status, 200);
    assert.equal(b.body.added, 0);
  });
  it('is closed to students, employees and other institutes', async () => {
    assert.equal((await json('GET', '/api/admin/leave', { cookie: student })).status, 403);
    assert.equal((await json('GET', '/api/admin/leave', { cookie: emp })).status, 403);
    assert.equal((await json('POST', '/api/employee/leave', { cookie: student, body: {} })).status, 403);
  });
});

describe('Applying for leave (employee)', () => {
  it('counts working days only: Sundays and calendar holidays are skipped', async () => {
    // find a Saturday..Monday window with the Sunday in the middle
    let sat = null;
    for (let n = 50; n < 120 && !sat; n += 1) if (addDays(new Date(), n).getDay() === 6) sat = n;
    const from = day(sat); const to = day(sat + 2);
    const hol = await withTx({ tenantId }, () => q("select count(*)::int as n from events where type = 'holiday' and start_date <= $2 and end_date >= $1", [from, to]));
    const r = await apply(emp, { typeId: typeIds.free, fromDate: from, toDate: to, reason: 'LT weekend' });
    assert.equal(r.status, 201);
    assert.equal(r.body.request.days, hol.rows[0].n ? 2 - Math.min(hol.rows[0].n, 2) : 2);
    assert.equal(r.body.request.status, 'pending');
    await json('POST', `/api/employee/leave/${r.body.request.id}/cancel`, { cookie: emp });
  });
  it('a Sunday-only request is refused', async () => {
    let sun = null;
    for (let n = 130; n < 200 && !sun; n += 1) if (addDays(new Date(), n).getDay() === 0) sun = n;
    const r = await apply(emp, { typeId: typeIds.free, fromDate: day(sun), reason: 'LT sunday' });
    assert.equal(r.status, 400);
    assert.match(r.body.message, /Sundays or holidays/);
  });
  it('checks dates, type and reason', async () => {
    const d = await workday(60);
    assert.equal((await apply(emp, { typeId: typeIds.free, fromDate: 'soon', reason: 'LT x' })).status, 400);
    assert.equal((await apply(emp, { typeId: typeIds.free, fromDate: d, toDate: day(-300), reason: 'LT x' })).status, 400);
    assert.equal((await apply(emp, { typeId: typeIds.free, fromDate: d })).status, 400, 'a reason is needed');
    assert.equal((await apply(emp, { typeId: '11111111-1111-4111-8111-111111111111', fromDate: d, reason: 'LT x' })).status, 400);
    assert.equal((await apply(emp, { typeId: typeIds.free, fromDate: day(-200), reason: 'LT x' })).status, 400, 'too long ago');
    assert.equal((await apply(emp, { typeId: typeIds.free, fromDate: d, toDate: day(70), halfDay: true, reason: 'LT x' })).status, 400, 'half day is one date');
  });
  it('stops at the yearly allowance and counts waiting requests', async () => {
    const d1 = await workdayIn(NEXT, 0); const d2 = await workdayIn(NEXT, 5); const d3 = await workdayIn(NEXT, 10);
    const first = await apply(emp, { typeId: typeIds.small, fromDate: d1, toDate: d1, reason: 'LT one' });
    assert.equal(first.status, 201);
    const second = await apply(emp, { typeId: typeIds.small, fromDate: d2, halfDay: true, reason: 'LT half' });
    assert.equal(second.status, 201);
    assert.equal(second.body.request.days, 0.5);
    const third = await apply(emp, { typeId: typeIds.small, fromDate: d3, toDate: d3, reason: 'LT three' });
    assert.equal(third.status, 409, 'one and a half used, so a whole day does not fit');
    assert.match(third.body.message, /only 0\.5 left/);
    const fourth = await apply(emp, { typeId: typeIds.small, fromDate: d3, halfDay: true, reason: 'LT four' });
    assert.equal(fourth.status, 201, 'a half day still fits');
    const fifth = await apply(emp, { typeId: typeIds.small, fromDate: await workdayIn(NEXT, 15), halfDay: true, reason: 'LT five' });
    assert.equal(fifth.status, 409);
    assert.match(fifth.body.message, /only 0 left/);
  });
  it('refuses overlapping dates', async () => {
    const d = await workday(100);
    assert.equal((await apply(emp, { typeId: typeIds.free, fromDate: d, reason: 'LT a' })).status, 201);
    const clash = await apply(emp, { typeId: typeIds.free, fromDate: d, reason: 'LT b' });
    assert.equal(clash.status, 409);
    assert.match(clash.body.message, /already have leave/);
  });
  it('shows the balance with waiting days and only my own requests', async () => {
    const mine = await json('GET', `/api/employee/leave?year=${NEXT}`, { cookie: emp });
    const bal = mine.body.balances.find((b) => b.name === 'LT Small');
    assert.equal(bal.allowance, 2);
    assert.equal(bal.pending, 2);
    assert.equal(bal.left, 0);
    assert.equal(mine.body.balances.find((b) => b.name === 'LT Unlimited').left, null);
    assert.ok(mine.body.requests.every((r) => r.employeeId === empId));
    const other = await json('GET', '/api/employee/leave', { cookie: emp2 });
    assert.equal(other.body.requests.filter((r) => r.reason?.startsWith('LT ')).length, 0);
  });
  it('can be cancelled while waiting, but not by someone else', async () => {
    const d = await workday(120);
    const r = await apply(emp, { typeId: typeIds.free, fromDate: d, reason: 'LT cancel me' });
    const notMine = await json('POST', `/api/employee/leave/${r.body.request.id}/cancel`, { cookie: emp2 });
    assert.equal(notMine.status, 404);
    const mine = await json('POST', `/api/employee/leave/${r.body.request.id}/cancel`, { cookie: emp });
    assert.equal(mine.body.request.status, 'cancelled');
    assert.equal((await json('POST', `/api/employee/leave/${r.body.request.id}/cancel`, { cookie: emp })).status, 409);
    // the dates are free again
    assert.equal((await apply(emp, { typeId: typeIds.free, fromDate: d, reason: 'LT again' })).status, 201);
  });
});

describe('Deciding (office)', () => {
  it('lists requests with counts and filters', async () => {
    const all = await json('GET', '/api/admin/leave?status=pending', { cookie: admin });
    assert.equal(all.status, 200);
    assert.ok(all.body.counts.pending >= 1);
    assert.ok(all.body.requests.every((r) => r.status === 'pending'));
    const q1 = await json('GET', '/api/admin/leave?search=EMP001', { cookie: admin });
    assert.ok(q1.body.requests.length >= 1 && q1.body.requests.every((r) => r.employeeCode === 'EMP001'));
  });
  it('approves, which moves the days from waiting to taken, and emails the employee', async () => {
    const list = (await json('GET', '/api/admin/leave?status=pending', { cookie: admin })).body.requests;
    const target = list.find((r) => r.reason === 'LT one');
    const r = await json('PUT', `/api/admin/leave/${target.id}`, { cookie: admin, body: { decision: 'approve' } });
    assert.equal(r.status, 200);
    assert.equal(r.body.request.status, 'approved');
    const bal = (await json('GET', `/api/employee/leave?year=${NEXT}`, { cookie: emp })).body.balances.find((b) => b.name === 'LT Small');
    assert.equal(bal.used, 1);
    assert.equal(bal.pending, 1);
    const mail = await withTx({ tenantId }, () => q("select count(*)::int as n from notifications where template = 'leaveUpdate'"));
    assert.ok(mail.rows[0].n >= 1);
    assert.equal((await json('PUT', `/api/admin/leave/${target.id}`, { cookie: admin, body: { decision: 'reject', remark: 'late' } })).status, 409, 'already decided');
  });
  it('rejecting needs a reason, and frees the days', async () => {
    const list = (await json('GET', '/api/admin/leave?status=pending', { cookie: admin })).body.requests;
    const target = list.find((r) => r.reason === 'LT half');
    assert.equal((await json('PUT', `/api/admin/leave/${target.id}`, { cookie: admin, body: { decision: 'reject' } })).status, 400);
    const r = await json('PUT', `/api/admin/leave/${target.id}`, { cookie: admin, body: { decision: 'reject', remark: 'Exams that day' } });
    assert.equal(r.body.request.status, 'rejected');
    assert.equal(r.body.request.remark, 'Exams that day');
    const bal = (await json('GET', `/api/employee/leave?year=${NEXT}`, { cookie: emp })).body.balances.find((b) => b.name === 'LT Small');
    assert.equal(bal.pending, 0.5, 'only the other half day is still waiting');
  });
  it('an unknown decision or request is refused', async () => {
    const list = (await json('GET', '/api/admin/leave?status=pending', { cookie: admin })).body.requests;
    assert.equal((await json('PUT', `/api/admin/leave/${list[0].id}`, { cookie: admin, body: { decision: 'maybe' } })).status, 400);
    assert.equal((await json('PUT', '/api/admin/leave/11111111-1111-4111-8111-111111111111', { cookie: admin, body: { decision: 'approve' } })).status, 404);
  });
  it('records leave for an employee directly, already approved', async () => {
    const d = await workday(140);
    const r = await json('POST', '/api/admin/leave', { cookie: admin, body: { employeeId: empId, typeId: typeIds.free, fromDate: d, reason: 'LT phone call' } });
    assert.equal(r.status, 201);
    assert.equal(r.body.request.status, 'approved');
    assert.equal(r.body.request.byOffice, true);
    const bad = await json('POST', '/api/admin/leave', { cookie: admin, body: { employeeId: '11111111-1111-4111-8111-111111111111', typeId: typeIds.free, fromDate: d } });
    assert.equal(bad.status, 404);
  });
  it('shows who is on leave today and each person\'s balance', async () => {
    const today = await workday(0);
    if (today === day(0)) {
      await json('POST', '/api/admin/leave', { cookie: admin, body: { employeeId: empId, typeId: typeIds.free, fromDate: today, reason: 'LT today' } });
      const r = await json('GET', '/api/admin/leave/on-leave', { cookie: admin });
      assert.ok(r.body.employees.some((e) => e.employeeId === empId));
    }
    const b = await json('GET', `/api/admin/leave/balances?year=${NEXT}`, { cookie: admin });
    assert.equal(b.status, 200);
    const row = b.body.employees.find((e) => e.code === 'EMP001');
    assert.equal(row.used[typeIds.small], 1);
    assert.ok(b.body.types.some((t) => t.name === 'LT Small'));
  });
  it('the dashboard counts what is waiting', async () => {
    const d = await json('GET', '/api/admin/dashboard', { cookie: admin });
    assert.ok(d.body.today.leavePending >= 1);
    assert.equal(typeof d.body.today.onLeaveToday, 'number');
  });
});

describe('Isolation', () => {
  it("another institute's admin sees none of it", async () => {
    const r = await json('GET', '/api/admin/leave', { cookie: schoolAdmin });
    assert.equal(r.status, 200);
    assert.ok(r.body.requests.every((x) => !x.reason.startsWith('LT ')));
    const t = await json('GET', '/api/admin/leave/types', { cookie: schoolAdmin });
    assert.ok(t.body.types.every((x) => !x.name.startsWith('LT ')));
    assert.equal((await json('PUT', `/api/admin/leave/types/${typeIds.small}`, { cookie: schoolAdmin, body: { name: 'hijack' } })).status, 404);
  });
});

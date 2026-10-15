/** Role dashboards (UI Phase 4): KPIs with comparisons, charts and office summaries - run with `npm test` (needs `npm run db:setup` first). */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { env } from '../src/config/env.js';
import { createApp } from '../src/app.js';
import { closePool, q, withTx } from '../src/db/pool.js';
import { issueCaptchaToken } from '../src/services/captcha.service.js';
import { feeMonths, attendanceWeeks } from '../src/services/kpi.service.js';

let server; let base;
const get = async (path, cookie) => {
  const r = await fetch(`${base}${path}`, { headers: { cookie } });
  let b = null; try { b = await r.json(); } catch { /* empty */ }
  return { status: r.status, body: b };
};
async function login(tenantCode, role, identifier, password) {
  const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tenantCode, role, identifier, password, captchaToken: issueCaptchaToken() }) });
  assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
  return r.headers.getSetCookie().map((c) => c.split(';')[0]).find((c) => c.startsWith(`${env.COOKIE_NAME}=`));
}
const emp = (code) => login('demo-college', 'employee', code, 'Employee@123');

let admin; let schoolAdmin; let teacher; let principal; let accountant; let librarian; let security; let hod; let student; let parent; let sa;
before(async () => {
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  admin = await login('demo-college', 'admin', 'ADM001', 'Admin@123');
  schoolAdmin = await login('demo-school', 'admin', 'ADM001', 'Admin@123');
  [teacher, principal, accountant, librarian, security, hod] = await Promise.all(['EMP001', 'EMP007', 'EMP008', 'EMP009', 'EMP010', 'EMP011'].map(emp));
  student = await login('demo-college', 'student', 'STU2026001', 'Student@123');
  parent = await login('demo-college', 'parent', 'PAR001', 'Parent@123');
  sa = await login('', 'super_admin', 'SA001', 'SuperAdmin@123');
});
after(async () => {
  await new Promise((r) => server.close(r));
  await closePool();
});

describe('admin dashboard KPIs', () => {
  it('compares attendance with last week and fees with last month, and has six months and six weeks of chart data', async () => {
    const { status, body } = await get('/api/admin/dashboard', admin);
    assert.equal(status, 200);
    const k = body.kpis;
    assert.equal(typeof k.approvals.approvals, 'number');
    assert.ok(k.attendance.today === null || (k.attendance.today >= 0 && k.attendance.today <= 100));
    assert.equal(k.attendance.weeks.length, 6);
    for (const w of k.attendance.weeks) assert.ok(w.pct === null || (w.pct >= 0 && w.pct <= 100));
    assert.equal(k.attendance.below.threshold, 75);
    assert.ok(k.attendance.below.students.every((s) => s.pct < 75));
    assert.equal(k.fees.months.length, 6);
    for (const key of ['collectedToday', 'thisMonth', 'lastMonthToDate', 'lastMonth', 'outstanding', 'overdue', 'studentsOverdue']) assert.equal(typeof k.fees[key], 'number', key);
    assert.ok(k.fees.overdue <= k.fees.outstanding);
    // The month buckets add up to what the payments table says for the same months
    assert.equal(k.fees.months[5].amount, k.fees.thisMonth);
    assert.equal(typeof k.visitors.inside, 'number');
  });

  it('puts a payment from two months ago in that month\'s bar', async () => {
    const tenantId = (await withTx({ platform: true }, () => q("select id from tenants where code = 'demo-college'"))).rows[0].id;
    const before = (await get('/api/admin/dashboard', admin)).body.kpis.fees.months;
    const now = new Date();
    const paidAt = new Date(now.getFullYear(), now.getMonth() - 2, 15, 12, 0).toISOString();
    const id = await withTx({ tenantId }, async () => {
      const { rows: [st] } = await q('select id from students order by student_code limit 1');
      const { rows: [p] } = await q("insert into payments (student_id, receipt_no, amount, method, paid_at) values ($1, 'KPI-TEST-1', 1234, 'cash', $2) returning id", [st.id, paidAt]);
      return p.id;
    });
    try {
      const afterM = (await get('/api/admin/dashboard', admin)).body.kpis.fees.months;
      assert.equal(afterM[3].amount - before[3].amount, 1234);
      assert.equal(afterM[5].amount, before[5].amount);
    } finally {
      await withTx({ tenantId }, () => q('delete from payments where id = $1', [id]));
    }
  });

  it('keeps each institute\'s figures to itself', async () => {
    const tenants = (await withTx({ platform: true }, () => q("select id, code from tenants where code in ('demo-college', 'demo-school')"))).rows;
    const today = new Date().toISOString().slice(0, 10);
    const sums = {};
    for (const t of tenants) sums[t.code] = await withTx({ tenantId: t.id }, () => feeMonths(today, 6));
    const a = (await get('/api/admin/dashboard', admin)).body.kpis.fees.months;
    const b = (await get('/api/admin/dashboard', schoolAdmin)).body.kpis.fees.months;
    assert.deepEqual(a.map((m) => m.amount), sums['demo-college'].map((m) => m.amount));
    assert.deepEqual(b.map((m) => m.amount), sums['demo-school'].map((m) => m.amount));
  });

  it('weeks run Monday to Sunday and end with the current week', async () => {
    const tenantId = (await withTx({ platform: true }, () => q("select id from tenants where code = 'demo-college'"))).rows[0].id;
    const weeks = await withTx({ tenantId }, () => attendanceWeeks('2026-10-15', 3));
    assert.deepEqual(weeks.map((w) => w.week), ['2026-09-28', '2026-10-05', '2026-10-12']);
  });
});

describe('office summary for staff roles', () => {
  it('the accountant sees fees and payroll cards', async () => {
    const { status, body } = await get('/api/employee/office-summary', accountant);
    assert.equal(status, 200);
    assert.equal(body.overview, false);
    assert.deepEqual(body.groups.map((g) => g.area), ['fees', 'payroll']);
    const fees = body.groups[0].cards;
    assert.ok(fees.find((c) => c.key === 'overdue').status);
    assert.ok(['Not started', 'Draft', 'Finalised'].includes(body.groups[1].cards[0].value));
  });

  it('the librarian sees only the library, with loans and overdue returns', async () => {
    const { body } = await get('/api/employee/office-summary', librarian);
    assert.deepEqual(body.groups.map((g) => g.area), ['library']);
    const cards = Object.fromEntries(body.groups[0].cards.map((c) => [c.key, c]));
    assert.ok(cards.out.value >= cards.overdue.value);
    assert.equal(cards.overdue.value > 0 ? cards.overdue.status : 'clear', cards.overdue.status);
  });

  it('gate security sees who is inside and who is expected', async () => {
    const { body } = await get('/api/employee/office-summary', security);
    assert.deepEqual(body.groups.map((g) => g.area), ['visitors']);
    assert.equal(typeof body.groups[0].cards.find((c) => c.key === 'inside').value, 'number');
  });

  it('a head of department sees only their department', async () => {
    const { body } = await get('/api/employee/office-summary', hod);
    assert.deepEqual(body.groups.map((g) => g.area), ['department']);
    const keys = body.groups[0].cards.map((c) => c.key);
    for (const k of ['att', 'below', 'leave', 'away']) assert.ok(keys.includes(k), k);
    assert.match(body.groups[0].title, /^Department/);
  });

  it('the principal is pointed to the institute overview; a plain teacher has no office cards', async () => {
    const p = (await get('/api/employee/office-summary', principal)).body;
    assert.equal(p.overview, true);
    assert.equal(typeof p.approvals, 'number');
    const t = (await get('/api/employee/office-summary', teacher)).body;
    assert.deepEqual(t, { overview: false, groups: [] });
  });

  it('is for employees only', async () => {
    assert.equal((await get('/api/employee/office-summary', student)).status, 403);
  });
});

describe('faculty, student and parent dashboards', () => {
  it('the faculty to-do list carries the KPI counts', async () => {
    const { body } = await get('/api/employee/todo', teacher);
    for (const k of ['lecturesToday', 'lecturesToMark', 'toGrade', 'papersPending', 'lowAttendance']) assert.equal(typeof body.counts[k], 'number', k);
    assert.ok(body.counts.lecturesToMark <= body.counts.lecturesToday);
  });

  it('the student dashboard says how many classes can be missed (or are needed) and what is due', async () => {
    const { body } = await get('/api/student/dashboard', student);
    const g = body.attendanceGuide;
    assert.equal(typeof g.canMiss, 'number');
    assert.ok(g.needToReach === null || typeof g.needToReach === 'number');
    if (body.stats.attendance >= body.attendanceThreshold) assert.equal(g.needToReach, 0); else assert.equal(g.canMiss, 0);
    assert.ok(body.assignmentsDue === null || body.assignmentsDue >= 0);
    assert.ok(body.nextExam === null || (body.nextExam.name && body.nextExam.date));
  });

  it('the parent sees each child\'s day, next fee and latest result', async () => {
    const { body } = await get('/api/parent/children', parent);
    assert.ok(body.children.length >= 1);
    for (const k of body.children) {
      assert.ok('today' in k && 'nextDue' in k && 'latestResult' in k && 'nextExam' in k);
      if (k.nextDue) { assert.ok(k.nextDue.amount > 0); assert.equal(typeof k.nextDue.overdue, 'boolean'); }
      if (k.today) assert.ok(k.today.absent <= k.today.marked);
    }
  });
});

describe('platform dashboard', () => {
  it('adds money, attention lists and institutes nobody signed in to', async () => {
    const { status, body } = await get('/api/super-admin/dashboard', sa);
    assert.equal(status, 200);
    assert.equal(typeof body.billing.mrr, 'number');
    assert.equal(typeof body.billing.collectedThisMonth, 'number');
    assert.ok(Array.isArray(body.billing.series));
    assert.ok(Array.isArray(body.billing.trialsEnding));
    assert.ok(Array.isArray(body.quiet));
    assert.equal(typeof body.stats.activeWeek, 'number');
    // Demo institutes are never listed as "quiet"
    assert.ok(!body.quiet.some((t) => String(t.code).startsWith('demo-')));
  });

  it('is closed to an institute admin', async () => {
    assert.equal((await get('/api/super-admin/dashboard', admin)).status, 403);
  });
});

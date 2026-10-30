/** Parent portal (Phase 3) - run with `npm test` (needs `npm run db:setup` first). */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { env } from '../src/config/env.js';
import { createApp } from '../src/app.js';
import { closePool, q, withTx } from '../src/db/pool.js';
import { issueCaptchaToken } from '../src/services/captcha.service.js';

let server; let base; let tenantId; let admin; let student; let schoolAdmin; let parent; let ids = {};

const json = async (method, path, { cookie, body } = {}) => {
  const r = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let b = null; try { b = await r.json(); } catch { /* empty */ }
  return { status: r.status, body: b, headers: r.headers };
};
async function loginRaw(tenantCode, role, identifier, password) {
  const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tenantCode, role, identifier, password, captchaToken: issueCaptchaToken() }) });
  return { status: r.status, cookie: r.headers.getSetCookie().map((c) => c.split(';')[0]).find((c) => c.startsWith(`${env.COOKIE_NAME}=`)) };
}
async function login(...a) { const r = await loginRaw(...a); assert.equal(r.status, 200); return r.cookie; }
const withChild = (cookie, childId) => `${cookie}; erp_child=${childId}`;
const cleanup = async () => withTx({ tenantId }, async () => {
  await q("delete from users where role = 'parent' and login_id not in ('PAR001', 'PAR002')");
  await q("delete from parent_links where student_id in (select id from students where student_code in ('STU2026003')) ");
  await q("delete from grievances where subject like 'PT %'");
  await q("delete from notifications where template in ('accountSetup', 'grievanceUpdate')");
  await q("update students set guardian = guardian - 'gtmark' where student_code in ('STU2026003')");
});
const setModules = (mods) => withTx({ platform: true }, () => q("update tenants set modules = $1 where code = 'demo-college'", [mods]));

before(async () => {
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  admin = await login('demo-college', 'admin', 'ADM001', 'Admin@123');
  student = await login('demo-college', 'student', 'STU2026001', 'Student@123');
  schoolAdmin = await login('demo-school', 'admin', 'ADM001', 'Admin@123');
  parent = await login('demo-college', 'parent', 'PAR001', 'Parent@123');
  tenantId = (await withTx({ platform: true }, () => q("select id from tenants where code = 'demo-college'"))).rows[0].id;
  const rows = (await withTx({ tenantId }, () => q("select id, student_code from students where student_code in ('STU2026001', 'STU2026002', 'STU2026003')"))).rows;
  ids = Object.fromEntries(rows.map((r) => [r.student_code, r.id]));
  await cleanup();
});
after(async () => {
  await cleanup();
  await new Promise((r) => server.close(r));
  await closePool();
});

describe('The parent signs in and picks a child', () => {
  it('lists the linked children with attendance and fees owing', async () => {
    const r = await json('GET', '/api/parent/children', { cookie: parent });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.children.map((c) => c.studentCode).sort(), ['STU2026001', 'STU2026002']);
    for (const c of r.body.children) {
      assert.equal(typeof c.attendance.overall, 'number');
      assert.equal(typeof c.outstanding, 'number');
      assert.ok(c.course);
    }
    assert.ok(ids.STU2026001 && r.body.children.some((c) => c.id === r.body.selected), 'one is selected by default');
  });
  it('shows the chosen child on every student page, and only a linked child can be chosen', async () => {
    const pick = await json('POST', '/api/parent/child', { cookie: parent, body: { childId: ids.STU2026002 } });
    assert.equal(pick.status, 200);
    assert.match(pick.headers.get('set-cookie'), /erp_child=/);
    const one = await json('GET', '/api/student/profile', { cookie: withChild(parent, ids.STU2026001) });
    const two = await json('GET', '/api/student/profile', { cookie: withChild(parent, ids.STU2026002) });
    assert.notEqual(JSON.stringify(one.body).includes('STU2026001'), JSON.stringify(two.body).includes('STU2026001'));
    assert.ok(JSON.stringify(two.body).includes('STU2026002'));
    assert.equal((await json('POST', '/api/parent/child', { cookie: parent, body: { childId: ids.STU2026003 } })).status, 404, 'not linked to this parent');
    assert.equal((await json('POST', '/api/parent/child', { cookie: parent, body: {} })).status, 404);
  });
  it('a tampered cookie never reaches a student who is not linked', async () => {
    const r = await json('GET', '/api/student/profile', { cookie: withChild(parent, ids.STU2026003) });
    assert.equal(r.status, 403, 'refused outright, not quietly swapped for another child');
    assert.equal(JSON.stringify(r.body).includes('STU2026003'), false);
    assert.match(r.headers.get('set-cookie'), /erp_child=;/, 'and the wrong choice is forgotten');
    const next = await json('GET', '/api/student/profile', { cookie: parent });
    assert.equal(JSON.stringify(next.body).includes('STU2026001'), true, 'with no choice left, the first linked child shows');
  });
});

describe('What a parent can and cannot open', () => {
  const as = (path) => json('GET', `/api/student${path}`, { cookie: withChild(parent, ids.STU2026001) });
  it('reads attendance, timetable, results, fees, calendar and notices', async () => {
    for (const p of ['/dashboard', '/profile', '/institute', '/attendance', '/timetable', '/results', '/fees', '/fees/payments', '/calendar?year=2026&month=10', '/notices']) {
      const r = await as(p);
      assert.equal(r.status, 200, `${p} -> ${r.status} ${JSON.stringify(r.body).slice(0, 100)}`);
    }
  });
  it("sees the child's own numbers, not someone else's", async () => {
    const parentView = await as('/attendance');
    const studentView = await json('GET', '/api/student/attendance', { cookie: student });
    assert.equal(parentView.body.overall, studentView.body.overall);
    const fees = await as('/fees');
    const own = await json('GET', '/api/student/fees', { cookie: student });
    assert.equal(fees.body.summary.outstanding, own.body.summary.outstanding);
  });
  it("cannot open the student's own areas", async () => {
    for (const p of ['/quizzes', '/learning', '/library/books', '/certificates', '/id-card.pdf', '/internal-marks', '/feedback']) {
      const r = await as(p);
      assert.equal(r.status, 403, p);
      assert.match(r.body.message, /for the student/);
    }
    assert.equal((await json('POST', '/api/student/certificates', { cookie: parent, body: { certType: 'bonafide', purpose: 'x' } })).status, 403);
    assert.equal((await json('POST', '/api/student/quizzes/11111111-1111-4111-8111-111111111111/start', { cookie: parent })).status, 403);
  });
  it('can start paying fees (the gateway is simply not set up in tests)', async () => {
    const cfg = await json('GET', '/api/student/fees/online/config', { cookie: parent });
    assert.equal(cfg.status, 200);
    const order = await json('POST', '/api/student/fees/online/orders', { cookie: parent, body: {} });
    assert.notEqual(order.status, 403, 'a parent is allowed to start an online payment');
  });
  it('is kept out of the office, staff and platform areas', async () => {
    for (const p of ['/api/admin/dashboard', '/api/admin/students', '/api/employee/leave', '/api/super-admin/tenants', '/api/admin/grievances']) {
      assert.equal((await json('GET', p, { cookie: parent })).status, 403, p);
    }
  });
  it('students cannot use the parent endpoints', async () => {
    assert.equal((await json('GET', '/api/parent/children', { cookie: student })).status, 403);
    assert.equal((await json('POST', '/api/parent/child', { cookie: student, body: { childId: ids.STU2026001 } })).status, 403);
    assert.equal((await json('GET', '/api/parent/children')).status, 401);
  });
});

describe('Notices and tickets', () => {
  it("a parent reads what the child's class reads, and marks it read for themselves", async () => {
    const feed = await json('GET', '/api/student/notices', { cookie: parent });
    assert.equal(feed.status, 200);
    assert.ok(feed.body.notices.every((n) => n.audience !== 'employees'));
    const studentBefore = await json('GET', '/api/student/notices', { cookie: student });
    const first = feed.body.notices[0];
    assert.equal((await json('POST', `/api/student/notices/${first.id}/read`, { cookie: parent })).status, 200);
    const after = await json('GET', '/api/student/notices', { cookie: parent });
    assert.equal(after.body.notices.find((n) => n.id === first.id).read, true);
    const studentFeed = await json('GET', '/api/student/notices', { cookie: student });
    assert.equal(studentFeed.body.notices.find((n) => n.id === first.id).read, studentBefore.body.notices.find((n) => n.id === first.id).read, "the student's own read marks are not touched");
  });
  it('a parent raises a ticket about their child; the office sees whose parent', async () => {
    const c = withChild(parent, ids.STU2026002);
    const r = await json('POST', '/api/student/grievances', { cookie: c, body: { category: 'Fees', subject: 'PT fee receipt missing', details: 'I paid last week but the receipt is not showing.' } });
    assert.equal(r.status, 201);
    const row = (await withTx({ tenantId }, () => q("select raiser_role, student_id from grievances where subject = 'PT fee receipt missing'"))).rows[0];
    assert.equal(row.raiser_role, 'parent');
    assert.equal(row.student_id, ids.STU2026002);
    const office = (await json('GET', '/api/admin/grievances?search=PT%20fee', { cookie: admin })).body.grievances[0];
    assert.match(office.from, /parent of Simran/);
    assert.equal((await json('GET', `/api/student/grievances/${office.id}`, { cookie: student })).status, 404, "the student cannot read their parent's ticket");
    assert.equal((await json('GET', `/api/student/grievances/${office.id}`, { cookie: parent })).status, 200);
    const mine = await json('GET', '/api/student/grievances', { cookie: parent });
    assert.ok(mine.body.grievances.every((g) => g.subject.startsWith('PT ')), "the child's own tickets are not shown to the parent");
  });
});

describe('The office creates and links parents', () => {
  it('lists the parents of a student', async () => {
    const r = await json('GET', `/api/admin/students/${ids.STU2026001}/parents`, { cookie: admin });
    assert.equal(r.status, 200);
    assert.equal(r.body.parents.length, 1);
    assert.equal(r.body.parents[0].loginId, 'PAR001');
    assert.equal(r.body.parents[0].children, 2);
  });
  it('creates a parent account with a one-time password and a setup email', async () => {
    const r = await json('POST', `/api/admin/students/${ids.STU2026003}/parents`, { cookie: admin, body: { name: 'Anil Mehta', email: 'anil.mehta@example.com', relation: 'Father' } });
    assert.equal(r.status, 201);
    assert.equal(r.body.created, true);
    assert.equal(r.body.account.loginId, 'PAR-STU2026003');
    assert.ok(r.body.account.temporaryPassword.length >= 12);
    const mail = await withTx({ tenantId }, () => q("select count(*)::int as n from notifications where template = 'accountSetup' and to_email = 'anil.mehta@example.com'"));
    assert.equal(mail.rows[0].n, 1);
    // the new parent can sign in but must choose a password first
    const l = await loginRaw('demo-college', 'parent', 'PAR-STU2026003', r.body.account.temporaryPassword);
    assert.equal(l.status, 200);
    const blocked = await json('GET', '/api/student/dashboard', { cookie: l.cookie });
    assert.equal(blocked.status, 403);
    assert.equal(blocked.body.code, 'PASSWORD_CHANGE_REQUIRED');
    // and by email too
    assert.equal((await loginRaw('demo-college', 'parent', 'anil.mehta@example.com', r.body.account.temporaryPassword)).status, 200);
  });
  it('the same email for a brother or sister links the same parent instead of making another', async () => {
    const r = await json('POST', `/api/admin/students/${ids.STU2026002}/parents`, { cookie: admin, body: { name: 'Anil Mehta', email: 'ANIL.MEHTA@example.com', relation: 'Uncle' } });
    assert.equal(r.status, 201);
    assert.equal(r.body.created, false);
    assert.equal(r.body.account, undefined);
    assert.equal(r.body.parent.children, 2);
    assert.equal((await json('GET', `/api/admin/students/${ids.STU2026002}/parents`, { cookie: admin })).body.parents.length, 2, 'a student can have two parents or guardians');
    assert.equal((await json('POST', `/api/admin/students/${ids.STU2026002}/parents`, { cookie: admin, body: { name: 'Anil Mehta', email: 'anil.mehta@example.com' } })).status, 409, 'already linked');
  });
  it('checks the details, and refuses an email that belongs to a student or staff account', async () => {
    const post = (body) => json('POST', `/api/admin/students/${ids.STU2026003}/parents`, { cookie: admin, body });
    assert.equal((await post({ name: '', email: 'a@b.co' })).status, 400);
    assert.equal((await post({ name: 'X', email: 'not-an-email' })).status, 400);
    assert.equal((await post({ name: 'X' })).status, 400);
    const own = await post({ name: 'X', email: 'karan.mehta@student.horizon.example' });
    assert.equal(own.status, 409);
    assert.match(own.body.message, /another account/);
    assert.equal((await json('POST', '/api/admin/students/11111111-1111-4111-8111-111111111111/parents', { cookie: admin, body: { name: 'X', email: 'x@y.co' } })).status, 404);
  });
  it('removing the last link removes the account; removing one of two keeps it', async () => {
    const list = (await json('GET', `/api/admin/students/${ids.STU2026003}/parents`, { cookie: admin })).body.parents;
    const uid = list.find((p) => p.loginId === 'PAR-STU2026003').userId;
    assert.equal((await json('DELETE', `/api/admin/students/${ids.STU2026003}/parents/${uid}`, { cookie: admin })).status, 200);
    const still = (await json('GET', `/api/admin/students/${ids.STU2026002}/parents`, { cookie: admin })).body.parents;
    assert.ok(still.some((p) => p.userId === uid), 'still linked to the other child');
    assert.equal((await json('DELETE', `/api/admin/students/${ids.STU2026003}/parents/${uid}`, { cookie: admin })).status, 404);
    assert.equal((await json('DELETE', `/api/admin/students/${ids.STU2026002}/parents/${uid}`, { cookie: admin })).status, 200);
    const gone = await withTx({ tenantId }, () => q('select count(*)::int as n from users where id = $1', [uid]));
    assert.equal(gone.rows[0].n, 0);
    assert.equal((await json('GET', `/api/admin/students/${ids.STU2026002}/parents`, { cookie: admin })).body.parents.length, 1, "the first parent is untouched");
  });
  it('invites every student that has no parent yet and has a guardian email', async () => {
    // The demo college has 120 students; keep only the three well-known ones in play so the counts below stay exact
    await withTx({ tenantId }, () => q("update students set guardian = jsonb_set(guardian, '{email_bak}', coalesce(guardian->'email', '\"\"'::jsonb)) || '{\"email\": \"\"}'::jsonb where student_code not in ('STU2026001','STU2026002','STU2026003')"));
    const original = (await withTx({ tenantId }, () => q("select guardian from students where student_code = 'STU2026003'"))).rows[0].guardian;
    await withTx({ tenantId }, () => q("update students set guardian = guardian || '{\"email\": \"\"}'::jsonb where student_code = 'STU2026003'"));
    const none = await json('POST', '/api/admin/students/parents/invite-all', { cookie: admin });
    assert.equal(none.body.created, 0);
    assert.ok(none.body.skipped.some((x) => x.studentCode === 'STU2026003' && /No guardian email/.test(x.reason)));
    await withTx({ tenantId }, () => q("update students set guardian = $1::jsonb where student_code = 'STU2026003'", [JSON.stringify(original)]));
    const r = await json('POST', '/api/admin/students/parents/invite-all', { cookie: admin });
    assert.equal(r.status, 200);
    assert.equal(r.body.created, 1);
    const made = await withTx({ tenantId }, () => q("select login_id from users where role = 'parent' and login_id like 'PAR-%'"));
    assert.deepEqual(made.rows.map((x) => x.login_id), ['PAR-STU2026003']);
    const again = await json('POST', '/api/admin/students/parents/invite-all', { cookie: admin });
    assert.equal(again.body.created, 0, 'running it twice does not duplicate anyone');
    await withTx({ tenantId }, () => q("update students set guardian = (guardian - 'email_bak') || jsonb_build_object('email', guardian->'email_bak') where guardian ? 'email_bak'"));
  });
  it('is closed to students and other institutes', async () => {
    assert.equal((await json('GET', `/api/admin/students/${ids.STU2026001}/parents`, { cookie: student })).status, 403);
    assert.equal((await json('GET', `/api/admin/students/${ids.STU2026001}/parents`, { cookie: schoolAdmin })).status, 404);
    assert.equal((await json('POST', `/api/admin/students/${ids.STU2026001}/parents`, { cookie: schoolAdmin, body: { name: 'X', email: 'x@y.co' } })).status, 404);
    assert.equal((await json('POST', '/api/admin/students/parents/invite-all', { cookie: student })).status, 403);
  });
});

describe('Switching the module off', () => {
  it('closes the parent portal but leaves students alone', async () => {
    const before = (await withTx({ platform: true }, () => q("select modules from tenants where code = 'demo-college'"))).rows[0].modules;
    try {
      await setModules(before.filter((m) => m !== 'parent_portal'));
      const r = await json('GET', '/api/parent/children', { cookie: parent });
      assert.equal(r.status, 403);
      assert.equal(r.body.code, 'MODULE_DISABLED');
      assert.equal((await json('GET', '/api/student/attendance', { cookie: parent })).body.code, 'MODULE_DISABLED');
      assert.equal((await json('GET', '/api/student/attendance', { cookie: student })).status, 200);
      assert.equal((await json('GET', `/api/admin/students/${ids.STU2026001}/parents`, { cookie: admin })).status, 403);
    } finally { await setModules(before); }
  });
});

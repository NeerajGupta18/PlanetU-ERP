/** Notice board (Phase 2) - run with `npm test` (needs `npm run db:setup` first). */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { env } from '../src/config/env.js';
import { createApp } from '../src/app.js';
import { closePool, q, withTx } from '../src/db/pool.js';
import { issueCaptchaToken } from '../src/services/captcha.service.js';

let server; let base; let tenantId; let admin; let student; let student2; let employee; let schoolAdmin; let courseOfStudent; let otherCourse;
const MARK = `NB-${Date.now().toString(36)}`;

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
const post = (over = {}) => json('POST', '/api/admin/notices', { cookie: admin, body: { title: `${MARK} notice`, body: 'Hello everyone', ...over } });
const mine = async (cookie, who = 'student') => (await json('GET', `/api/${who}/notices`, { cookie })).body;
const titles = (feed) => feed.notices.map((n) => n.title);
const day = (offset) => { const d = new Date(); d.setDate(d.getDate() + offset); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

before(async () => {
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  admin = await login('demo-college', 'admin', 'ADM001', 'Admin@123');
  student = await login('demo-college', 'student', 'STU2026001', 'Student@123');
  student2 = await login('demo-college', 'student', 'STU2026002', 'Student@123');
  employee = await login('demo-college', 'employee', 'EMP001', 'Employee@123');
  schoolAdmin = await login('demo-school', 'admin', 'ADM001', 'Admin@123');
  tenantId = (await withTx({ platform: true }, () => q("select id from tenants where code = 'demo-college'"))).rows[0].id;
  courseOfStudent = (await withTx({ tenantId }, () => q("select course_id from students where student_code = 'STU2026001'"))).rows[0].course_id;
  otherCourse = (await withTx({ tenantId }, () => q("insert into courses (code, name, years) values ($1, $2, 3) returning id", [MARK.slice(0, 12), `${MARK} course`]))).rows[0].id;
});
after(async () => {
  await withTx({ tenantId }, async () => {
    await q('delete from notices where title like $1', [`${MARK}%`]);
    await q("delete from notifications where template = 'noticePosted' and subject like $1", [`%${MARK}%`]);
    await q('delete from courses where id = $1', [otherCourse]);
  });
  await new Promise((r) => server.close(r));
  await closePool();
});

describe('Posting notices (office)', () => {
  it('creates, edits and deletes a notice', async () => {
    const c = await post({ category: 'Exam', priority: 'important', pinned: true });
    assert.equal(c.status, 201);
    const id = c.body.notice.id;
    assert.equal(c.body.notice.state, 'live');
    assert.equal(c.body.notice.priority, 'important');
    const u = await json('PUT', `/api/admin/notices/${id}`, { cookie: admin, body: { title: `${MARK} edited`, body: 'Changed', audience: 'students', priority: 'normal' } });
    assert.equal(u.status, 200);
    assert.equal(u.body.notice.title, `${MARK} edited`);
    assert.equal(u.body.notice.audience, 'students');
    const list = await json('GET', '/api/admin/notices', { cookie: admin });
    assert.ok(list.body.notices.some((n) => n.id === id));
    assert.ok(list.body.categories.includes('Exam'));
    assert.equal((await json('DELETE', `/api/admin/notices/${id}`, { cookie: admin })).status, 200);
    assert.equal((await json('DELETE', `/api/admin/notices/${id}`, { cookie: admin })).status, 404);
  });

  it('validates what is typed', async () => {
    assert.equal((await post({ title: '' })).status, 400);
    assert.equal((await post({ title: 'x'.repeat(151) })).status, 400);
    assert.equal((await post({ audience: 'martians' })).status, 400);
    assert.equal((await post({ noticeDate: 'tomorrow' })).status, 400);
    assert.equal((await post({ noticeDate: day(5), expiresOn: day(2) })).status, 400);
    assert.equal((await post({ audience: 'employees', courseId: otherCourse })).status, 400); // only student notices can be limited to a course
    assert.equal((await post({ audience: 'students', courseId: '11111111-1111-1111-1111-111111111111' })).status, 400);
  });

  it('is closed to students and staff, and to other institutes', async () => {
    assert.equal((await json('POST', '/api/admin/notices', { cookie: student, body: { title: 'x' } })).status, 403);
    assert.equal((await json('GET', '/api/admin/notices', { cookie: employee })).status, 403);
    const c = await post();
    assert.equal((await json('PUT', `/api/admin/notices/${c.body.notice.id}`, { cookie: schoolAdmin, body: { title: 'hijack' } })).status, 404);
    assert.equal((await json('DELETE', `/api/admin/notices/${c.body.notice.id}`, { cookie: schoolAdmin })).status, 404);
    const schoolList = await json('GET', '/api/admin/notices', { cookie: schoolAdmin });
    assert.ok(!schoolList.body.notices.some((n) => n.id === c.body.notice.id));
  });
});

describe('Who sees what', () => {
  it('shows a notice only to its audience', async () => {
    await post({ title: `${MARK} all`, audience: 'all' });
    await post({ title: `${MARK} students`, audience: 'students' });
    await post({ title: `${MARK} staff`, audience: 'employees' });
    const s = titles(await mine(student)); const e = titles(await mine(employee, 'employee'));
    assert.ok(s.includes(`${MARK} all`) && s.includes(`${MARK} students`) && !s.includes(`${MARK} staff`));
    assert.ok(e.includes(`${MARK} all`) && e.includes(`${MARK} staff`) && !e.includes(`${MARK} students`));
  });

  it('limits a student notice to one course', async () => {
    await post({ title: `${MARK} course-mine`, audience: 'students', courseId: courseOfStudent });
    await post({ title: `${MARK} course-other`, audience: 'students', courseId: otherCourse });
    const s = titles(await mine(student));
    assert.ok(s.includes(`${MARK} course-mine`));
    assert.ok(!s.includes(`${MARK} course-other`));
  });

  it('hides drafts, scheduled notices and expired ones; shows them to the office with their state', async () => {
    await post({ title: `${MARK} draft`, status: 'draft' });
    await post({ title: `${MARK} future`, noticeDate: day(3) });
    await post({ title: `${MARK} expired`, noticeDate: day(-5), expiresOn: day(-1) });
    await post({ title: `${MARK} lastday`, noticeDate: day(-5), expiresOn: day(0) });
    const s = titles(await mine(student));
    for (const t of ['draft', 'future', 'expired']) assert.ok(!s.includes(`${MARK} ${t}`), t);
    assert.ok(s.includes(`${MARK} lastday`));
    const states = Object.fromEntries((await json('GET', '/api/admin/notices', { cookie: admin })).body.notices.filter((n) => n.title.startsWith(MARK)).map((n) => [n.title.replace(`${MARK} `, ''), n.state]));
    assert.equal(states.draft, 'draft'); assert.equal(states.future, 'scheduled'); assert.equal(states.expired, 'expired'); assert.equal(states.lastday, 'live');
  });

  it('puts pinned notices first', async () => {
    await post({ title: `${MARK} pinned`, pinned: true, noticeDate: day(-20) });
    const feed = await mine(student);
    assert.equal(feed.notices[0].pinned, true);
    assert.ok(feed.notices.slice(0, feed.notices.findIndex((n) => !n.pinned)).every((n) => n.pinned));
  });
});

describe('New and read', () => {
  it('counts what a person has not opened, marks it read for them only, and can mark all', async () => {
    const c = await post({ title: `${MARK} unread` });
    const id = c.body.notice.id;
    const before1 = await mine(student);
    assert.equal(before1.notices.find((n) => n.id === id).read, false);
    assert.ok(before1.unread >= 1);

    assert.equal((await json('POST', `/api/student/notices/${id}/read`, { cookie: student })).status, 200);
    assert.equal((await json('POST', `/api/student/notices/${id}/read`, { cookie: student })).status, 200); // twice is fine
    const after1 = await mine(student);
    assert.equal(after1.notices.find((n) => n.id === id).read, true);
    assert.equal(after1.unread, before1.unread - 1);
    assert.equal((await mine(student2)).notices.find((n) => n.id === id).read, false); // someone else still has it as new
    assert.equal((await json('GET', '/api/admin/notices', { cookie: admin })).body.notices.find((n) => n.id === id).reads, 1);

    assert.equal((await json('POST', '/api/student/notices/read-all', { cookie: student })).status, 200);
    assert.equal((await mine(student)).unread, 0);
  });

  it('refuses to mark a notice the person is not allowed to see', async () => {
    const staffOnly = await post({ title: `${MARK} staffonly`, audience: 'employees' });
    assert.equal((await json('POST', `/api/student/notices/${staffOnly.body.notice.id}/read`, { cookie: student })).status, 404);
    assert.equal((await json('POST', `/api/student/notices/not-an-id/read`, { cookie: student })).status, 404);
  });

  it('shows up on the student dashboard with the new count', async () => {
    await post({ title: `${MARK} dash`, pinned: true });
    const d = (await json('GET', '/api/student/dashboard', { cookie: student2 })).body;
    assert.ok(d.notices.length <= 4);
    assert.equal(typeof d.stats.notices, 'number');
    assert.ok(d.stats.notices >= 1);
  });
});

describe('Emailing a notice', () => {
  it('queues one email per active student when asked, and none otherwise', async () => {
    const countMails = async () => (await withTx({ tenantId }, () => q("select count(*)::int as n from notifications where template = 'noticePosted' and subject like $1", [`%${MARK} mailed%`]))).rows[0].n;
    await post({ title: `${MARK} quiet`, audience: 'students' });
    assert.equal(await countMails(), 0);
    const { rows: [{ n: students }] } = await withTx({ tenantId }, () => q("select count(*)::int as n from students where status = 'Active' and email <> ''"));
    const r = await post({ title: `${MARK} mailed`, audience: 'students', notify: true });
    assert.equal(r.body.emailed, students);
    assert.equal(await countMails(), students);
  });

  it('does not email a draft', async () => {
    const r = await post({ title: `${MARK} mailed draft`, audience: 'students', notify: true, status: 'draft' });
    assert.equal(r.body.emailed, 0);
  });
});

describe('Module switch', () => {
  it('is blocked when the institute does not have the Notice Board module', async () => {
    const sa = await login('', 'super_admin', 'SA001', 'SuperAdmin@123');
    const { rows: [{ modules }] } = await withTx({ platform: true }, () => q('select modules from tenants where id = $1', [tenantId]));
    try {
      const off = await json('PUT', `/api/super-admin/tenants/${tenantId}`, { cookie: sa, body: { modules: modules.filter((m) => m !== 'notices') } });
      assert.equal(off.status, 200);
      const a = await login('demo-college', 'admin', 'ADM001', 'Admin@123');
      assert.equal((await json('GET', '/api/admin/notices', { cookie: a })).body.code, 'MODULE_DISABLED');
      const s = await login('demo-college', 'student', 'STU2026001', 'Student@123');
      assert.equal((await json('GET', '/api/student/notices', { cookie: s })).status, 403);
      assert.deepEqual((await json('GET', '/api/student/dashboard', { cookie: s })).body.notices, []);
    } finally {
      await json('PUT', `/api/super-admin/tenants/${tenantId}`, { cookie: sa, body: { modules } });
    }
  });
});

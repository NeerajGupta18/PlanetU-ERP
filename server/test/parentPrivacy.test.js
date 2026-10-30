/**
 * A parent sees only their own children; nobody reads another person's record through an id (Day 12A).
 * Run with `npm test` (needs `npm run db:setup` first).
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { env } from '../src/config/env.js';
import { createApp } from '../src/app.js';
import { closePool, q, withTx } from '../src/db/pool.js';
import { issueCaptchaToken } from '../src/services/captcha.service.js';
import { DEMO_TENANTS } from '../src/db/demo-data.js';
import { whatIfAttendance } from '../../client/src/utils/kpi.js';

let server; let base; let tenantId; let schoolId;
const cookies = {}; const ids = {};

const json = async (method, path, { cookie, body } = {}) => {
  const r = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let b = null; try { b = JSON.parse(text); } catch { /* a pdf or empty */ }
  return { status: r.status, body: b, text, headers: r.headers };
};
async function login(tenantCode, role, identifier, password, extra = '') {
  const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', ...(extra ? { cookie: extra } : {}) }, body: JSON.stringify({ tenantCode, role, identifier, password, captchaToken: issueCaptchaToken() }) });
  assert.equal(r.status, 200, `${identifier} should sign in`);
  return { cookie: r.headers.getSetCookie().map((c) => c.split(';')[0]).find((c) => c.startsWith(`${env.COOKIE_NAME}=`)), setCookies: r.headers.getSetCookie() };
}
const inCollege = (fn) => withTx({ tenantId }, fn);
const asA = (childId) => `${cookies.parentA}; erp_child=${childId}`;
const clearsChild = (setCookies) => setCookies.some((c) => /^erp_child=;/.test(c) && /Expires=Thu, 01 Jan 1970/.test(c));
/** Nothing that names B's child: their id, code, name or guardian. */
const noTraceOfB = (r, label) => {
  for (const secret of [ids.B, ids.Bcode, ids.Bname, ids.Bguardian]) assert.equal(r.text.includes(secret), false, `${label} leaked ${secret}: ${r.text.slice(0, 200)}`);
};

before(async () => {
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  cookies.parentA = (await login('demo-college', 'parent', 'PAR001', 'Parent@123')).cookie;
  cookies.parentB = (await login('demo-college', 'parent', 'PAR002', 'Parent@123')).cookie;
  cookies.studentA = (await login('demo-college', 'student', 'STU2026001', 'Student@123')).cookie;
  cookies.studentC = (await login('demo-college', 'student', 'STU2026003', 'Student@123')).cookie;
  cookies.admin = (await login('demo-college', 'admin', 'ADM001', 'Admin@123')).cookie;
  cookies.schoolAdmin = (await login('demo-school', 'admin', 'ADM001', 'Admin@123')).cookie;
  cookies.schoolParent = (await login('demo-school', 'parent', 'PAR001', 'Parent@123')).cookie;
  cookies.librarian = (await login('demo-college', 'employee', 'EMP009', 'Employee@123')).cookie;
  cookies.principal = (await login('demo-college', 'employee', 'EMP007', 'Employee@123')).cookie;
  const t = (await withTx({ platform: true }, () => q("select id, code from tenants where code in ('demo-college', 'demo-school')"))).rows;
  tenantId = t.find((x) => x.code === 'demo-college').id;
  schoolId = t.find((x) => x.code === 'demo-school').id;
  await inCollege(async () => {
    const rows = (await q("select id, name, student_code, course_id, guardian from students where student_code in ('STU2026001', 'STU2026002', 'STU2026003', 'STU2026041')")).rows;
    const by = Object.fromEntries(rows.map((r) => [r.student_code, r]));
    Object.assign(ids, {
      A: by.STU2026001.id, Asibling: by.STU2026002.id, C: by.STU2026003.id, B: by.STU2026041.id,
      Bcode: 'STU2026041', Bname: by.STU2026041.name, Bguardian: by.STU2026041.guardian.name, Bcourse: by.STU2026041.course_id, Acourse: by.STU2026001.course_id,
    });
    // B's child has a receipt, a published exam of their own class and a photo, so there is something to try to reach
    ids.Bpayment = (await q("insert into payments (student_id, receipt_no, amount, method) values ($1, 'PP-TEST-1', 500, 'cash') returning id", [ids.B])).rows[0].id;
    ids.Bexam = (await q(`insert into exams (course_id, semester, name, kind, status, start_date, end_date)
                          values ($1, 3, 'PP class B exam', 'term', 'published', current_date, current_date) returning id`, [ids.Bcourse])).rows[0].id;
    const file = (await q(
      `insert into files (created_by, purpose, original_name, mime, size_bytes, sha256, storage_key)
       values ((select id from users where login_id = 'PAR002'), 'general', 'pp.png', 'image/png', 1, 'x', 'pp-test') returning id`,
    )).rows[0];
    ids.Bfile = file.id;
    await q('update students set photo_file_id = $1 where id = $2', [file.id, ids.B]);
  });
});
after(async () => {
  await inCollege(async () => {
    await q('update students set photo_file_id = null where id = $1', [ids.B]);
    await q("delete from files where storage_key = 'pp-test'");
    await q("delete from grievances where subject like 'PP %'");
    await q("delete from payments where receipt_no = 'PP-TEST-1'");
    await q("delete from exams where name = 'PP class B exam'");
  });
  await new Promise((r) => server.close(r));
  await closePool();
});

describe('The demo families', () => {
  it('every demo parent is linked only to children of one family, and exactly one family has two children', async () => {
    const families = [];
    for (const spec of DEMO_TENANTS) {
      const tid = (await withTx({ platform: true }, () => q('select id from tenants where code = $1', [spec.code]))).rows[0].id;
      const rows = (await withTx({ tenantId: tid }, () => q(
        `select u.login_id, count(*)::int as kids, count(distinct s.guardian->>'email')::int as guardians, count(distinct split_part(s.name, ' ', 2))::int as surnames
         from parent_links l join users u on u.id = l.user_id join students s on s.id = l.student_id group by u.login_id`,
      ))).rows;
      assert.ok(rows.length >= 2, `${spec.code} has two separate parents to tell apart`);
      for (const r of rows) {
        assert.equal(r.guardians, 1, `${spec.code} ${r.login_id} has children from ${r.guardians} different guardians`);
        assert.equal(r.surnames, 1, `${spec.code} ${r.login_id} has children with different surnames`);
        families.push({ code: spec.code, ...r });
      }
    }
    assert.deepEqual(families.filter((f) => f.kids > 1).map((f) => `${f.code}/${f.login_id}`), ['demo-college/PAR001']);
  });
});

describe('A parent lists and opens only their own children', () => {
  it('parent A sees A\'s two children and parent B sees only B\'s one', async () => {
    const a = await json('GET', '/api/parent/children', { cookie: cookies.parentA });
    assert.deepEqual(a.body.children.map((c) => c.studentCode).sort(), ['STU2026001', 'STU2026002']);
    noTraceOfB(a, 'the child list');
    const b = await json('GET', '/api/parent/children', { cookie: cookies.parentB });
    assert.deepEqual(b.body.children.map((c) => c.studentCode), ['STU2026041']);
    assert.equal(b.body.children.length < 2, true, 'with one child the switcher has nothing to offer');
  });
  it('choosing a child of another parent is refused', async () => {
    assert.equal((await json('POST', '/api/parent/child', { cookie: cookies.parentA, body: { childId: ids.B } })).status, 404);
    assert.equal((await json('POST', '/api/parent/child', { cookie: cookies.parentB, body: { childId: ids.A } })).status, 404);
  });
  it('a parent with the same surname, phone and guardian name as another family stays separate', async () => {
    // Nothing is ever matched on these: give B's child the guardian details of A's family and nothing moves
    const original = (await inCollege(() => q('select guardian from students where id = $1', [ids.B]))).rows[0].guardian;
    const a = (await inCollege(() => q('select guardian from students where id = $1', [ids.A]))).rows[0].guardian;
    await inCollege(() => q('update students set guardian = $1::jsonb where id = $2', [JSON.stringify(a), ids.B]));
    try {
      const listA = await json('GET', '/api/parent/children', { cookie: cookies.parentA });
      const listB = await json('GET', '/api/parent/children', { cookie: cookies.parentB });
      assert.deepEqual(listA.body.children.map((c) => c.studentCode).sort(), ['STU2026001', 'STU2026002']);
      assert.deepEqual(listB.body.children.map((c) => c.studentCode), ['STU2026041']);
    } finally {
      await inCollege(() => q('update students set guardian = $1::jsonb where id = $2', [JSON.stringify(original), ids.B]));
    }
  });
});

describe('Parent A asking for parent B\'s child gets a refusal and no data on every endpoint', () => {
  const READS = ['/dashboard', '/my-day', '/profile', '/institute', '/calendar?year=2026&month=10', '/timetable', '/attendance', '/results', '/fees', '/fees/payments', '/fees/online/config', '/notices', '/grievances', '/hostel', '/transport'];
  for (const p of READS) {
    it(`GET ${p}`, async () => {
      const r = await json('GET', `/api/student${p}`, { cookie: asA(ids.B) });
      assert.ok([403, 404].includes(r.status), `${p} answered ${r.status}`);
      noTraceOfB(r, p);
    });
  }
  it('the writes too: starting a payment, a ticket, marking notices read', async () => {
    for (const [m, p, body] of [['POST', '/fees/online/orders', {}], ['POST', '/fees/online/verify', {}], ['POST', '/grievances', { category: 'Fees', subject: 'PP other child', details: 'Should never be stored' }], ['POST', '/notices/read-all', {}]]) {
      const r = await json(m, `/api/student${p}`, { cookie: asA(ids.B), body });
      assert.ok([403, 404].includes(r.status), `${p} answered ${r.status}`);
      noTraceOfB(r, p);
    }
    assert.equal((await inCollege(() => q("select count(*)::int as n from grievances where subject = 'PP other child'"))).rows[0].n, 0);
  });
  it('the refusal also forgets the wrong choice, so the parent is back on their own child next time', async () => {
    const r = await json('GET', '/api/student/profile', { cookie: asA(ids.B) });
    assert.ok(clearsChild(r.headers.getSetCookie()));
    const next = await json('GET', '/api/student/profile', { cookie: cookies.parentA });
    assert.equal(next.status, 200);
    assert.match(next.text, /STU202600[12]/);
  });
  it('another child\'s receipt, report card, ID card and photo stay closed by their own ids', async () => {
    const own = cookies.parentA;
    assert.equal((await json('GET', `/api/student/fees/payments/${ids.Bpayment}/receipt.pdf`, { cookie: own })).status, 404);
    assert.equal((await json('GET', `/api/student/results/${ids.Bexam}/report-card.pdf`, { cookie: own })).status, 404);
    assert.equal((await json('GET', '/api/student/id-card.pdf', { cookie: own })).status, 403);
    assert.equal((await json('GET', `/api/files/${ids.Bfile}`, { cookie: own })).status, 404);
    assert.equal((await json('GET', `/api/admin/students/${ids.B}`, { cookie: own })).status, 403);
    assert.equal((await json('GET', `/api/admin/fees/students/${ids.B}`, { cookie: own })).status, 403);
    assert.equal((await json('GET', `/api/admin/exams/${ids.Bexam}/students/${ids.B}/report-card.pdf`, { cookie: own })).status, 403);
  });
  it('the notification bell only talks about their own children', async () => {
    await inCollege(() => q("insert into student_fee_items (student_id, label, amount, due_date, status) values ($1, 'PP due', 700, current_date - 2, 'unpaid')", [ids.B]));
    try {
      const a = await json('GET', '/api/me/notifications', { cookie: cookies.parentA });
      noTraceOfB(a, 'parent A bell');
      assert.equal(a.text.includes(ids.Bname.split(' ')[0]), false);
      const b = await json('GET', '/api/me/notifications', { cookie: cookies.parentB });
      assert.ok(b.body.reminders.some((x) => x.title.startsWith(ids.Bname.split(' ')[0])));
    } finally {
      await inCollege(() => q("delete from student_fee_items where label = 'PP due'"));
    }
  });
});

describe('The chosen child does not outlive the session', () => {
  it('signing out clears it', async () => {
    const r = await json('POST', '/api/auth/logout', { cookie: asA(ids.Asibling) });
    assert.ok(clearsChild(r.headers.getSetCookie()), r.headers.getSetCookie().join(' | '));
  });
  it('signing in clears whatever the last person left in this browser', async () => {
    const { setCookies } = await login('demo-college', 'parent', 'PAR002', 'Parent@123', `erp_child=${ids.A}`);
    assert.ok(clearsChild(setCookies), setCookies.join(' | '));
  });
  it('signed-in answers are never stored by the browser', async () => {
    for (const p of ['/api/parent/children', '/api/student/fees', '/api/me/notifications']) {
      const r = await json('GET', p, { cookie: cookies.parentA });
      assert.match(r.headers.get('cache-control') || '', /no-store/, p);
    }
  });
});

describe('A sibling link is only made by the office', () => {
  it('Invite all never links a child to an account because the email matches', async () => {
    await inCollege(() => q("update students set guardian = jsonb_set(guardian, '{email_bak}', coalesce(guardian->'email', '\"\"'::jsonb)) || '{\"email\": \"\"}'::jsonb where student_code <> 'STU2026003'"));
    const original = (await inCollege(() => q("select guardian from students where student_code = 'STU2026003'"))).rows[0].guardian;
    await inCollege(() => q("update students set guardian = guardian || '{\"email\": \"parent2@college.example\"}'::jsonb where student_code = 'STU2026003'"));
    try {
      const r = await json('POST', '/api/admin/students/parents/invite-all', { cookie: cookies.admin });
      assert.equal(r.status, 200);
      assert.equal(r.body.created, 0);
      assert.ok(r.body.skipped.some((x) => x.studentCode === 'STU2026003' && /already has a parent account/.test(x.reason)), JSON.stringify(r.body.skipped.slice(0, 3)));
      const b = await json('GET', '/api/parent/children', { cookie: cookies.parentB });
      assert.deepEqual(b.body.children.map((c) => c.studentCode), ['STU2026041'], 'the email match made no link');
    } finally {
      await inCollege(async () => {
        await q('update students set guardian = $1::jsonb where student_code = \'STU2026003\'', [JSON.stringify(original)]);
        await q("update students set guardian = (guardian - 'email_bak') || jsonb_build_object('email', guardian->'email_bak') where guardian ? 'email_bak'");
      });
    }
  });
});

describe('Students, teachers and office desks stay within their own', () => {
  it('student A cannot read student B: receipt, report card, photo, or the office pages', async () => {
    const a = cookies.studentA;
    assert.equal((await json('GET', `/api/student/fees/payments/${ids.Bpayment}/receipt.pdf`, { cookie: a })).status, 404);
    assert.equal((await json('GET', `/api/student/results/${ids.Bexam}/report-card.pdf`, { cookie: a })).status, 404);
    assert.equal((await json('GET', `/api/files/${ids.Bfile}`, { cookie: a })).status, 404);
    for (const p of [`/api/admin/students/${ids.B}`, `/api/admin/fees/students/${ids.B}`, '/api/admin/students', `/api/admin/students/${ids.B}/overview`, '/api/parent/children']) {
      assert.equal((await json('GET', p, { cookie: a })).status, 403, p);
    }
    const profile = await json('GET', '/api/student/profile', { cookie: a });
    assert.equal(profile.text.includes(ids.Bcode), false);
  });
  it('a student\'s ticket and certificate are closed to another student', async () => {
    const t = await json('POST', '/api/student/grievances', { cookie: cookies.studentA, body: { category: 'Fees', subject: 'PP student ticket', details: 'Only for this student and the office.' } });
    assert.equal(t.status, 201);
    assert.equal((await json('GET', `/api/student/grievances/${t.body.grievance.id}`, { cookie: cookies.studentC })).status, 404);
    assert.equal((await json('POST', `/api/student/grievances/${t.body.grievance.id}/reply`, { cookie: cookies.studentC, body: { message: 'x' } })).status, 404);
    assert.equal((await json('POST', `/api/student/grievances/${t.body.grievance.id}/close`, { cookie: cookies.studentC })).status, 404);
  });
  it('a class teacher sees only their own class', async () => {
    const { teacher, own, other } = await inCollege(async () => {
      const rows = (await q(`select c.id, e.emp_code from courses c join employees e on e.id = c.class_teacher_id
                             where not exists (select 1 from staff_roles r where r.employee_id = e.id) order by c.code`)).rows;
      const mine = rows[0];
      const theirs = rows.find((r) => r.emp_code !== mine.emp_code);
      return { teacher: mine.emp_code, own: rows.filter((r) => r.emp_code === mine.emp_code).map((r) => r.id), other: theirs.id };
    });
    const c = (await login('demo-college', 'employee', teacher, 'Employee@123')).cookie;
    const r = await json('GET', '/api/assistants/attendance/overview', { cookie: c });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.classes.map((x) => x.id).sort(), [...own].sort());
    assert.equal((await json('GET', `/api/assistants/attendance/overview?courseId=${other}`, { cookie: c })).status, 403);
    assert.equal((await json('GET', `/api/admin/students/${ids.B}`, { cookie: c })).status, 403, 'a plain teacher has no office access');
    const slot = await inCollege(async () => (await q(
      `select t.id from timetable_slots t join employees e on e.id = t.employee_id where e.emp_code <> $1 and not exists (select 1 from timetable_slots x join employees f on f.id = x.employee_id where f.emp_code = $1 and x.id = t.id) limit 1`, [teacher],
    )).rows[0]);
    assert.equal((await json('GET', `/api/employee/attendance/lecture?slotId=${slot.id}`, { cookie: c })).status, 404, "another teacher's register looks nonexistent");
  });
  it('a desk that only looks students up gets who they are, not the whole record', async () => {
    const list = await json('GET', `/api/admin/students?search=${ids.Bcode}`, { cookie: cookies.librarian });
    assert.equal(list.status, 200);
    assert.equal(list.body.students[0].studentCode, ids.Bcode);
    const one = await json('GET', `/api/admin/students/${ids.B}`, { cookie: cookies.librarian });
    assert.equal(one.status, 200);
    for (const r of [list.body.students[0], one.body.student]) {
      for (const k of ['guardian', 'phone', 'email', 'address', 'dob', 'bloodGroup', 'attendance']) assert.equal(r[k], undefined, k);
    }
    assert.equal((await json('GET', `/api/admin/students/${ids.B}/parents`, { cookie: cookies.librarian })).status, 403);
    assert.equal((await json('GET', `/api/admin/students/${ids.B}/overview`, { cookie: cookies.librarian })).status, 403);
    assert.equal((await json('GET', `/api/admin/students/${ids.B}/id-card.pdf`, { cookie: cookies.librarian })).status, 403);
  });
  it('the student office still sees the whole record', async () => {
    const one = await json('GET', `/api/admin/students/${ids.B}`, { cookie: cookies.principal });
    assert.ok(one.body.student.guardian?.name);
    assert.equal((await json('GET', `/api/admin/students/${ids.B}/parents`, { cookie: cookies.principal })).status, 200);
  });
});

describe('Another institute\'s ids return nothing', () => {
  it('for a parent, an admin and a file', async () => {
    const r = await json('GET', '/api/student/profile', { cookie: `${cookies.schoolParent}; erp_child=${ids.B}` });
    assert.ok([403, 404].includes(r.status));
    noTraceOfB(r, 'school parent');
    assert.equal((await json('POST', '/api/parent/child', { cookie: cookies.schoolParent, body: { childId: ids.B } })).status, 404);
    for (const p of [`/api/admin/students/${ids.B}`, `/api/admin/students/${ids.B}/parents`, `/api/admin/fees/students/${ids.B}`, `/api/admin/fees/payments/${ids.Bpayment}/receipt.pdf`, `/api/files/${ids.Bfile}`]) {
      const a = await json('GET', p, { cookie: cookies.schoolAdmin });
      assert.equal(a.status, 404, p);
      noTraceOfB(a, p);
    }
    assert.ok(schoolId);
  });
});

describe('The parent dashboard (12C)', () => {
  it('answers only for the chosen, linked child, with counts behind the What-if meter', async () => {
    const asChild = await json('GET', '/api/student/my-day', { cookie: asA(ids.Asibling) });
    assert.equal(asChild.status, 200);
    assert.equal(asChild.body.student.studentCode, 'STU2026002');
    const a = asChild.body.attendance;
    assert.equal(a.overall, Math.round((a.attended / a.total) * 1000) / 10, 'the percentage comes from the counts');
    assert.equal(a.trend.length, 30);
    assert.equal(a.trend.at(-1).pct, a.overall, 'the trend ends on the headline figure');
    assert.equal(asChild.body.latestResult.trend.length >= 2, true, 'the demo has a marks trend');
    assert.equal(whatIfAttendance(a.attended, a.total, 0), a.overall, 'missing nothing changes nothing');
    assert.equal(whatIfAttendance(30, 40, 10), 60);
    assert.equal(whatIfAttendance(0, 0, 0), null);
    assert.ok(whatIfAttendance(a.attended, a.total, 5) < a.overall);
    assert.equal((await json('GET', '/api/student/my-day', { cookie: asA(ids.B) })).status, 403);
  });
  it('its figures equal the child\'s own attendance, fees and results pages', async () => {
    const c = asA(ids.A);
    const d = (await json('GET', '/api/student/my-day', { cookie: c })).body;
    const att = (await json('GET', '/api/student/attendance', { cookie: c })).body;
    assert.equal(d.attendance.overall, att.overall);
    const fees = (await json('GET', '/api/student/fees', { cookie: c })).body;
    assert.equal(d.fees.outstanding, fees.summary.outstanding);
    const res = (await json('GET', '/api/student/results', { cookie: c })).body;
    assert.equal(d.latestResult.pct, res.exams[0].pct);
    assert.equal(d.latestResult.trend.length, res.exams.filter((e) => e.pct !== null).length);
  });
});

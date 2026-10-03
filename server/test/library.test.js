/** Library - run with `npm test` (needs `npm run db:setup` first). */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { env } from '../src/config/env.js';
import { createApp } from '../src/app.js';
import { closePool, q, withTx } from '../src/db/pool.js';
import { issueCaptchaToken } from '../src/services/captcha.service.js';

let server; let base;
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

let admin; let schoolAdmin; let tenantId; let studentId; let studentCode;
before(async () => {
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  admin = await login('demo-college', 'admin', 'ADM001', 'Admin@123');
  schoolAdmin = await login('demo-school', 'admin', 'ADM001', 'Admin@123');
  tenantId = (await withTx({ platform: true }, () => q("select id from tenants where code = 'demo-college'"))).rows[0].id;
  ({ rows: [{ id: studentId, student_code: studentCode }] } = await withTx({ tenantId }, () => q('select id, student_code from students order by student_code limit 1')));
});
after(async () => {
  await withTx({ tenantId }, () => q("delete from book_issues"));
  await withTx({ tenantId }, () => q("delete from books where title like 'Test Book%'"));
  await new Promise((r) => server.close(r));
  await closePool();
});

describe('Row Level Security (database)', () => {
  it('with no tenant context, library tables are empty; a book is invisible under another tenant', async () => {
    await withTx({}, async () => {
      assert.equal((await q('select count(*)::int as n from books')).rows[0].n, 0);
      assert.equal((await q('select count(*)::int as n from book_issues')).rows[0].n, 0);
    });
    const bookId = await withTx({ tenantId }, async () => (
      await q("insert into books (title) values ('RLS probe') returning id")
    ).rows[0].id);
    const schoolTenantId = (await withTx({ platform: true }, () => q("select id from tenants where code = 'demo-school'"))).rows[0].id;
    try {
      await withTx({ tenantId: schoolTenantId }, async () => {
        assert.equal((await q('select count(*)::int as n from books where id = $1', [bookId])).rows[0].n, 0);
      });
    } finally {
      await withTx({ tenantId }, () => q('delete from books where id = $1', [bookId]));
    }
  });
});

describe('Catalogue', () => {
  it('creates, searches, and updates a book; another institute cannot see or edit it', async () => {
    const bad = await json('POST', '/api/admin/library/books', { cookie: admin, body: { title: '' } });
    assert.equal(bad.status, 400);
    const r = await json('POST', '/api/admin/library/books', { cookie: admin, body: { title: 'Test Book One', author: 'A. Author', isbn: '111', totalCopies: 2 } });
    assert.equal(r.status, 201);
    assert.equal(r.body.book.availableCopies, 2);

    const search = await json('GET', '/api/admin/library/books?search=Test%20Book%20One', { cookie: admin });
    assert.equal(search.body.books.length, 1);
    assert.equal((await json('GET', '/api/admin/library/books?search=Test%20Book%20One', { cookie: schoolAdmin })).body.books.length, 0);
    assert.equal((await json('GET', `/api/admin/library/books/${r.body.book.id}`, { cookie: schoolAdmin })).status, 404);

    const upd = await json('PUT', `/api/admin/library/books/${r.body.book.id}`, { cookie: admin, body: { totalCopies: 5 } });
    assert.equal(upd.body.book.availableCopies, 5); // increasing total grows available by the same amount
    const shrink = await json('PUT', `/api/admin/library/books/${r.body.book.id}`, { cookie: admin, body: { totalCopies: 1 } });
    assert.equal(shrink.status, 200); // no copies on loan yet, safe to shrink

    assert.equal((await json('DELETE', `/api/admin/library/books/${r.body.book.id}`, { cookie: schoolAdmin })).status, 404);
    assert.equal((await json('DELETE', `/api/admin/library/books/${r.body.book.id}`, { cookie: admin })).status, 200);
  });
});

describe('Issue / return / fines', () => {
  let bookId;
  before(async () => {
    bookId = (await json('POST', '/api/admin/library/books', { cookie: admin, body: { title: 'Test Book Two', totalCopies: 1 } })).body.book.id;
  });

  it('issuing decrements availability; no copies left is refused', async () => {
    const issue = await json('POST', '/api/admin/library/issues', { cookie: admin, body: { bookId, borrowerType: 'student', borrowerId: studentId } });
    assert.equal(issue.status, 201);
    assert.match(issue.body.issue.dueDate, /^\d{4}-\d{2}-\d{2}$/);
    const book = await json('GET', `/api/admin/library/books/${bookId}`, { cookie: admin });
    assert.equal(book.body.book.availableCopies, 0);
    const again = await json('POST', '/api/admin/library/issues', { cookie: admin, body: { bookId, borrowerType: 'student', borrowerId: studentId } });
    assert.equal(again.status, 409);
    await json('PUT', `/api/admin/library/issues/${issue.body.issue.id}/return`, { cookie: admin });
  });

  it('returning on time has no fine; returning late calculates one', async () => {
    const issue = (await json('POST', '/api/admin/library/issues', { cookie: admin, body: { bookId, borrowerType: 'student', borrowerId: studentId } })).body.issue;
    const onTime = await json('PUT', `/api/admin/library/issues/${issue.id}/return`, { cookie: admin });
    assert.equal(Number(onTime.body.issue.fineAmount), 0);
    assert.equal((await json('PUT', `/api/admin/library/issues/${issue.id}/return`, { cookie: admin })).status, 409); // already returned

    const late = (await json('POST', '/api/admin/library/issues', { cookie: admin, body: { bookId, borrowerType: 'student', borrowerId: studentId } })).body.issue;
    await withTx({ tenantId }, () => q("update book_issues set due_date = current_date - 3 where id = $1", [late.id]));
    const overdue = await json('PUT', `/api/admin/library/issues/${late.id}/return`, { cookie: admin });
    assert.equal(Number(overdue.body.issue.fineAmount), 15); // 3 days x Rs.5

    const noFine = await json('PUT', `/api/admin/library/issues/${issue.id}/pay-fine`, { cookie: admin });
    assert.equal(noFine.status, 400); // nothing to pay
    const pay = await json('PUT', `/api/admin/library/issues/${late.id}/pay-fine`, { cookie: admin });
    assert.equal(pay.status, 200);
    assert.equal((await json('PUT', `/api/admin/library/issues/${late.id}/pay-fine`, { cookie: admin })).status, 409);
  });

  it('caps active loans per borrower, and another institute cannot issue against this book', async () => {
    const other = (await json('POST', '/api/admin/library/books', { cookie: admin, body: { title: 'Test Book Three', totalCopies: 5 } })).body.book.id;
    const issued = [];
    for (let i = 0; i < 3; i += 1) {
      const r = await json('POST', '/api/admin/library/issues', { cookie: admin, body: { bookId: other, borrowerType: 'student', borrowerId: studentId } });
      assert.equal(r.status, 201);
      issued.push(r.body.issue.id);
    }
    const fourth = await json('POST', '/api/admin/library/issues', { cookie: admin, body: { bookId: other, borrowerType: 'student', borrowerId: studentId } });
    assert.equal(fourth.status, 409);
    for (const id of issued) await json('PUT', `/api/admin/library/issues/${id}/return`, { cookie: admin });

    const crossTenant = await json('POST', '/api/admin/library/issues', { cookie: schoolAdmin, body: { bookId, borrowerType: 'student', borrowerId: studentId } });
    assert.equal(crossTenant.status, 404); // book not found under the wrong tenant
  });

  it('an employee can also borrow', async () => {
    const emp = (await withTx({ tenantId }, () => q('select id from employees limit 1'))).rows[0].id;
    const issue = await json('POST', '/api/admin/library/issues', { cookie: admin, body: { bookId, borrowerType: 'employee', borrowerId: emp } });
    assert.equal(issue.status, 201);
    assert.equal(issue.body.issue.employeeId, emp);
    await json('PUT', `/api/admin/library/issues/${issue.body.issue.id}/return`, { cookie: admin });
  });
});

describe('Student portal', () => {
  it('a student can search the catalogue and see only their own loans', async () => {
    const s = await login('demo-college', 'student', studentCode, 'Student@123');
    const cat = await json('GET', '/api/student/library/books?search=Test%20Book', { cookie: s });
    assert.equal(cat.status, 200);
    assert.ok(cat.body.books.length > 0);
    const mine = await json('GET', '/api/student/library/my-issues', { cookie: s });
    assert.equal(mine.status, 200);
    assert.ok(mine.body.issues.every((i) => i.studentId === studentId));
    const other = (await withTx({ tenantId }, () => q("select student_code from students where id != $1 limit 1", [studentId]))).rows[0].student_code;
    const s2 = await login('demo-college', 'student', other, 'Student@123');
    const mine2 = await json('GET', '/api/student/library/my-issues', { cookie: s2 });
    assert.ok(mine2.body.issues.every((i) => i.studentId !== studentId));
  });
});

describe('Library module gating', () => {
  it('can be switched off independently of other modules', async () => {
    const sa = await login('', 'super_admin', 'SA001', 'SuperAdmin@123');
    const list = (await json('GET', '/api/super-admin/tenants', { cookie: sa })).body.tenants;
    const college = list.find((t) => t.code === 'demo-college');
    await json('PUT', `/api/super-admin/tenants/${college.id}`, { cookie: sa, body: { modules: college.modules.filter((m) => m !== 'library') } });
    assert.equal((await json('GET', '/api/admin/library/books', { cookie: admin })).status, 403);
    assert.equal((await json('GET', '/api/admin/students', { cookie: admin })).status, 200);
    await json('PUT', `/api/super-admin/tenants/${college.id}`, { cookie: sa, body: { modules: college.modules } });
  });
});

/** Fees & payments - run with `npm test` (needs `npm run db:setup` first). */
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
const pdfCheck = (buf) => buf.slice(0, 5).toString('latin1') === '%PDF-';

let admin; let schoolAdmin; let courseId; let studentId; let tenantId;
before(async () => {
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  admin = await login('demo-college', 'admin', 'ADM001', 'Admin@123');
  schoolAdmin = await login('demo-school', 'admin', 'ADM001', 'Admin@123');
  tenantId = (await withTx({ platform: true }, () => q("select id from tenants where code = 'demo-college'"))).rows[0].id;
  ({ rows: [{ id: courseId }] } = await withTx({ tenantId }, () => q('select id from courses limit 1')));
  ({ rows: [{ id: studentId }] } = await withTx({ tenantId }, () => q("select id from students order by student_code limit 1")));
});
after(async () => {
  await withTx({ tenantId }, async () => {
    // Remove every trace this suite created for the seeded demo students, so a rerun without
    // reseeding starts from the same balances (payments/allocations cascade from the delete).
    await q('delete from payments where student_id in (select id from students where tenant_id = $1)', [tenantId]);
    await q('delete from student_fee_items');
    await q("delete from fee_structures where academic_year = '2099-00' or academic_year like 'test-%'");
  });
  await new Promise((r) => server.close(r));
  await closePool();
});

describe('Row Level Security (database)', () => {
  it('with no tenant context, every fee table is empty', async () => {
    await withTx({}, async () => {
      for (const t of ['fee_structures', 'fee_structure_items', 'student_fee_items', 'payments', 'payment_allocations']) {
        assert.equal((await q(`select count(*)::int as n from ${t}`)).rows[0].n, 0, `${t} leaked rows without a tenant`);
      }
    });
  });

  it('a fee item or payment for one institute\'s student is invisible under another institute\'s context, at the query level', async () => {
    const collegeStudentId = (await withTx({ tenantId }, () => q('select id from students order by student_code limit 1'))).rows[0].id;
    const schoolTenantId = (await withTx({ platform: true }, () => q("select id from tenants where code = 'demo-school'"))).rows[0].id;
    // Insert a real row directly (bypassing HTTP) so this genuinely exercises the table's own RLS -
    // not masked by a join to some other still-protected table, the way the HTTP receipt endpoint is.
    const itemId = await withTx({ tenantId }, async () => (
      await q("insert into student_fee_items (student_id, label, amount) values ($1, 'RLS probe', 1) returning id", [collegeStudentId])
    ).rows[0].id);
    try {
      await withTx({ tenantId: schoolTenantId }, async () => {
        assert.equal((await q('select count(*)::int as n from student_fee_items where id = $1', [itemId])).rows[0].n, 0);
        assert.equal((await q('select count(*)::int as n from student_fee_items where student_id = $1', [collegeStudentId])).rows[0].n, 0);
      });
      await withTx({ tenantId }, async () => {
        assert.equal((await q('select count(*)::int as n from student_fee_items where id = $1', [itemId])).rows[0].n, 1);
      });
    } finally {
      await withTx({ tenantId }, () => q('delete from student_fee_items where id = $1', [itemId]));
    }
  });

  it('a school admin cannot write a fee item for a college student even by id (RLS blocks the insert)', async () => {
    const collegeStudentId = (await withTx({ tenantId }, () => q('select id from students order by student_code limit 1'))).rows[0].id;
    const schoolTenantId = (await withTx({ platform: true }, () => q("select id from tenants where code = 'demo-school'"))).rows[0].id;
    await assert.rejects(
      withTx({ tenantId: schoolTenantId }, () => q(
        "insert into student_fee_items (student_id, label, amount) values ($1, 'Injected', 100)", [collegeStudentId],
      )),
      (e) => e.code === '23503' || e.code === '42501', // FK rejects the cross-tenant student, or RLS rejects the insert
    );
  });
});

describe('Fee structures (templates)', () => {
  it('creates a structure with items; validates course and amounts', async () => {
    const bad = await json('POST', '/api/admin/fees/structures', { cookie: admin, body: { name: 'X', courseId: '00000000-0000-0000-0000-000000000000', academicYear: '2026-27', items: [{ label: 'Tuition', amount: 1000 }] } });
    assert.equal(bad.status, 400);
    const noItems = await json('POST', '/api/admin/fees/structures', { cookie: admin, body: { name: 'X', courseId, academicYear: '2026-27', items: [] } });
    assert.equal(noItems.status, 400);
    const badAmount = await json('POST', '/api/admin/fees/structures', { cookie: admin, body: { name: 'X', courseId, academicYear: '2026-27', items: [{ label: 'Tuition', amount: -5 }] } });
    assert.equal(badAmount.status, 400);

    const r = await json('POST', '/api/admin/fees/structures', { cookie: admin, body: { name: 'Test Plan', courseId, academicYear: '2099-00', items: [{ label: 'Tuition', amount: 50000 }, { label: 'Exam Fee', amount: 2000, dueDate: '2099-01-01' }] } });
    assert.equal(r.status, 201);
    assert.equal(Number(r.body.structure.total), 52000);
    assert.equal(r.body.structure.items.length, 2);
    assert.equal(r.body.structure.assignedCount, 0);
  });

  it('another institute cannot see or delete it', async () => {
    const list = (await json('GET', '/api/admin/fees/structures', { cookie: admin })).body.structures;
    const mine = list.find((s) => s.academicYear === '2099-00');
    assert.ok(mine);
    const schoolList = (await json('GET', '/api/admin/fees/structures', { cookie: schoolAdmin })).body.structures;
    assert.ok(!schoolList.some((s) => s.id === mine.id));
    assert.equal((await json('DELETE', `/api/admin/fees/structures/${mine.id}`, { cookie: schoolAdmin })).status, 404);
  });
});

describe('Assigning a structure and recording payments', () => {
  const YEAR = `test-${Date.now()}`;
  let structureId; let sid;

  it('assigning copies items as concrete charges; double-assign is refused', async () => {
    const st = await json('POST', '/api/admin/fees/structures', { cookie: admin, body: { name: 'Payments Plan', courseId, academicYear: YEAR, items: [{ label: 'Tuition', amount: 30000 }, { label: 'Lab Fee', amount: 5000 }] } });
    structureId = st.body.structure.id;
    const assign = await json('POST', `/api/admin/fees/structures/${structureId}/assign`, { cookie: admin, body: { studentId } });
    assert.equal(assign.status, 201);
    assert.equal(assign.body.itemsCreated, 2);
    assert.equal((await json('POST', `/api/admin/fees/structures/${structureId}/assign`, { cookie: admin, body: { studentId } })).status, 409);
    const fees = await json('GET', `/api/admin/fees/students/${studentId}`, { cookie: admin });
    assert.equal(fees.body.summary.total, 35000);
    assert.equal(fees.body.summary.outstanding, 35000);
  });

  it('editing the structure afterwards does not change what the student already owes', async () => {
    await withTx({ tenantId }, () => q("update fee_structure_items set amount = 99999 where structure_id = $1 and label = 'Tuition'", [structureId]));
    const fees = await json('GET', `/api/admin/fees/students/${studentId}`, { cookie: admin });
    assert.equal(fees.body.summary.total, 35000); // unchanged
  });

  it('a partial payment marks the item partial; the balance is exact', async () => {
    const p1 = await json('POST', '/api/admin/fees/payments', { cookie: admin, body: { studentId, amount: 10000, method: 'cash' } });
    assert.equal(p1.status, 201);
    assert.match(p1.body.payment.receiptNo, /^RCPT\d{4}-\d{5}$/);
    const fees = await json('GET', `/api/admin/fees/students/${studentId}`, { cookie: admin });
    assert.equal(fees.body.summary.paid, 10000);
    assert.equal(fees.body.summary.outstanding, 25000);
    const tuition = fees.body.items.find((i) => i.label === 'Tuition');
    assert.equal(tuition.status, 'partial');
    assert.equal(Number(tuition.paid), 10000);
  });

  it('auto-allocation applies to oldest-first, and a second payment finishes it off', async () => {
    const p2 = await json('POST', '/api/admin/fees/payments', { cookie: admin, body: { studentId, amount: 25000, method: 'upi', reference: 'UPI123' } });
    assert.equal(p2.status, 201);
    const fees = await json('GET', `/api/admin/fees/students/${studentId}`, { cookie: admin });
    assert.equal(fees.body.summary.outstanding, 0);
    assert.ok(fees.body.items.every((i) => i.status === 'paid'));
  });

  it('overpaying without explicit allocations is refused; explicit allocations must sum to the amount', async () => {
    const s2 = (await json('POST', '/api/admin/fees/structures', { cookie: admin, body: { name: 'Second', courseId, academicYear: `${YEAR}-b`, items: [{ label: 'Fee A', amount: 1000 }] } })).body.structure.id;
    const { rows: [{ id: sid2 }] } = await withTx({ tenantId }, () => q(`select id from students where id != $1 order by student_code limit 1`, [studentId]));
    sid = sid2;
    await json('POST', `/api/admin/fees/structures/${s2}/assign`, { cookie: admin, body: { studentId: sid } });
    const over = await json('POST', '/api/admin/fees/payments', { cookie: admin, body: { studentId: sid, amount: 5000, method: 'cash' } });
    assert.equal(over.status, 400);
    const itemId = (await json('GET', `/api/admin/fees/students/${sid}`, { cookie: admin })).body.items[0].id;
    const badAlloc = await json('POST', '/api/admin/fees/payments', { cookie: admin, body: { studentId: sid, amount: 500, method: 'cash', allocations: [{ feeItemId: itemId, amount: 999 }] } });
    assert.equal(badAlloc.status, 400);
    const overAlloc = await json('POST', '/api/admin/fees/payments', { cookie: admin, body: { studentId: sid, amount: 500, method: 'cash', allocations: [{ feeItemId: itemId, amount: 2000 }] } });
    assert.equal(overAlloc.status, 400); // exceeds item balance even though it matches the payment total
  });

  it('a manual one-off charge can be added and waived, but not once paid', async () => {
    await json('POST', `/api/admin/fees/students/${sid}/items`, { cookie: admin, body: { label: 'Late fine', amount: 200 } });
    const fees1 = await json('GET', `/api/admin/fees/students/${sid}`, { cookie: admin });
    const fine = fees1.body.items.find((i) => i.label === 'Late fine');
    assert.ok(fine);
    const noReason = await json('PUT', `/api/admin/fees/items/${fine.id}/waive`, { cookie: admin, body: {} });
    assert.equal(noReason.status, 400);
    const waived = await json('PUT', `/api/admin/fees/items/${fine.id}/waive`, { cookie: admin, body: { reason: 'Goodwill gesture' } });
    assert.equal(waived.status, 200);
    assert.equal(waived.body.items.find((i) => i.id === fine.id).status, 'waived');

    // paying off the remaining structure item, then trying to waive it should fail (already paid)
    const remaining = fees1.body.items.find((i) => i.label === 'Fee A');
    await json('POST', '/api/admin/fees/payments', { cookie: admin, body: { studentId: sid, amount: Number(remaining.amount) - Number(remaining.paid), method: 'cash' } });
    const paidItem = (await json('GET', `/api/admin/fees/students/${sid}`, { cookie: admin })).body.items.find((i) => i.id === remaining.id);
    assert.equal(paidItem.status, 'paid');
    assert.equal((await json('PUT', `/api/admin/fees/items/${paidItem.id}/waive`, { cookie: admin, body: { reason: 'x' } })).status, 409);
  });
});

describe('Receipts', () => {
  it('generates a real PDF; a student can download only their own; another institute cannot', async () => {
    const list = (await json('GET', '/api/admin/fees/payments', { cookie: admin, body: undefined })).body.payments;
    const mine = list.find((p) => p.studentId === studentId);
    const r = await fetch(`${base}/api/admin/fees/payments/${mine.id}/receipt.pdf`, { headers: { cookie: admin } });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'application/pdf');
    assert.ok(pdfCheck(Buffer.from(await r.arrayBuffer())));
    assert.equal((await fetch(`${base}/api/admin/fees/payments/${mine.id}/receipt.pdf`, { headers: { cookie: schoolAdmin } })).status, 404);

    const { rows: [u] } = await withTx({ tenantId }, () => q('select login_id as "loginId" from users where student_id = $1', [studentId]));
    const s = await login('demo-college', 'student', u.loginId, 'Student@123');
    const own = await fetch(`${base}/api/student/fees/payments/${mine.id}/receipt.pdf`, { headers: { cookie: s } });
    assert.equal(own.status, 200);
    const mySummary = await json('GET', '/api/student/fees', { cookie: s });
    assert.equal(mySummary.body.summary.outstanding, 0);

    // a different student cannot fetch this receipt by guessing/reusing the id
    const { rows: [other] } = await withTx({ tenantId }, () => q("select login_id as \"loginId\" from users where role='student' and student_id != $1 limit 1", [studentId]));
    const s2 = await login('demo-college', 'student', other.loginId, 'Student@123');
    assert.equal((await fetch(`${base}/api/student/fees/payments/${mine.id}/receipt.pdf`, { headers: { cookie: s2 } })).status, 404);
  });
});

describe('Fees module gating', () => {
  it('can be switched off independently of Students', async () => {
    const sa = await login('', 'super_admin', 'SA001', 'SuperAdmin@123');
    const list = (await json('GET', '/api/super-admin/tenants', { cookie: sa })).body.tenants;
    const college = list.find((t) => t.code === 'demo-college');
    await json('PUT', `/api/super-admin/tenants/${college.id}`, { cookie: sa, body: { modules: college.modules.filter((m) => m !== 'fees') } });
    assert.equal((await json('GET', '/api/admin/fees/structures', { cookie: admin })).status, 403);
    assert.equal((await json('GET', '/api/admin/students', { cookie: admin })).status, 200);
    await json('PUT', `/api/super-admin/tenants/${college.id}`, { cookie: sa, body: { modules: college.modules } });
  });
});

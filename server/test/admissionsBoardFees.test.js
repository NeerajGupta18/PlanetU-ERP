/**
 * Day 3: the admissions board (enquiry to enrolled) and the fee cycle - run with `npm test` (needs `npm run db:setup` first).
 * The "done when" path: a student is admitted, pays a fee at enrolment, and the receipt carries the institute's logo.
 * Also: concessions, late fees, reminders with a ready message, and the day-end summary.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

process.env.PUBLIC_CREATE_LIMIT = '1000';
process.env.PUBLIC_LOOKUP_LIMIT = '1000';

const { env } = await import('../src/config/env.js');
const { createApp } = await import('../src/app.js');
const { closePool, q, withTx } = await import('../src/db/pool.js');
const { issueCaptchaToken } = await import('../src/services/captcha.service.js');
const { reminderText, whatsappNumber } = await import('../src/services/fees.service.js');

const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(100, 66)]);
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const CODE = `test-day3-${Date.now().toString(36)}`;
let server; let base; let tenantId; let courseId; let admin; let otherAdmin;

const json = async (method, path, { cookie, body } = {}) => {
  const r = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let b = null; try { b = await r.json(); } catch { /* empty */ }
  return { status: r.status, body: b, headers: r.headers };
};
const cookieOf = (r) => r.headers.getSetCookie().map((c) => c.split(';')[0]).find((c) => c.startsWith(`${env.COOKIE_NAME}=`));
async function login(tenantCode, role, identifier, password) {
  const r = await json('POST', '/api/auth/login', { body: { tenantCode, role, identifier, password, captchaToken: issueCaptchaToken() } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return cookieOf(r);
}
const fileUp = (path, cookie, field, bytes, name, extra = {}) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(extra)) f.set(k, v);
  f.set(field, new Blob([bytes], { type: name.endsWith('.png') ? 'image/png' : 'application/pdf' }), name);
  return fetch(`${base}${path}`, { method: 'POST', headers: { cookie }, body: f });
};
const pdfOf = async (path, cookie) => {
  const r = await fetch(`${base}${path}`, { headers: { cookie } });
  assert.equal(r.status, 200);
  const buf = Buffer.from(await r.arrayBuffer());
  assert.equal(buf.subarray(0, 5).toString(), '%PDF-');
  return buf.toString('latin1');
};
const email = () => `d3${Math.random().toString(36).slice(2, 9)}@example.com`;
const FORM = {
  dob: '2006-05-05', gender: 'Female', address: '12 Park Road, Pune',
  guardian: { name: 'Ramesh Rao', relation: 'Father', phone: '98765 43210', email: '' },
};
const board = async () => (await json('GET', '/api/admin/admissions/board', { cookie: admin })).body;
const stageOf = async (id) => (await board()).cards.find((c) => c.id === id)?.stage;

before(async () => {
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  const sa = await login('', 'super_admin', 'SA001', 'SuperAdmin@123');
  const t = await json('POST', '/api/super-admin/tenants', { cookie: sa, body: { code: CODE, name: 'Day Three College', type: 'college', admin: { name: 'Adm', email: `a@${CODE}.example` } } });
  assert.equal(t.status, 201, JSON.stringify(t.body));
  tenantId = t.body.tenant.id;
  await withTx({ tenantId }, async () => {
    courseId = (await q("insert into courses (code, name, full_name, years) values ('BCOM', 'B.Com', 'Bachelor of Commerce', 3) returning id")).rows[0].id;
  });
  const first = await login(CODE, 'admin', 'ADM001', t.body.admin.temporaryPassword);
  const ch = await json('POST', '/api/auth/change-password', { cookie: first, body: { currentPassword: t.body.admin.temporaryPassword, newPassword: 'Changed@12345' } });
  admin = cookieOf(ch);
  otherAdmin = await login('demo-school', 'admin', 'ADM001', 'Admin@123');
});
after(async () => {
  await withTx({ platform: true }, () => q("delete from tenants where code like 'test-day3-%'"));
  await new Promise((r) => server.close(r));
  await closePool();
});

describe('Admissions board: enquiry to enrolled', () => {
  let enquiry; let appId; let enrolled;

  it('an enquiry needs only a course, a name and an email, lands in the Enquiry column and gets a ready form link', async () => {
    assert.equal((await json('POST', '/api/admin/admissions/enquiries', { cookie: admin, body: { courseId, name: 'Asha' } })).status, 400);
    const r = await json('POST', '/api/admin/admissions/enquiries', { cookie: admin, body: { courseId, name: 'Asha Rao', email: email(), phone: '9876543210' } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    enquiry = r.body;
    assert.ok(enquiry.invite.accessCode);
    assert.match(enquiry.invite.message, /Application number: APP/);
    assert.match(enquiry.invite.whatsapp, /^https:\/\/wa\.me\/919876543210\?text=/);
    assert.equal(await stageOf(enquiry.id), 'enquiry');
    // the code that was sent works on the public status page
    const look = await json('POST', `/api/public/${CODE}/admissions/applications/lookup`, { body: { applicationNo: enquiry.applicationNo, accessCode: enquiry.invite.accessCode } });
    assert.equal(look.status, 200);
    const again = await json('POST', `/api/admin/admissions/enquiries/${enquiry.id}/form-link`, { cookie: admin });
    assert.equal(again.status, 200);
    assert.notEqual(again.body.invite.accessCode, enquiry.invite.accessCode);
  });

  it('the office completes the enquiry at the desk: the same application moves to Application, not a second one', async () => {
    const pre = await json('GET', `/api/admin/admissions/enquiries/${enquiry.id}`, { cookie: admin });
    assert.equal(pre.status, 200);
    assert.equal(pre.body.enquiry.name, 'Asha Rao');
    const r = await json('POST', '/api/admin/admissions/walk-in', { cookie: admin, body: { ...pre.body.enquiry, ...FORM, enquiryId: enquiry.id } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    appId = r.body.application.id;
    assert.equal(appId, enquiry.id);
    assert.equal(r.body.application.status, 'submitted');
    assert.equal(await stageOf(appId), 'application');
    // completing it twice is refused
    assert.equal((await json('POST', '/api/admin/admissions/walk-in', { cookie: admin, body: { ...pre.body.enquiry, ...FORM, enquiryId: enquiry.id } })).status, 409);
  });

  it('moves to Documents checked once every required document is verified, then to Offer when accepted', async () => {
    for (const t of ['photo', 'id_proof', 'marksheet']) {
      assert.equal((await fileUp(`/api/admin/admissions/${appId}/documents`, admin, 'file', t === 'photo' ? PNG : PDF, `${t}.${t === 'photo' ? 'png' : 'pdf'}`, { docType: t })).status, 201);
    }
    assert.equal(await stageOf(appId), 'documents');
    assert.equal((await json('POST', `/api/admin/admissions/${appId}/decision`, { cookie: admin, body: { decision: 'accept' } })).status, 200);
    assert.equal(await stageOf(appId), 'offer');
  });

  it('the Enrol screen shows the class fee plan and divisions, and asks for a division when the class has them', async () => {
    const plan = await json('POST', '/api/admin/fees/structures', { cookie: admin, body: { name: 'B.Com Year 1', courseId, academicYear: '2026-27', items: [{ label: 'Tuition', amount: 30000, dueDate: '2099-06-30' }, { label: 'Exam fee', amount: 2000, dueDate: '2099-11-30' }] } });
    assert.equal(plan.status, 201);
    assert.equal((await json('PUT', `/api/admin/setup/divisions/${courseId}`, { cookie: admin, body: { divisions: ['A', 'B'] } })).status, 200);
    const p = await json('GET', `/api/admin/admissions/${appId}/enrol-plan`, { cookie: admin });
    assert.deepEqual(p.body.divisions, ['A', 'B']);
    assert.equal(p.body.feePlan.total, 32000);
    const noDiv = await json('POST', `/api/admin/admissions/${appId}/enroll`, { cookie: admin, body: {} });
    assert.equal(noDiv.status, 400);
    assert.match(noDiv.body.message, /division/);
    const tooMuch = await json('POST', `/api/admin/admissions/${appId}/enroll`, { cookie: admin, body: { division: 'A', payment: { amount: 99999, method: 'cash' } } });
    assert.equal(tooMuch.status, 400);
    assert.match(tooMuch.body.message, /adds up to/);
    // nothing was half-saved by the refused tries
    assert.equal(await stageOf(appId), 'offer');
  });

  it('enrolling with a fee creates the student in the class and division, charges the plan, takes the fee and gives a receipt', async () => {
    const r = await json('POST', `/api/admin/admissions/${appId}/enroll`, { cookie: admin, body: { division: 'B', payment: { amount: 10000, method: 'upi', reference: 'UTR123' } } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    enrolled = r.body;
    assert.match(enrolled.student.prn, /^PRN/);
    assert.equal(enrolled.fees.charged, 2);
    assert.equal(enrolled.payment.amount, 10000);
    assert.equal(enrolled.parent.invited, false); // no guardian email on this application
    assert.match(enrolled.parent.reason, /guardian email/);
    const st = await withTx({ tenantId }, () => q('select course_id, section from students where id = $1', [enrolled.student.id]));
    assert.equal(st.rows[0].course_id, courseId);
    assert.equal(st.rows[0].section, 'B');
    const ledger = await json('GET', `/api/admin/fees/students/${enrolled.student.id}`, { cookie: admin });
    assert.equal(ledger.body.summary.total, 32000);
    assert.equal(ledger.body.summary.outstanding, 22000);
    assert.equal(await stageOf(appId), 'enrolled');
  });

  it('the receipt shows the institute logo once one is uploaded in setup', async () => {
    const before0 = await pdfOf(`/api/admin/fees/payments/${enrolled.payment.id}/receipt.pdf`, admin);
    assert.doesNotMatch(before0, /\/Subtype \/Image/);
    assert.equal((await fileUp('/api/admin/setup/logo', admin, 'file', PNG, 'logo.png')).status, 200);
    const withLogo = await pdfOf(`/api/admin/fees/payments/${enrolled.payment.id}/receipt.pdf`, admin);
    assert.match(withLogo, /\/Subtype \/Image/);
    assert.match(withLogo, /Receipt RCPT/);
  });

  it('a student enrolled without paying sits in Enrolment fee, and a parent with an email is invited', async () => {
    const r = await json('POST', '/api/admin/admissions/walk-in', { cookie: admin, body: { courseId, name: 'Ravi Kumar', email: email(), phone: '9000000031', ...FORM, guardian: { ...FORM.guardian, email: email() } } });
    const id = r.body.application.id;
    for (const t of ['photo', 'id_proof', 'marksheet']) await fileUp(`/api/admin/admissions/${id}/documents`, admin, 'file', PDF, `${t}.pdf`, { docType: t });
    await json('POST', `/api/admin/admissions/${id}/decision`, { cookie: admin, body: { decision: 'accept' } });
    const e = await json('POST', `/api/admin/admissions/${id}/enroll`, { cookie: admin, body: { division: 'A' } });
    assert.equal(e.status, 200, JSON.stringify(e.body));
    assert.equal(e.body.payment, null);
    assert.equal(e.body.parent.invited, true);
    assert.equal(await stageOf(id), 'fee');
  });

  it('an unwanted enquiry can be removed; a submitted application cannot be removed that way', async () => {
    const r = await json('POST', '/api/admin/admissions/enquiries', { cookie: admin, body: { courseId, name: 'Wrong Number', email: email(), sendLink: false } });
    assert.equal(r.body.invite, null);
    assert.equal((await json('DELETE', `/api/admin/admissions/enquiries/${r.body.id}`, { cookie: admin })).status, 200);
    assert.equal((await json('DELETE', `/api/admin/admissions/enquiries/${appId}`, { cookie: admin })).status, 409);
  });

  it('counts every column, and another institute sees none of these cards', async () => {
    const b = await board();
    for (const k of ['enquiry', 'application', 'documents', 'decision', 'offer', 'fee', 'enrolled', 'rejected']) assert.equal(typeof b.counts[k], 'number');
    const other = (await json('GET', '/api/admin/admissions/board', { cookie: otherAdmin })).body;
    assert.ok(!other.cards.some((c) => c.id === appId));
    assert.equal((await json('GET', `/api/admin/admissions/${appId}/enrol-plan`, { cookie: otherAdmin })).status, 404);
  });
});

describe('Fee cycle: concession, late fee, reminders, day-end', () => {
  let studentId; let items;

  before(async () => {
    studentId = (await withTx({ tenantId }, () => q("select id from students where name = 'Ravi Kumar'"))).rows[0].id;
    // make the tuition overdue, so late fees and reminders have something to find
    await withTx({ tenantId }, () => q("update student_fee_items set due_date = current_date - 10 where student_id = $1 and label = 'Tuition'", [studentId]));
    items = (await json('GET', `/api/admin/fees/students/${studentId}`, { cookie: admin })).body.items;
  });

  it('a concession takes part of a charge off, keeps a waived line beside it, and is not counted as owed', async () => {
    const tuition = items.find((i) => i.label === 'Tuition');
    assert.equal((await json('PUT', `/api/admin/fees/items/${tuition.id}/concession`, { cookie: admin, body: { amount: 5000 } })).status, 400);
    assert.equal((await json('PUT', `/api/admin/fees/items/${tuition.id}/concession`, { cookie: admin, body: { amount: 50000, reason: 'Merit' } })).status, 400);
    const r = await json('PUT', `/api/admin/fees/items/${tuition.id}/concession`, { cookie: admin, body: { amount: 5000, reason: 'Merit scholarship' } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(Number(r.body.items.find((i) => i.id === tuition.id).amount), 25000);
    const line = r.body.items.find((i) => i.label === 'Concession: Tuition');
    assert.equal(line.status, 'waived');
    assert.equal(r.body.summary.total, 27000);
    assert.equal(r.body.summary.outstanding, 27000);
  });

  it('late fees: preview first, then one per overdue charge, never twice', async () => {
    const pre = await json('POST', '/api/admin/fees/late-fees', { cookie: admin, body: { courseId, amount: 200, preview: true } });
    assert.equal(pre.status, 200);
    assert.equal(pre.body.applied, false);
    assert.equal(pre.body.charges, 1);
    const go = await json('POST', '/api/admin/fees/late-fees', { cookie: admin, body: { courseId, amount: 200 } });
    assert.equal(go.body.applied, true);
    assert.equal(go.body.total, 200);
    const again = await json('POST', '/api/admin/fees/late-fees', { cookie: admin, body: { courseId, amount: 200 } });
    assert.equal(again.body.charges, 0);
    const ledger = (await json('GET', `/api/admin/fees/students/${studentId}`, { cookie: admin })).body;
    assert.ok(ledger.items.some((i) => i.label === 'Late fee: Tuition' && Number(i.amount) === 200));
  });

  it('reminders come with a ready message and a WhatsApp link, and send to the student and parent inboxes', async () => {
    const r = await json('GET', `/api/admin/fees/reminders?courseId=${courseId}&overdue=1`, { cookie: admin });
    assert.equal(r.status, 200);
    const mine = r.body.students.find((s) => s.id === studentId);
    assert.ok(mine);
    assert.match(mine.message, /^Dear Ramesh Rao, This is a reminder from Day Three College\./);
    assert.match(mine.message, /overdue since/);
    assert.match(mine.whatsapp, /^https:\/\/wa\.me\/919876543210/);
    const send = await json('POST', '/api/admin/fees/reminders', { cookie: admin, body: { studentIds: [studentId], courseId, overdueOnly: true } });
    assert.equal(send.body.sent, 1);
    const { rows } = await withTx({ tenantId }, () => q(
      "select count(*)::int as n from user_notifications where kind = 'fees' and title like '%overdue%'",
    ));
    assert.ok(rows[0].n >= 2, 'the student and the linked parent both get it');
    assert.equal((await json('POST', '/api/admin/fees/reminders', { cookie: admin, body: { studentIds: [] } })).status, 400);
  });

  it('the message and WhatsApp number helpers', () => {
    assert.equal(whatsappNumber('098765 43210'), '');
    assert.equal(whatsappNumber('98765-43210'), '919876543210');
    assert.equal(whatsappNumber('+91 98765 43210'), '919876543210');
    const m = reminderText({ institute: 'X', guardianName: '', studentName: 'A', studentCode: 'P1', outstanding: 500, overdue: 0, link: 'L' });
    assert.match(m, /^Dear Parent, .*Rs\. 500 of fees for A \(P1\) is due\./);
  });

  it('day-end summary: today\'s receipts by method and by who took them, also as a PDF', async () => {
    await json('POST', '/api/admin/fees/payments', { cookie: admin, body: { studentId, amount: 1000, method: 'cash' } });
    const d = await json('GET', '/api/admin/fees/day-end', { cookie: admin });
    assert.equal(d.status, 200);
    assert.ok(d.body.count >= 2);
    assert.equal(d.body.total, d.body.byMethod.reduce((a, m) => a + m.amount, 0));
    assert.ok(d.body.byMethod.some((m) => m.key === 'upi' && m.amount === 10000));
    assert.ok(d.body.byMethod.some((m) => m.key === 'cash'));
    assert.equal(d.body.byStaff[0].label, 'Adm');
    const pdf = await pdfOf('/api/admin/fees/day-end?format=pdf', admin);
    assert.match(pdf, /Day-end fee summary/);
    assert.equal((await json('GET', '/api/admin/fees/day-end?date=2026-02-30', { cookie: admin })).status, 400);
    const other = (await json('GET', '/api/admin/fees/day-end', { cookie: otherAdmin })).body;
    assert.ok(!other.receipts.some((x) => x.studentName === 'Ravi Kumar'));
  });

  it('the summary counts students of a class with a fee plan who have no fees yet (the Assign step)', async () => {
    await withTx({ tenantId }, () => q("insert into students (student_code, enrollment_no, name, email, course_id, semester, batch, status) values ('T-NEW', 'T-NEW', 'New Kid', 'newkid@example.com', $1, 1, '2026', 'Active')", [courseId]));
    const s = (await json('GET', '/api/admin/fees/summary', { cookie: admin })).body;
    assert.equal(s.unassigned, 1);
  });
});

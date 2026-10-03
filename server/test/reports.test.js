/** Reports & exports - run with `npm test` (needs `npm run db:setup` first). */
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { after, before, describe, it } from 'node:test';
import { env } from '../src/config/env.js';
import { createApp } from '../src/app.js';
import { closePool, q, withTx } from '../src/db/pool.js';
import { issueCaptchaToken } from '../src/services/captcha.service.js';
import { buildXlsx, colName, excelSerial } from '../src/services/xlsx.js';
import { createZip, crc32 } from '../src/services/zip.js';
import { toISO } from '../src/utils/dates.js';

let server; let base;
async function login(tenantCode, role, identifier, password) {
  const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tenantCode, role, identifier, password, captchaToken: issueCaptchaToken() }) });
  assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
  return r.headers.getSetCookie().map((c) => c.split(';')[0]).find((c) => c.startsWith(`${env.COOKIE_NAME}=`));
}
const call = async (method, path, { cookie, body } = {}) => {
  const r = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let b = null; try { b = await r.clone().json(); } catch { /* not json */ }
  return { status: r.status, body: b, res: r };
};

/** Reads a zip back (central directory), enough to verify the .xlsx we write. */
function unzip(buf) {
  const files = {};
  let end = buf.length - 22;
  while (end >= 0 && buf.readUInt32LE(end) !== 0x06054b50) end -= 1;
  assert.ok(end >= 0, 'end of central directory present');
  const count = buf.readUInt16LE(end + 10); let p = buf.readUInt32LE(end + 16);
  for (let i = 0; i < count; i += 1) {
    assert.equal(buf.readUInt32LE(p), 0x02014b50);
    const method = buf.readUInt16LE(p + 10); const crc = buf.readUInt32LE(p + 16); const csize = buf.readUInt32LE(p + 20); const usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28); const elen = buf.readUInt16LE(p + 30); const clen = buf.readUInt16LE(p + 32); const off = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nlen).toString('utf8');
    const lnlen = buf.readUInt16LE(off + 26); const lelen = buf.readUInt16LE(off + 28);
    const raw = buf.subarray(off + 30 + lnlen + lelen, off + 30 + lnlen + lelen + csize);
    const data = method === 8 ? zlib.inflateRawSync(raw) : raw;
    assert.equal(data.length, usize, `${name}: size`);
    assert.equal(crc32(data), crc, `${name}: crc`);
    files[name] = data.toString('utf8');
    p += 46 + nlen + elen + clen;
  }
  return files;
}
const bytes = async (r) => Buffer.from(await r.res.arrayBuffer());
const pdfPages = (buf) => (buf.toString('latin1').match(/\/Type \/Page(?!s)/g) || []).length;

/* ================================================================ pure writers */
describe('Excel writer (no database)', () => {
  it('numbers columns the way spreadsheets do, and converts dates to serials', () => {
    assert.deepEqual([0, 25, 26, 27, 701, 702].map(colName), ['A', 'Z', 'AA', 'AB', 'ZZ', 'AAA']);
    assert.equal(excelSerial('1970-01-01'), 25569);
    assert.equal(excelSerial('2026-10-02'), 46297);
    assert.equal(excelSerial('nonsense'), null);
  });

  it('writes a valid package: every part present, CRCs match, sheet names made safe and unique', () => {
    const buf = buildXlsx([
      { name: 'Fees [2026]: all/any?', columns: [{ header: 'Name' }, { header: 'Amount', type: 'money' }, { header: 'Day', type: 'date' }], rows: [{ Name: 'x' }, ['A & B <c>', 12.5, '2026-03-14'], ['=SUM(1)', null, null]] },
      { name: 'Fees [2026]: all/any?', columns: [{ header: 'Only' }], rows: [] },
    ]);
    const f = unzip(buf);
    assert.deepEqual(Object.keys(f).sort(), ['[Content_Types].xml', '_rels/.rels', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml']);
    assert.match(f['xl/workbook.xml'], /name="Fees 2026 all any"/);
    assert.match(f['xl/workbook.xml'], /name="Fees 2026 all any 2"/, 'a duplicate name is made unique');
    const s1 = f['xl/worksheets/sheet1.xml'];
    assert.match(s1, /<pane ySplit="1"/, 'header row frozen');
    assert.match(s1, /<autoFilter ref="A1:C4"\/>/);
    assert.match(s1, /A &amp; B &lt;c&gt;/, 'special characters escaped');
    assert.match(s1, /<c r="C3" s="2"><v>46095<\/v><\/c>/, 'date stored as a serial with the date style');
    assert.match(s1, /<c r="B3" s="3"><v>12.5<\/v><\/c>/, 'money stored as a number');
    assert.match(s1, /t="inlineStr"><is><t xml:space="preserve">=SUM\(1\)<\/t>/, 'a formula-looking value stays literal text');
  });

  it('drops characters XML forbids instead of producing a file Excel calls corrupt', () => {
    const f = unzip(buildXlsx([{ name: 'S', columns: [{ header: 'H' }], rows: [['a\u0001b\u000Bc']] }]));
    assert.match(f['xl/worksheets/sheet1.xml'], />abc</);
  });

  it('zip writer round-trips empty, tiny and compressible data', () => {
    const big = 'abc'.repeat(50000);
    const f = unzip(createZip([{ name: 'a.txt', data: '' }, { name: 'dir/b.txt', data: 'hi' }, { name: 'c.txt', data: big }]));
    assert.deepEqual([f['a.txt'], f['dir/b.txt'], f['c.txt'].length], ['', 'hi', 150000]);
  });
});

/* ================================================================ fixtures */
let admin; let schoolAdmin; let studentCookie; let empCookie; let tenantId; let schoolTenantId;
let courseId; let otherCourseId; let examId; const ids = {};
const TODAY = toISO(new Date());
const yesterday = toISO(new Date(Date.now() - 86400000));
const tomorrow = toISO(new Date(Date.now() + 86400000));
const rep = (key, qs = '', cookie = admin) => call('GET', `/api/admin/reports/${key}${qs ? `?${qs}` : ''}`, { cookie });

before(async () => {
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  admin = await login('demo-college', 'admin', 'ADM001', 'Admin@123');
  schoolAdmin = await login('demo-school', 'admin', 'ADM001', 'Admin@123');
  studentCookie = await login('demo-college', 'student', 'STU2026001', 'Student@123');
  empCookie = await login('demo-college', 'employee', 'EMP001', 'Employee@123');
  tenantId = (await withTx({ platform: true }, () => q("select id from tenants where code = 'demo-college'"))).rows[0].id;
  schoolTenantId = (await withTx({ platform: true }, () => q("select id from tenants where code = 'demo-school'"))).rows[0].id;

  await withTx({ tenantId }, async () => {
    courseId = (await q("insert into courses (code, name) values ('REPTEST', 'Report Test Course') returning id")).rows[0].id;
    otherCourseId = (await q("insert into courses (code, name) values ('REPOTH', 'Report Other Course') returning id")).rows[0].id;
    for (const [key, code, name, roll, cid, status] of [
      ['a', 'REP-A', '=Anita Formula', '1', courseId, 'Active'], ['b', 'REP-B', 'Bilal, Comma "Quote"', '2', courseId, 'Active'],
      ['c', 'REP-C', 'Chitra Dues', '3', courseId, 'Active'], ['d', 'REP-D', 'Dev Elsewhere', '1', otherCourseId, 'Alumni'],
    ]) {
      ids[key] = (await q(
        "insert into students (student_code, roll_no, name, email, course_id, semester, status) values ($1, $2, $3, $4, $5, 2, $6) returning id",
        [code, roll, name, `${code.toLowerCase()}@reptest.example`, cid, status],
      )).rows[0].id;
    }
    // Submitted attendance: A 3/4 (75%), B 1/4 (25%), C 4/4 (100%) in Maths; A also 1/2 in Physics
    const session = async (subject, date, marks) => {
      const sid = (await q("insert into attendance_sessions (on_date, course_id, subject, start_time, end_time, status) values ($1, $2, $3, '09:00', '10:00', 'submitted') returning id", [date, courseId, subject])).rows[0].id;
      for (const [k, st] of Object.entries(marks)) await q('insert into attendance_records (session_id, student_id, status) values ($1, $2, $3)', [sid, ids[k], st]);
    };
    await session('Maths', '2026-01-05', { a: 'present', b: 'present', c: 'present' });
    await session('Maths', '2026-01-06', { a: 'late', b: 'absent', c: 'present' });
    await session('Maths', '2026-01-07', { a: 'present', b: 'absent', c: 'present' });
    await session('Maths', '2026-02-10', { a: 'absent', b: 'absent', c: 'present' });
    await session('Physics', '2026-01-08', { a: 'present' });
    await session('Physics', '2026-01-09', { a: 'absent' });
    const draft = (await q("insert into attendance_sessions (on_date, course_id, subject, start_time, end_time, status) values ('2026-01-20', $1, 'Maths', '09:00', '10:00', 'draft') returning id", [courseId])).rows[0].id;
    await q("insert into attendance_records (session_id, student_id, status) values ($1, $2, 'absent')", [draft, ids.a]); // a draft must never count
  });

  // Fees through the real API: A owes 10,000 (paid 4,000 in two payments), B owes 5,000 overdue (paid nothing), C owes 2,000 fully paid
  const item = (sid, label, amount, dueDate) => call('POST', `/api/admin/fees/students/${sid}/items`, { cookie: admin, body: { label, amount, dueDate } });
  assert.equal((await item(ids.a, 'Tuition', 10000, '2999-01-01')).status, 201);
  assert.equal((await item(ids.b, 'Tuition', 5000, '2020-01-01')).status, 201);
  assert.equal((await item(ids.c, 'Lab fee', 2000, '2999-01-01')).status, 201);
  const pay = (sid, amount, method, reference = '') => call('POST', '/api/admin/fees/payments', { cookie: admin, body: { studentId: sid, amount, method, reference } });
  assert.equal((await pay(ids.a, 1500, 'cash')).status, 201);
  assert.equal((await pay(ids.a, 2500, 'upi', 'UPI-REF-9')).status, 201);
  assert.equal((await pay(ids.c, 2000, 'bank_transfer', 'NEFT1')).status, 201);

  const ex = await call('POST', '/api/admin/exams', { cookie: admin, body: { courseId, name: 'Report Exam', semester: 2, papers: [{ subject: 'Maths', maxMarks: 100, passMarks: 40, credits: 2 }] } });
  assert.equal(ex.status, 201, JSON.stringify(ex.body));
  examId = ex.body.exam.id;
  const paperId = ex.body.papers[0].id;
  const m = await call('PUT', `/api/admin/exams/${examId}/papers/${paperId}/marks`, { cookie: admin, body: { entries: [{ studentId: ids.a, marks: 80 }, { studentId: ids.b, absent: true }, { studentId: ids.c, marks: 35 }], submit: true } });
  assert.equal(m.status, 200, JSON.stringify(m.body));
});

after(async () => {
  try {
    await withTx({ tenantId }, async () => {
      await q("delete from notifications where to_email like '%@reptest.example'");
      await q("delete from students where student_code like 'REP-%'");
      await q("delete from courses where code in ('REPTEST', 'REPOTH')");
    });
  } finally {
    await new Promise((r) => server.close(r));
    await closePool();
  }
});

/* ================================================================ access + catalogue */
describe('Access and catalogue', () => {
  it('only admins may run or list reports', async () => {
    for (const cookie of [studentCookie, empCookie]) {
      assert.equal((await call('GET', '/api/admin/reports', { cookie })).status, 403);
      assert.equal((await rep('students', 'format=xlsx', cookie)).status, 403);
    }
    assert.equal((await call('GET', '/api/admin/reports')).status, 401);
  });

  it('lists the reports with their filters, and omits ones whose module is off for the institute', async () => {
    const r = await call('GET', '/api/admin/reports', { cookie: admin });
    assert.equal(r.status, 200);
    const keys = r.body.reports.map((x) => x.key);
    assert.deepEqual(keys, ['students', 'employees', 'fee-collection', 'fee-dues', 'attendance', 'attendance-subject', 'learning-credits', 'internal-marks', 'exam-results']);
    assert.ok(r.body.reports.find((x) => x.key === 'exam-results').params[0].required);
    assert.ok(r.body.reports.every((x) => x.title && x.description && x.group && Array.isArray(x.params)));
    assert.ok(r.body.reports.every((x) => !('run' in x)), 'internals never leak');
  });

  it('a switched-off module hides its reports and blocks them by URL', async () => {
    const original = (await withTx({ platform: true }, () => q('select modules from tenants where id = $1', [schoolTenantId]))).rows[0].modules;
    try {
      await withTx({ platform: true }, () => q("update tenants set modules = array_remove(modules, 'fees') where id = $1", [schoolTenantId]));
      const cat = await call('GET', '/api/admin/reports', { cookie: schoolAdmin });
      assert.ok(!cat.body.reports.some((x) => x.key.startsWith('fee-')));
      assert.ok(cat.body.reports.some((x) => x.key === 'students'));
      const blocked = await rep('fee-collection', '', schoolAdmin);
      assert.equal(blocked.status, 403);
      assert.match(blocked.body.message, /module/);
    } finally {
      await withTx({ platform: true }, () => q('update tenants set modules = $1 where id = $2', [original, schoolTenantId]));
    }
  });

  it('unknown report, unknown format and bad filters are clean errors', async () => {
    assert.equal((await rep('nope')).status, 404);
    assert.equal((await rep('students', 'format=docx')).status, 400);
    assert.equal((await rep('students', 'courseId=not-a-uuid')).status, 400);
    assert.equal((await rep('students', 'semester=0')).status, 400);
    assert.equal((await rep('students', 'status=Retired')).status, 400);
    assert.equal((await rep('fee-collection', 'from=2026-02-30')).status, 400);
    assert.equal((await rep('fee-collection', 'from=2026-03-02&to=2026-03-01')).status, 400);
    assert.equal((await rep('fee-collection', 'method=barter')).status, 400);
    assert.equal((await rep('attendance', 'below=150')).status, 400);
    assert.equal((await rep('exam-results')).status, 400, 'exam is required');
    assert.equal((await rep('exam-results', 'examId=00000000-0000-4000-8000-000000000000')).status, 404);
    assert.equal((await rep('students', `courseId=00000000-0000-4000-8000-000000000000`)).status, 404);
  });
});

/* ================================================================ the numbers */
describe('Student and employee lists', () => {
  it('filters by course and status, and totals by status', async () => {
    const all = await rep('students', `courseId=${courseId}`);
    assert.equal(all.status, 200);
    assert.deepEqual(all.body.rows.map((r) => r.studentCode), ['REP-A', 'REP-B', 'REP-C'], 'ordered by roll number');
    assert.deepEqual(all.body.summary.slice(0, 2), [['Students', 3], ['Active', 3]]);
    const alumni = await rep('students', 'status=Alumni');
    assert.ok(alumni.body.rows.some((r) => r.studentCode === 'REP-D'));
    assert.ok(alumni.body.rows.every((r) => r.status === 'Alumni'));
    assert.equal((await rep('students', `courseId=${courseId}&semester=9`)).body.total, 0);
  });
  it('lists employees, optionally for one department', async () => {
    const all = await rep('employees');
    assert.equal(all.body.total, 6);
    const dept = all.body.rows[0].department;
    const some = await rep('employees', `department=${encodeURIComponent(dept.toUpperCase())}`);
    assert.ok(some.body.total >= 1 && some.body.rows.every((r) => r.department === dept));
  });
});

describe('Fee collection', () => {
  it('lists every payment with what it paid for, the method label and the cashier; totals add up by method', async () => {
    const r = await rep('fee-collection', `courseId=${courseId}`);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.total, 3);
    const upi = r.body.rows.find((x) => x.reference === 'UPI-REF-9');
    assert.deepEqual([upi.method, upi.amount, upi.appliedTo, upi.studentCode, upi.receivedBy], ['UPI', 2500, 'Tuition', 'REP-A', 'Institute Admin']);
    assert.match(upi.receiptNo, /\S/);
    assert.deepEqual(r.body.summary, [['Total collected', 'Rs. 6,000.00'], ['Payments', 3], ['Cash (1)', 'Rs. 1,500.00'], ['Bank transfer (1)', 'Rs. 2,000.00'], ['UPI (1)', 'Rs. 2,500.00']]);
  });
  it('filters by method and date range (inclusive of the whole end day)', async () => {
    assert.equal((await rep('fee-collection', `courseId=${courseId}&method=upi`)).body.total, 1);
    assert.equal((await rep('fee-collection', `courseId=${courseId}&from=${TODAY}&to=${TODAY}`)).body.total, 3, 'payments made today are inside [today, today]');
    assert.equal((await rep('fee-collection', `courseId=${courseId}&from=${tomorrow}`)).body.total, 0);
    assert.equal((await rep('fee-collection', `courseId=${courseId}&to=${yesterday}`)).body.total, 0);
  });
});

describe('Outstanding fees', () => {
  it('shows charged, paid, outstanding and overdue per student, biggest balance first; settled students are left out', async () => {
    const r = await rep('fee-dues', `courseId=${courseId}`);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(r.body.rows.map((x) => [x.studentCode, x.charged, x.paid, x.outstanding, x.overdue]), [
      ['REP-A', 10000, 4000, 6000, 0],
      ['REP-B', 5000, 0, 5000, 5000],
    ]);
    assert.equal(r.body.rows[1].nextDue, '2020-01-01');
    assert.deepEqual(r.body.summary.slice(0, 3), [['Students with dues', 2], ['Total outstanding', 'Rs. 11,000.00'], ['Of which overdue', 'Rs. 5,000.00']]);
  });
  it('can be limited to students with overdue fees', async () => {
    const r = await rep('fee-dues', `courseId=${courseId}&overdueOnly=true`);
    assert.deepEqual(r.body.rows.map((x) => x.studentCode), ['REP-B']);
  });
});

describe('Attendance reports', () => {
  it('summarises per student from submitted registers only (a draft never counts) and flags those under 75%', async () => {
    const r = await rep('attendance', `courseId=${courseId}`);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const by = Object.fromEntries(r.body.rows.map((x) => [x.code, x]));
    assert.deepEqual([by['REP-A'].attended, by['REP-A'].total, by['REP-A'].pct, by['REP-A'].flag], [4, 6, 66.7, 'Below 75%']);
    assert.deepEqual([by['REP-B'].attended, by['REP-B'].total, by['REP-B'].pct], [1, 4, 25]);
    assert.deepEqual([by['REP-C'].pct, by['REP-C'].flag], [100, 'OK']);
    assert.equal(r.body.summary[1][1], 6, 'six submitted registers, the draft is ignored');
  });
  it('filters by date range and by "below %"', async () => {
    const jan = await rep('attendance', `courseId=${courseId}&from=2026-01-01&to=2026-01-31`);
    assert.equal(jan.body.summary[1][1], 5);
    const low = await rep('attendance', `courseId=${courseId}&below=60`);
    assert.deepEqual(low.body.rows.map((x) => x.code), ['REP-B']);
  });
  it('by-subject report has one row per student per subject', async () => {
    const r = await rep('attendance-subject', `courseId=${courseId}`);
    assert.equal(r.body.total, 4);
    const a = r.body.rows.filter((x) => x.code === 'REP-A').map((x) => [x.subject, x.attended, x.total, x.pct]);
    assert.deepEqual(a, [['Maths', 3, 4, 75], ['Physics', 1, 2, 50]]);
  });
});

describe('Exam results', () => {
  it('has a column per paper, absent as AB, and the same numbers as the exam module', async () => {
    const r = await rep('exam-results', `examId=${examId}`);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.ok(r.body.columns.some((c) => c.header === 'Maths (/100)'));
    const by = Object.fromEntries(r.body.rows.map((x) => [x.code, x]));
    assert.deepEqual([by['REP-A'].p0, by['REP-A'].pct, by['REP-A'].result], [80, 80, 'PASS']);
    assert.deepEqual([by['REP-B'].p0, by['REP-B'].result], ['AB', 'FAIL']);
    assert.deepEqual([by['REP-C'].p0, by['REP-C'].result], [35, 'FAIL']);
    assert.deepEqual(r.body.filters.find(([k]) => k === 'Status'), ['Status', 'Draft (not yet published)']);
  });
});

/* ================================================================ the files */
describe('CSV export', () => {
  it('is a download with a BOM, correct quoting, and spreadsheet formulas defused', async () => {
    const r = await rep('students', `courseId=${courseId}&format=csv`);
    assert.equal(r.status, 200);
    assert.match(r.res.headers.get('content-type'), /text\/csv/);
    assert.match(r.res.headers.get('content-disposition'), new RegExp(`attachment; filename="students-${TODAY}\\.csv"`));
    const buf = await bytes(r);
    assert.deepEqual([...buf.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
    const text = buf.subarray(3).toString('utf8');
    assert.ok(text.startsWith('Student ID,Roll no.,Name,Course,Sem,Section,Batch,Status,Gender,Date of birth,Phone,Email,Admission date,Guardian,Guardian phone\r\n'));
    assert.match(text, /,'=Anita Formula,/);
    assert.ok(!/,=Anita/.test(text), 'a leading = would be run as a formula by Excel');
    assert.match(text, /"Bilal, Comma ""Quote"""/);
  });
});

describe('Excel export', () => {
  it('is a real workbook: typed cells, frozen filtered header, and an "About" sheet with the filters used', async () => {
    const r = await rep('fee-collection', `courseId=${courseId}&format=xlsx`);
    assert.equal(r.status, 200);
    assert.equal(r.res.headers.get('content-type'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    assert.match(r.res.headers.get('content-disposition'), /attachment; filename="fee-collection-\d{4}-\d{2}-\d{2}\.xlsx"/);
    const f = unzip(await bytes(r));
    assert.match(f['xl/workbook.xml'], /name="Fee collection"/);
    assert.match(f['xl/workbook.xml'], /name="About this report"/);
    const data = f['xl/worksheets/sheet1.xml'];
    assert.match(data, /<pane ySplit="1"/);
    assert.match(data, /<autoFilter ref="A1:J4"\/>/, 'header + 3 payments, 10 columns');
    assert.match(data, /<c r="J2" s="3"><v>1500<\/v><\/c>/, 'amounts are numbers you can SUM, not text');
    assert.match(data, new RegExp(`<c r="B2" s="2"><v>${excelSerial(TODAY)}</v></c>`), 'dates are real dates');
    const about = f['xl/worksheets/sheet2.xml'];
    assert.match(about, /Filter: Course/); assert.match(about, /Report Test Course/); assert.match(about, /Institute Admin/); assert.match(about, /Total collected/);
  });

  it('every report exports to a workbook without error', async () => {
    for (const key of ['students', 'employees', 'fee-collection', 'fee-dues', 'attendance', 'attendance-subject']) {
      const r = await rep(key, 'format=xlsx');
      assert.equal(r.status, 200, key);
      assert.ok(Object.keys(unzip(await bytes(r))).length === 7, key);
    }
    const ex = await rep('exam-results', `examId=${examId}&format=xlsx`);
    assert.equal(ex.status, 200);
  });

  it('an empty result is still a valid workbook with just the header row', async () => {
    const r = await rep('fee-collection', `from=${tomorrow}&format=xlsx`);
    assert.equal(r.status, 200);
    assert.match(unzip(await bytes(r))['xl/worksheets/sheet1.xml'], /<dimension ref="A1:J1"\/>/);
  });
});

describe('PDF export', () => {
  it('is a PDF download for every report', async () => {
    for (const key of ['students', 'employees', 'fee-collection', 'fee-dues', 'attendance', 'attendance-subject']) {
      const r = await rep(key, 'format=pdf');
      assert.equal(r.status, 200, key);
      assert.equal(r.res.headers.get('content-type'), 'application/pdf');
      assert.match(r.res.headers.get('content-disposition'), /attachment; filename=".+\.pdf"/);
      assert.equal((await bytes(r)).subarray(0, 4).toString(), '%PDF', key);
    }
    assert.equal((await bytes(await rep('exam-results', `examId=${examId}&format=pdf`))).subarray(0, 4).toString(), '%PDF');
  });

  it('long reports paginate (the header repeats and footers count pages)', async () => {
    const many = Array.from({ length: 120 }, (_, i) => `('REP-X${i}', 'Bulk Student ${i}', 'bulk${i}@reptest.example', ${i + 10})`).join(',');
    await withTx({ tenantId }, () => q(`insert into students (student_code, name, email, course_id, semester) select v.c, v.n, v.e, $1, 2 from (values ${many.replace(/, (\d+)\)/g, ')')}) as v(c, n, e)`, [courseId]));
    try {
      const pages = pdfPages(await bytes(await rep('students', `courseId=${courseId}&format=pdf`)));
      assert.ok(pages >= 3, `123 rows should need several pages, got ${pages}`);
      const small = pdfPages(await bytes(await rep('employees', 'format=pdf')));
      assert.equal(small, 1);
    } finally {
      await withTx({ tenantId }, () => q("delete from students where student_code like 'REP-X%'"));
    }
  });

  it('refuses a PDF that would be absurdly long and points to Excel, while Excel and CSV still work', async () => {
    const { PDF_MAX_ROWS } = await import('../src/services/tablepdf.js');
    const n = PDF_MAX_ROWS + 50;
    await withTx({ tenantId }, () => q(
      "insert into students (student_code, name, email, course_id, semester) select 'REP-Y' || g, 'Bulk ' || g, 'y' || g || '@reptest.example', $1, 2 from generate_series(1, $2) g", [courseId, n],
    ));
    try {
      const pdf = await rep('students', `courseId=${courseId}&format=pdf`);
      assert.equal(pdf.status, 413);
      assert.match(pdf.body.message, /too many for a PDF.*Excel/);
      assert.equal((await rep('students', `courseId=${courseId}&format=xlsx`)).status, 200);
      assert.equal((await rep('students', `courseId=${courseId}&format=csv`)).status, 200);
    } finally {
      await withTx({ tenantId }, () => q("delete from students where student_code like 'REP-Y%'"));
    }
  });
});

describe('Audit and isolation', () => {
  it('records every export (who, which report, format, filters) but not previews', async () => {
    const count = async () => withTx({ tenantId }, async () => (await q("select count(*)::int as n from audit_log where action = 'report.export'")).rows[0].n);
    const before = await count();
    await rep('students', 'format=json');
    assert.equal(await count(), before, 'a preview is not an export');
    await rep('fee-collection', `courseId=${courseId}&method=upi&format=xlsx`);
    assert.equal(await count(), before + 1);
    const last = await withTx({ tenantId }, async () => (await q("select actor_role, entity_id, meta from audit_log where action = 'report.export' order by id desc limit 1")).rows[0]);
    assert.deepEqual([last.actor_role, last.entity_id, last.meta.format, last.meta.rows], ['admin', 'fee-collection', 'xlsx', 1]);
    assert.equal(last.meta.filters.Method, 'UPI');
  });

  it("another institute's data never appears, in any format", async () => {
    for (const key of ['students', 'fee-collection', 'fee-dues', 'attendance']) {
      const j = await rep(key, '', schoolAdmin);
      assert.equal(j.status, 200, key);
      assert.ok(!JSON.stringify(j.body.rows).includes('REP-'), `${key} leaked rows`);
    }
    assert.equal((await rep('exam-results', `examId=${examId}`, schoolAdmin)).status, 404);
    assert.equal((await rep('students', `courseId=${courseId}`, schoolAdmin)).status, 404, "another institute's course id is unknown");
    const csv = Buffer.from(await (await rep('students', 'format=csv', schoolAdmin)).res.arrayBuffer()).toString('utf8');
    assert.ok(!csv.includes('REP-A'));
  });

  it('the preview is capped but reports the true total', async () => {
    const r = await rep('students', 'format=json');
    assert.equal(r.body.total, r.body.rows.length);
    assert.equal(r.body.truncated, false);
  });
});

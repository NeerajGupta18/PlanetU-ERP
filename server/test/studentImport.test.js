/** Bulk student import - run with `npm test` (needs `npm run db:setup` first). */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import bcrypt from 'bcryptjs';
import { env } from '../src/config/env.js';
import { createApp } from '../src/app.js';
import { closePool, q, withTx } from '../src/db/pool.js';
import { issueCaptchaToken } from '../src/services/captcha.service.js';
import { parseCsv } from '../src/utils/csvParse.js';
import { parseDate } from '../src/services/studentImport.service.js';

let server; let base;
async function login(tenantCode, role, identifier, password) {
  const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tenantCode, role, identifier, password, captchaToken: issueCaptchaToken() }) });
  const body = await r.json();
  return { status: r.status, body, cookie: r.headers.getSetCookie().map((c) => c.split(';')[0]).find((c) => c.startsWith(`${env.COOKIE_NAME}=`)) };
}
const json = async (method, path, { cookie, body } = {}) => {
  const r = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let b = null; try { b = await r.clone().json(); } catch { /* not json */ }
  return { status: r.status, body: b, res: r };
};
/** POST a CSV (string or Buffer) as multipart, with extra text fields. */
async function upload(path, cookie, content, fields = {}, filename = 'students.csv') {
  const form = new FormData();
  if (content !== null) form.append('file', new Blob([content]), filename);
  for (const [k, v] of Object.entries(fields)) form.append(k, String(v));
  const r = await fetch(`${base}${path}`, { method: 'POST', headers: cookie ? { cookie } : {}, body: form });
  let b = null; try { b = await r.clone().json(); } catch { /* not json */ }
  return { status: r.status, body: b };
}
const preview = (cookie, content, fields) => upload('/api/admin/students/import/preview', cookie, content, fields);
const commit = (cookie, content, fields) => upload('/api/admin/students/import', cookie, content, fields);

const HEAD = 'name,email,course,semester,section,student_id,roll_no,phone,date_of_birth,gender,blood_group,status';
let admin; let schoolAdmin; let studentCookie; let empCookie; let tenantId; let schoolTenantId;
const countStudents = async () => withTx({ tenantId }, async () => (await q("select count(*)::int as n from students where email like '%@imptest.example'")).rows[0].n);
const countUsers = async () => withTx({ tenantId }, async () => (await q("select count(*)::int as n from users where email like '%@imptest.example'")).rows[0].n);
const mails = async () => withTx({ tenantId }, async () => (await q("select to_email, template, text_body from notifications where to_email like '%@imptest.example' order by created_at")).rows);

before(async () => {
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  admin = (await login('demo-college', 'admin', 'ADM001', 'Admin@123')).cookie;
  schoolAdmin = (await login('demo-school', 'admin', 'ADM001', 'Admin@123')).cookie;
  studentCookie = (await login('demo-college', 'student', 'STU2026001', 'Student@123')).cookie;
  empCookie = (await login('demo-college', 'employee', 'EMP001', 'Employee@123')).cookie;
  tenantId = (await withTx({ platform: true }, () => q("select id from tenants where code = 'demo-college'"))).rows[0].id;
  schoolTenantId = (await withTx({ platform: true }, () => q("select id from tenants where code = 'demo-school'"))).rows[0].id;
  await withTx({ tenantId }, async () => {
    await q("insert into courses (code, name, full_name) values ('IMPTEST', 'Import Test Course', 'Import Test Course Full')");
    await q("insert into courses (code, name) values ('DUP1', 'Twin Course'), ('DUP2', 'Twin Course')");
  });
});

after(async () => {
  try {
    await withTx({ tenantId }, async () => {
      await q("delete from notifications where to_email like '%@imptest.example'");
      await q("delete from users where email like '%@imptest.example'");
      await q("delete from students where email like '%@imptest.example'");
      await q("delete from courses where code in ('IMPTEST', 'DUP1', 'DUP2')");
    });
    await withTx({ tenantId: schoolTenantId }, async () => {
      await q("delete from users where email like '%@imptest.example'");
      await q("delete from students where email like '%@imptest.example'");
    });
  } finally {
    await new Promise((r) => server.close(r));
    await closePool();
  }
});

/* ================================================================ pure helpers */
describe('CSV reader (no database)', () => {
  it('handles a BOM, CRLF, quotes, escaped quotes, embedded newlines and blank lines, with real line numbers', () => {
    const { rows } = parseCsv('\uFEFFName,Note\r\n"Doe, John","said ""hi"""\r\n\r\nAna,"two\nlines"\nZed,x\n');
    assert.deepEqual(rows.map((r) => [r.line, r.cells]), [
      [1, ['Name', 'Note']], [2, ['Doe, John', 'said "hi"']], [4, ['Ana', 'two\nlines']], [6, ['Zed', 'x']],
    ]);
  });
  it('detects semicolon and tab delimiters', () => {
    assert.deepEqual(parseCsv('a;b;c\n1;2;3').rows[1].cells, ['1', '2', '3']);
    assert.deepEqual(parseCsv('a\tb\n1\t2').rows[1].cells, ['1', '2']);
  });
  it('rejects a quote that is never closed', () => {
    assert.throws(() => parseCsv('a,b\n"oops,1'), /never closed/);
  });
});

describe('Date reading (no database)', () => {
  it('accepts ISO, day-first slashes/dashes/dots and month names; refuses impossible and ambiguous dates', () => {
    assert.equal(parseDate('2005-03-14'), '2005-03-14');
    assert.equal(parseDate('14/03/2005'), '2005-03-14');
    assert.equal(parseDate('14-3-2005'), '2005-03-14');
    assert.equal(parseDate('14.03.2005'), '2005-03-14');
    assert.equal(parseDate('14-Mar-2005'), '2005-03-14');
    assert.equal(parseDate('14 March 2005'), '2005-03-14');
    assert.equal(parseDate('31/02/2005'), null, 'no 31 February');
    assert.equal(parseDate('2005-13-01'), null);
    assert.equal(parseDate('14/03/05'), null, 'two-digit years are ambiguous');
    assert.equal(parseDate('soon'), null);
  });
});

/* ================================================================ HTTP */
describe('Access', () => {
  it('only admins can use the import; students, faculty and anonymous callers cannot', async () => {
    const csv = `${HEAD}\nA,a@imptest.example,IMPTEST,,,,,,,,,\n`;
    assert.equal((await preview(studentCookie, csv)).status, 403);
    assert.equal((await commit(empCookie, csv)).status, 403);
    assert.equal((await upload('/api/admin/students/import/preview', null, csv)).status, 401);
    assert.equal((await json('GET', '/api/admin/students/import/template.csv', { cookie: studentCookie })).status, 403);
  });
});

describe('Template', () => {
  it('downloads a CSV with every column, a BOM for Excel, and a real course code in the examples', async () => {
    const r = await json('GET', '/api/admin/students/import/template.csv', { cookie: admin });
    assert.equal(r.status, 200);
    assert.match(r.res.headers.get('content-type'), /text\/csv/);
    const bytes = Buffer.from(await r.res.arrayBuffer());
    assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'UTF-8 BOM so Excel reads accents correctly');
    const text = `\uFEFF${bytes.subarray(3).toString('utf8')}`;
    assert.ok(text.startsWith('\uFEFFname,email,course,semester,section,student_id,roll_no,enrollment_no,phone,date_of_birth,gender,blood_group,nationality,batch,admission_date,address,guardian_name,guardian_relation,guardian_phone,guardian_email,status'));
    const first = parseCsv(text).rows[1].cells;
    assert.ok(first[2] && first[2] !== 'COURSE-CODE', 'sample row uses a course that exists');
    // The template must itself pass validation once its example emails are made unique
    const p = await preview(admin, text.replace(/@example\.com/g, '@imptest.example'));
    assert.equal(p.status, 200, JSON.stringify(p.body));
    assert.equal(p.body.summary.withErrors, 0);
  });
});

describe('Problems with the file itself', () => {
  it('refuses: nothing uploaded, empty, Excel workbook, binary, missing required columns, header only, too many rows, too large', async () => {
    assert.equal((await preview(admin, null)).status, 400);
    assert.equal((await preview(admin, '')).status, 400);
    const xlsx = await preview(admin, Buffer.from([0x50, 0x4b, 3, 4, 0, 0]), {}, 'students.xlsx');
    assert.equal(xlsx.status, 400);
    assert.match(xlsx.body.message, /Save As.*CSV/);
    assert.equal((await preview(admin, Buffer.from([1, 2, 0, 3]))).status, 400);
    const noEmail = await preview(admin, 'name,course\nA,IMPTEST\n');
    assert.equal(noEmail.status, 400);
    assert.match(noEmail.body.message, /containing: email/);
    assert.equal((await preview(admin, `${HEAD}\n`)).status, 400);
    const many = `${HEAD}\n${Array.from({ length: 2001 }, (_, i) => `S${i},s${i}@imptest.example,IMPTEST,,,,,,,,,`).join('\n')}\n`;
    const m = await preview(admin, many);
    assert.equal(m.status, 400);
    assert.match(m.body.message, /2001 students.*at most 2000/);
    const big = await preview(admin, Buffer.alloc(2 * 1024 * 1024 + 10, 'a'));
    assert.equal(big.status, 413);
    assert.match(big.body.message, /2 MB/);
    assert.equal((await countStudents()), 0);
  });
});

describe('Row validation (preview writes nothing)', () => {
  it('flags every kind of bad value with a message that says what to fix', async () => {
    const csv = [
      HEAD,
      ',nobody@imptest.example,IMPTEST,,,,,,,,,',                                  // 2 name missing
      'Bad Email,not-an-email,IMPTEST,,,,,,,,,',                                  // 3
      'Bad Course,bc@imptest.example,NOPE,,,,,,,,,',                               // 4
      'Twin,tw@imptest.example,Twin Course,,,,,,,,,',                              // 5 ambiguous name
      'Bad Sem,bs@imptest.example,IMPTEST,25,,,,,,,,',                            // 6
      'Bad Dob,bd@imptest.example,IMPTEST,,,,,,31/02/2005,,,',                    // 7
      'Future,fu@imptest.example,IMPTEST,,,,,,2999-01-01,,,',                     // 8
      'Bad Gender,bg@imptest.example,IMPTEST,,,,,,,robot,,',                      // 9
      'Bad Blood,bb@imptest.example,IMPTEST,,,,,,,,Z+,',                          // 10
      'Bad Status,bst@imptest.example,IMPTEST,,,,,,,,,Retired',                   // 11
      'Bad Phone,bp@imptest.example,IMPTEST,,,,,12345,,,,',                       // 12
      'Excel Phone,ep@imptest.example,IMPTEST,,,,,9.87654E+11,,,,',               // 13
      'Bad Id,bi@imptest.example,IMPTEST,,,bad id!,,,,,,',                        // 14
      'Fine,fine@imptest.example,IMPTEST,Sem 3,A,,7,98765 43210,14-Mar-2005,m,o positive,active', // 15 ok
    ].join('\n');
    const r = await preview(admin, csv);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const by = Object.fromEntries(r.body.rows.map((x) => [x.line, x]));
    const has = (line, re) => assert.ok(by[line].errors.some((e) => re.test(e)), `line ${line}: ${JSON.stringify(by[line].errors)}`);
    has(2, /Name is required/); has(3, /not a valid email/); has(4, /Unknown course "NOPE"/); has(5, /more than one course/);
    has(6, /Semester "25"/); has(7, /not a valid date/); has(8, /in the future/); has(9, /Gender "robot"/);
    has(10, /Blood group "Z\+"/); has(11, /Status "Retired"/); has(12, /not a valid phone/); has(13, /scientific notation/); has(14, /Student ID/);
    assert.equal(by[15].ok, true, JSON.stringify(by[15]));
    assert.equal(by[15].semester, 3);
    assert.deepEqual(r.body.summary, { rows: 14, ready: 1, withErrors: 13, withWarnings: 0, autoIds: 1 });
    assert.equal(await countStudents(), 0, 'a preview never writes');
  });

  it('accepts friendly header names and tells you about columns it ignored', async () => {
    const csv = 'Full Name,E-mail ID,Class,Mobile No,DOB,Favourite Colour\nAsha,asha@imptest.example,IMPTEST,9876543210,14/03/2005,blue\n';
    const r = await preview(admin, csv);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(r.body.columns.sort(), ['course', 'dob', 'email', 'name', 'phone']);
    assert.deepEqual(r.body.unknownColumns, ['Favourite Colour']);
    assert.equal(r.body.summary.withErrors, 0);
  });

  it('catches repeats inside the file and clashes with existing students, with the line to look at', async () => {
    const csv = [
      HEAD,
      'One,dupe@imptest.example,IMPTEST,,,IMP-1,,,,,,',
      'Two,dupe@imptest.example,IMPTEST,,,IMP-1,,,,,,',
      'Three,aarav.sharma@student.horizon.example,IMPTEST,,,STU2026001,,,,,,',
    ].join('\n');
    const r = await preview(admin, csv);
    const by = Object.fromEntries(r.body.rows.map((x) => [x.line, x]));
    assert.equal(by[2].ok, true);
    assert.ok(by[3].errors.some((e) => /repeated \(first on line 2\)/.test(e) && /dupe@/.test(e)));
    assert.ok(by[3].errors.some((e) => /Student ID IMP-1 is repeated/.test(e)));
    assert.ok(by[4].errors.some((e) => /ID STU2026001 already exists/.test(e)));
    assert.ok(by[4].errors.some((e) => /already used by an existing student/.test(e)));
  });

  it('without logins, a shared (sibling/parent) email is only a warning', async () => {
    const csv = `${HEAD}\nA,fam@imptest.example,IMPTEST,,,,,,,,,\nB,fam@imptest.example,IMPTEST,,,,,,,,,\n`;
    const withLogins = await preview(admin, csv);
    assert.equal(withLogins.body.summary.withErrors, 1);
    const without = await preview(admin, csv, { createLogins: false });
    assert.equal(without.body.summary.withErrors, 0);
    assert.equal(without.body.summary.withWarnings, 1);
  });

  it('warns about a repeated roll number in the same class, and about stray extra values', async () => {
    const csv = `${HEAD}\nA,ra@imptest.example,IMPTEST,1,A,,5,,,,,\nB,rb@imptest.example,IMPTEST,1,A,,5,,,,,,extra\n`;
    const r = await preview(admin, csv);
    assert.equal(r.body.summary.withErrors, 0);
    assert.ok(r.body.rows[1].warnings.some((w) => /Roll no\. 5 is also used on line 2/.test(w)));
    assert.ok(r.body.rows[1].warnings.some((w) => /more values than the header/.test(w)));
  });

  it("reads a Windows-1252 file (Excel's plain CSV) without garbling accents, and says so", async () => {
    const csv = Buffer.from(`${HEAD}\nZo\xEB M\xFCller,zoe@imptest.example,IMPTEST,,,,,,,,,\n`, 'latin1');
    const r = await preview(admin, csv);
    assert.equal(r.status, 200);
    assert.equal(r.body.rows[0].name, 'Zoë Müller');
    assert.match(r.body.notes[0], /Windows-1252/);
  });
});

describe('Importing', () => {
  const GOOD = [
    'Full Name,E-mail,Course,Sem,Division,Student ID,Roll,Mobile,DOB,Sex,Blood Group,Guardian Name,Guardian Phone,Status',
    'Aditi Rao,aditi@imptest.example,IMPTEST,Sem 3,B,OLD-0001,12,+91 98765 43210,14/03/2005,F,AB+,Mahesh Rao,9000000001,Active',
    'Bhavesh Jain,bhavesh@imptest.example,Import Test Course,2,,,13,,2004-12-01,Male,,,,',
    'Chitra Nair,chitra@imptest.example,IMPTEST,1,A,,14,,,,,,,',
  ].join('\n');
  let created;

  it('creates the students with normalised values, honouring a supplied ID and generating the rest', async () => {
    const r = await commit(admin, GOOD);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    created = r.body;
    assert.deepEqual([created.created, created.skipped, created.emailsQueued], [3, 0, 3]);
    const codes = created.rows.map((x) => x.studentCode);
    assert.equal(codes[0], 'OLD-0001');
    assert.match(codes[1], /^PRN\d{7}$/); assert.match(codes[2], /^PRN\d{7}$/);
    assert.equal(Number(codes[2].slice(3)), Number(codes[1].slice(3)) + 1, 'generated IDs follow the PRN series in file order');

    await withTx({ tenantId }, async () => {
      const { rows: [a] } = await q("select s.*, c.code as course_code from students s join courses c on c.id = s.course_id where s.student_code = 'OLD-0001'");
      assert.deepEqual(
        [a.name, a.email, a.course_code, a.semester, a.section, a.roll_no, a.phone, a.dob, a.gender, a.blood_group, a.status, a.enrollment_no],
        ['Aditi Rao', 'aditi@imptest.example', 'IMPTEST', 3, 'B', '12', '+919876543210', '2005-03-14', 'Female', 'AB+', 'Active', 'OLD-0001'],
      );
      assert.deepEqual(a.guardian, { name: 'Mahesh Rao', phone: '9000000001' });
      const { rows: [b] } = await q("select dob, gender, semester from students where email = 'bhavesh@imptest.example'");
      assert.deepEqual([b.dob, b.gender, b.semester], ['2004-12-01', 'Male', 2]);
    });
    assert.equal(await countStudents(), 3);
  });

  it('creates a login per student (ID = login, must change password) and queues one set-password email each', async () => {
    assert.equal(await countUsers(), 3);
    await withTx({ tenantId }, async () => {
      const { rows } = await q("select role, login_id, must_change_password, status from users where email like '%@imptest.example' order by login_id");
      assert.ok(rows.every((u) => u.role === 'student' && u.must_change_password && u.status === 'active'));
      assert.ok(rows.some((u) => u.login_id === 'OLD-0001'));
    });
    const m = await mails();
    assert.equal(m.length, 3);
    assert.ok(m.every((x) => x.template === 'accountSetup'));
    assert.match(m[0].text_body, /Your login ID: OLD-0001/);
    assert.match(m[0].text_body, /expires in 168 hours/);
  });

  it('the emailed link lets the student choose a password and sign in; the unknown initial password does not work', async () => {
    const mail = (await mails()).find((x) => x.to_email === 'aditi@imptest.example');
    const token = mail.text_body.match(/token=([^&\s]+)/)[1];
    assert.equal((await login('demo-college', 'student', 'OLD-0001', 'Student@123')).status, 401);
    const set = await json('POST', '/api/auth/reset-password', { body: { token, password: 'Welcome@2026' } });
    assert.equal(set.status, 200, JSON.stringify(set.body));
    const ok = await login('demo-college', 'student', 'OLD-0001', 'Welcome@2026');
    assert.equal(ok.status, 200);
    assert.equal(ok.body.user.name, 'Aditi Rao');
  });

  it('importing the same file again is refused, because every student already exists; skipping reports why', async () => {
    const again = await commit(admin, GOOD);
    assert.equal(again.status, 409);
    assert.match(again.body.message, /3 rows have problems.*nothing was imported/);
    const skip = await commit(admin, GOOD, { skipInvalid: true });
    assert.equal(skip.status, 400);
    assert.match(skip.body.message, /no valid rows/);
    assert.equal(await countStudents(), 3);
  });

  it('all-or-nothing: one bad row stops the import unless you choose to skip it', async () => {
    const csv = `${HEAD}\nGood One,g1@imptest.example,IMPTEST,,,,,,,,,\nBad,bad-email,IMPTEST,,,,,,,,,\nGood Two,g2@imptest.example,IMPTEST,,,,,,,,,\n`;
    const before = await countStudents();
    const strict = await commit(admin, csv);
    assert.equal(strict.status, 409);
    assert.equal(await countStudents(), before, 'nothing was created');
    assert.equal(await countUsers(), before);

    const lenient = await commit(admin, csv, { skipInvalid: true });
    assert.equal(lenient.status, 201, JSON.stringify(lenient.body));
    assert.deepEqual([lenient.body.created, lenient.body.skipped], [2, 1]);
    assert.deepEqual(lenient.body.rows.map((x) => [x.line, x.status]), [[2, 'created'], [3, 'skipped'], [4, 'created']]);
    assert.match(lenient.body.rows[1].reason, /not a valid email/);
    assert.equal(await countStudents(), before + 2);
  });

  it('logins are optional, emails are optional, and inactive students get a disabled login and no email', async () => {
    const noLogin = await commit(admin, `${HEAD}\nNo Login,nl@imptest.example,IMPTEST,,,,,,,,,\n`, { createLogins: false });
    assert.equal(noLogin.status, 201);
    assert.equal(noLogin.body.emailsQueued, 0);
    assert.equal((await mails()).filter((x) => x.to_email === 'nl@imptest.example').length, 0);
    assert.equal(await withTx({ tenantId }, async () => (await q("select count(*)::int as n from users where email = 'nl@imptest.example'")).rows[0].n), 0);

    const noMail = await commit(admin, `${HEAD}\nNo Mail,nm@imptest.example,IMPTEST,,,,,,,,,\n`, { sendEmails: false });
    assert.equal(noMail.body.emailsQueued, 0);
    assert.equal(await withTx({ tenantId }, async () => (await q("select count(*)::int as n from users where email = 'nm@imptest.example'")).rows[0].n), 1);

    const inactive = await commit(admin, `${HEAD}\nGone,gone@imptest.example,IMPTEST,,,,,,,,,Alumni\n`);
    assert.equal(inactive.body.emailsQueued, 0);
    const u = await withTx({ tenantId }, async () => (await q("select status from users where email = 'gone@imptest.example'")).rows[0]);
    assert.equal(u.status, 'disabled');
  });

  it('a generated ID never reuses an ID that already exists or one given elsewhere in the same file', async () => {
    // Park the PRN series just before an ID that is already taken, and supply the next one explicitly in the file
    const next = await withTx({ tenantId }, async () => (await q("select next_value from number_series where key = 'prn'")).rows[0].next_value);
    const taken = `PRN${String(next).padStart(7, '0')}`;
    const takenToo = `PRN${String(Number(next) + 1).padStart(7, '0')}`;
    await withTx({ tenantId }, () => q(
      "insert into students (student_code, name, email, course_id) select $1, 'Squatter', 'squat@imptest.example', id from courses where code = 'IMPTEST'", [taken],
    ));
    const r = await commit(admin, `${HEAD}\nExplicit,ex@imptest.example,IMPTEST,,,${takenToo},,,,,,\nAuto,au@imptest.example,IMPTEST,,,,,,,,,\n`);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const auto = r.body.rows.find((x) => x.email === 'au@imptest.example').studentCode;
    assert.ok(![taken, takenToo].includes(auto), `${auto} must not collide`);
    assert.match(auto, /^PRN\d{7}$/);
  });

  it('records who imported what in the audit log', async () => {
    const n = await withTx({ tenantId }, async () => (await q("select count(*)::int as n, max(meta->>'created') as created from audit_log where action = 'students.import'")).rows[0]);
    assert.ok(n.n >= 3);
  });
});

describe('Tenant isolation', () => {
  it("another institute's courses are invisible, and an import only ever lands in the importer's own institute", async () => {
    // demo-school has no course called IMPTEST
    const cross = await preview(schoolAdmin, `${HEAD}\nX,x@imptest.example,IMPTEST,,,,,,,,,\n`);
    assert.equal(cross.body.rows[0].ok, false);
    assert.match(cross.body.rows[0].errors[0], /Unknown course "IMPTEST"/);

    const schoolCourse = await withTx({ tenantId: schoolTenantId }, async () => (await q('select code from courses limit 1')).rows[0].code);
    const ok = await commit(schoolAdmin, `${HEAD}\nSchool Kid,kid@imptest.example,${schoolCourse},,,,,,,,,\n`, { createLogins: false });
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    const inCollege = await withTx({ tenantId }, async () => (await q("select count(*)::int as n from students where email = 'kid@imptest.example'")).rows[0].n);
    const inSchool = await withTx({ tenantId: schoolTenantId }, async () => (await q("select count(*)::int as n from students where email = 'kid@imptest.example'")).rows[0].n);
    assert.deepEqual([inCollege, inSchool], [0, 1]);
  });

  it('the same email may exist in two institutes (each is its own world)', async () => {
    const r = await commit(admin, `${HEAD}\nCollege Kid,kid@imptest.example,IMPTEST,,,,,,,,,\n`, { createLogins: false });
    assert.equal(r.status, 201, JSON.stringify(r.body));
  });
});

/* ================================================================ regression: big uploads */
describe('Large uploads keep their database context', () => {
  // Bodies of a few hundred KB arrive in several network chunks. Before the fix, the parser called back
  // outside the request's async context and the handler died with "Database access outside a tenant context".
  it('a CSV of several hundred KB can be previewed', async () => {
    const pad = 'x'.repeat(240);
    const rows = Array.from({ length: 1600 }, (_, i) => `Big ${i},big${i}@imptest.example,IMPTEST,${pad}`);
    const csv = `name,email,course,address\n${rows.join('\n')}\n`;
    assert.ok(csv.length > 400 * 1024, 'the file really is large');
    const r = await preview(admin, csv);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.summary.rows, 1600);
  });

  it('the existing file upload accepts a valid image of 600 KB (admission documents allow up to 5 MB)', async () => {
    const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
    const crc = (buf) => { let v = 0xffffffff; for (const b of buf) v = crcTable[(v ^ b) & 0xff] ^ (v >>> 8); return (v ^ 0xffffffff) >>> 0; };
    const chunk = (type, data) => { const l = Buffer.alloc(4); l.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(1, 4); ihdr[8] = 8; ihdr[9] = 2;
    const { deflateSync } = await import('node:zlib');
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('tEXt', Buffer.concat([Buffer.from('k\0'), Buffer.alloc(600 * 1024, 97)])),
      chunk('IDAT', deflateSync(Buffer.from([0, 255, 0, 0]))), chunk('IEND', Buffer.alloc(0)),
    ]);
    const form = new FormData();
    form.append('file', new Blob([png], { type: 'image/png' }), 'big.png'); form.append('purpose', 'general');
    const r = await fetch(`${base}/api/files`, { method: 'POST', headers: { cookie: admin }, body: form });
    const body = await r.json();
    assert.equal(r.status, 201, JSON.stringify(body));
    const del = await json('DELETE', `/api/files/${body.file?.id ?? body.id}`, { cookie: admin });
    assert.ok([200, 204].includes(del.status), `cleanup ${del.status}`);
  });
});

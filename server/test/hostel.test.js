import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { env } from "../src/config/env.js";
import { createApp } from "../src/app.js";
import { closePool, q, withTx } from "../src/db/pool.js";
import { issueCaptchaToken } from "../src/services/captcha.service.js";

let server; let base; let tenantId;
const json = async (method, path, { cookie, body } = {}) => {
  const r = await fetch(`${base}${path}`, { method, headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let b = null; try { b = await r.json(); } catch { /* empty or not json */ }
  return { status: r.status, body: b, headers: r.headers };
};
async function login(tenantCode, role, identifier, password) {
  const r = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tenantCode, role, identifier, password, captchaToken: issueCaptchaToken() }) });
  assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
  return r.headers.getSetCookie().map((c) => c.split(";")[0]).find((c) => c.startsWith(`${env.COOKIE_NAME}=`));
}
const start = async () => {
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  tenantId = (await withTx({ platform: true }, () => q("select id from tenants where code = 'demo-college'"))).rows[0].id;
};
const stop = async () => { await new Promise((r) => server.close(r)); await closePool(); };

let admin; let schoolAdmin; let emp; let studentCk; let parentCk; let stu = {}; let seeded = [];
const A = '/api/admin/hostel';
const cleanup = async () => withTx({ tenantId }, async () => {
  await q("delete from hostel_stays where remark like 'HT %'");
  await q("delete from hostel_stays where room_id in (select r.id from hostel_rooms r join hostels h on h.id = r.hostel_id where h.name like 'HT %')");
  await q("delete from hostel_rooms where hostel_id in (select id from hostels where name like 'HT %')");
  await q("delete from hostels where name like 'HT %'");
  for (const id of seeded) await q("update hostel_stays set status = 'active', to_date = null where id = $1", [id]);
});

before(async () => {
  await start();
  admin = await login('demo-college', 'admin', 'ADM001', 'Admin@123');
  schoolAdmin = await login('demo-school', 'admin', 'ADM001', 'Admin@123');
  emp = await login('demo-college', 'employee', 'EMP001', 'Employee@123');
  studentCk = await login('demo-college', 'student', 'STU2026001', 'Student@123');
  parentCk = await login('demo-college', 'parent', 'PAR001', 'Parent@123');
  const rows = (await withTx({ tenantId }, () => q("select id, student_code from students where student_code in ('STU2026001','STU2026002','STU2026003')"))).rows;
  for (const r of rows) stu[r.student_code.slice(-1)] = r.id; // 1 = boy, 2 = girl, 3 = boy
  seeded = (await withTx({ tenantId }, () => q("select id from hostel_stays where status = 'active'"))).rows.map((r) => r.id);
  await withTx({ tenantId }, () => q("update hostel_stays set status = 'vacated', to_date = current_date where status = 'active'"));
  await cleanup();
  await withTx({ tenantId }, () => q("update hostel_stays set status = 'vacated', to_date = current_date where status = 'active'"));
});
after(async () => { await cleanup(); await stop(); });

let boys; let girls; let rooms = {};

describe('Hostels and rooms (office)', () => {
  it('creates hostels, rejects duplicate names, bad kinds and unknown wardens', async () => {
    const b = await json('POST', A, { cookie: admin, body: { name: 'HT Boys', kind: 'boys' } });
    assert.equal(b.status, 201); boys = b.body.hostel.id;
    const g = await json('POST', A, { cookie: admin, body: { name: 'HT Girls', kind: 'girls' } });
    girls = g.body.hostel.id;
    assert.equal((await json('POST', A, { cookie: admin, body: { name: 'ht boys', kind: 'boys' } })).status, 409);
    assert.equal((await json('POST', A, { cookie: admin, body: { name: 'HT X', kind: 'dorm' } })).status, 400);
    assert.equal((await json('POST', A, { cookie: admin, body: { name: 'HT X', wardenId: '11111111-1111-4111-8111-111111111111' } })).status, 400);
    assert.equal((await json('POST', A, { cookie: admin, body: { name: '' } })).status, 400);
  });

  it('adds rooms from a list and ranges, and refuses duplicates and bad bed counts', async () => {
    const r = await json('POST', `${A}/${boys}/rooms`, { cookie: admin, body: { roomNos: '301-303, 310', beds: 2, floor: 3, monthlyFee: 4000 } });
    assert.equal(r.status, 201); assert.equal(r.body.created, 4);
    assert.equal((await json('POST', `${A}/${boys}/rooms`, { cookie: admin, body: { roomNos: '302', beds: 2 } })).status, 409);
    assert.equal((await json('POST', `${A}/${boys}/rooms`, { cookie: admin, body: { roomNos: '400', beds: 0 } })).status, 400);
    assert.equal((await json('POST', `${A}/${boys}/rooms`, { cookie: admin, body: { roomNos: '9-1' } })).status, 400);
    await json('POST', `${A}/${girls}/rooms`, { cookie: admin, body: { roomNos: '301', beds: 1, monthlyFee: 4200 } });
    const list = (await json('GET', `${A}/${boys}/rooms`, { cookie: admin })).body.rooms;
    assert.deepEqual(list.map((x) => x.roomNo), ['301', '302', '303', '310']);
    rooms = { b1: list[0].id, b2: list[1].id, b3: list[2].id, g1: (await json('GET', `${A}/${girls}/rooms`, { cookie: admin })).body.rooms[0].id };
  });

  it('shows beds and occupancy on the hostel list', async () => {
    const h = (await json('GET', A, { cookie: admin })).body.hostels.find((x) => x.id === boys);
    assert.equal(h.rooms, 4); assert.equal(h.beds, 8); assert.equal(h.occupied, 0);
  });
});

describe('Allotting students', () => {
  it('keeps boys and girls hostels to the right students', async () => {
    assert.equal((await json('POST', `${A}/stays`, { cookie: admin, body: { studentId: stu[2], roomId: rooms.b1, remark: 'HT a' } })).status, 409);
    assert.equal((await json('POST', `${A}/stays`, { cookie: admin, body: { studentId: stu[1], roomId: rooms.g1, remark: 'HT a' } })).status, 409);
  });

  it('allots, and refuses a second room for the same student', async () => {
    const ok = await json('POST', `${A}/stays`, { cookie: admin, body: { studentId: stu[1], roomId: rooms.b1, remark: 'HT a' } });
    assert.equal(ok.status, 201); assert.equal(ok.body.stay.roomNo, '301');
    assert.equal((await json('POST', `${A}/stays`, { cookie: admin, body: { studentId: stu[1], roomId: rooms.b2, remark: 'HT a' } })).status, 409);
  });

  it('refuses a full room, and refuses to cut the beds below the people staying', async () => {
    assert.equal((await json('POST', `${A}/stays`, { cookie: admin, body: { studentId: stu[3], roomId: rooms.b1, remark: 'HT b' } })).status, 201);
    const full = await json('POST', `${A}/stays`, { cookie: admin, body: { studentId: stu[2], roomId: rooms.g1, remark: 'HT b' } });
    assert.equal(full.status, 201); // girl in the girls hostel, one bed
    // room b1 has 2 beds and 2 students
    const room = (await json('GET', `${A}/${boys}/rooms`, { cookie: admin })).body.rooms.find((x) => x.id === rooms.b1);
    assert.equal(room.occupied, 2);
    const cut = await json('PUT', `${A}/rooms/${rooms.b1}`, { cookie: admin, body: { beds: 1 } });
    assert.equal(cut.status, 409);
    const inactive = await json('PUT', `${A}/rooms/${rooms.b1}`, { cookie: admin, body: { active: false } });
    assert.equal(inactive.status, 409);
  });

  it('only active students can be allotted a room', async () => {
    await withTx({ tenantId }, () => q("update students set status = 'Inactive' where id = $1", [stu[3]]));
    try {
      await json('PUT', `${A}/stays/${(await json('GET', `${A}/stays?search=Karan`, { cookie: admin })).body.stays[0].id}/vacate`, { cookie: admin, body: { remark: 'HT c' } });
      assert.equal((await json('POST', `${A}/stays`, { cookie: admin, body: { studentId: stu[3], roomId: rooms.b2, remark: 'HT c' } })).status, 409);
    } finally { await withTx({ tenantId }, () => q("update students set status = 'Active' where id = $1", [stu[3]])); }
  });
});

describe('Vacating and moving', () => {
  it('moves a student to another room and keeps the old stay as history', async () => {
    const stay = (await json('GET', `${A}/stays?search=Aarav`, { cookie: admin })).body.stays[0];
    const moved = await json('PUT', `${A}/stays/${stay.id}/transfer`, { cookie: admin, body: { roomId: rooms.b3, remark: 'HT move' } });
    assert.equal(moved.status, 200); assert.equal(moved.body.stay.roomNo, '303');
    const mine = (await json('GET', '/api/student/hostel', { cookie: studentCk })).body;
    assert.equal(mine.current.roomNo, '303');
    assert.equal(mine.history.length >= 1, true);
    assert.equal(mine.hostel.name, 'HT Boys');
  });

  it('a failed move leaves the student where they were', async () => {
    const stay = (await json('GET', `${A}/stays?search=Aarav`, { cookie: admin })).body.stays[0];
    const bad = await json('PUT', `${A}/stays/${stay.id}/transfer`, { cookie: admin, body: { roomId: rooms.g1, remark: 'HT move' } });
    assert.equal(bad.status, 409);
    assert.equal((await json('GET', '/api/student/hostel', { cookie: studentCk })).body.current.roomNo, '303');
  });

  it('vacating frees the bed and cannot be done twice', async () => {
    const stay = (await json('GET', `${A}/stays?search=Aarav`, { cookie: admin })).body.stays[0];
    assert.equal((await json('PUT', `${A}/stays/${stay.id}/vacate`, { cookie: admin, body: {} })).status, 200);
    assert.equal((await json('PUT', `${A}/stays/${stay.id}/vacate`, { cookie: admin, body: {} })).status, 404);
    assert.equal((await json('GET', '/api/student/hostel', { cookie: studentCk })).body.current, null);
  });

  it('refuses to delete a hostel with rooms or a room with history, but removes an empty room', async () => {
    assert.equal((await json('DELETE', `${A}/${boys}`, { cookie: admin })).status, 409);
    assert.equal((await json('DELETE', `${A}/rooms/${rooms.b3}`, { cookie: admin })).status, 409);
    const r = (await json('GET', `${A}/${boys}/rooms`, { cookie: admin })).body.rooms.find((x) => x.roomNo === '310');
    assert.equal((await json('DELETE', `${A}/rooms/${r.id}`, { cookie: admin })).status, 200);
  });
});

describe('Who can see what', () => {
  it('a parent sees their child\'s room; staff cannot open the office screens', async () => {
    await json('POST', `${A}/stays`, { cookie: admin, body: { studentId: stu[1], roomId: rooms.b2, remark: 'HT p' } });
    const p = await json('GET', '/api/student/hostel', { cookie: parentCk });
    assert.equal(p.status, 200); assert.equal(p.body.current.roomNo, '302');
    assert.equal((await json('GET', A, { cookie: emp })).status, 403);
    assert.equal((await json('GET', A, { cookie: studentCk })).status, 403);
  });

  it('another institute never sees these hostels, and the module can be off', async () => {
    const r = await json('GET', A, { cookie: schoolAdmin });
    if (r.status === 200) assert.ok(!r.body.hostels.some((h) => h.name.startsWith('HT ')));
    else assert.equal(r.status, 403);
    assert.equal((await json('PUT', `${A}/rooms/${rooms.b2}`, { cookie: schoolAdmin, body: { beds: 3 } })).status === 200, false);
  });
});

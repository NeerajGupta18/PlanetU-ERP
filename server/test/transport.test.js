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
const A = '/api/admin/transport';
const cleanup = async () => withTx({ tenantId }, async () => {
  await q("delete from transport_rides where route_id in (select id from transport_routes where name like 'TT %')");
  await q("delete from transport_routes where name like 'TT %'");
  for (const id of seeded) await q("update transport_rides set status = 'active', to_date = null where id = $1", [id]);
});

before(async () => {
  await start();
  admin = await login('demo-college', 'admin', 'ADM001', 'Admin@123');
  schoolAdmin = await login('demo-school', 'admin', 'ADM001', 'Admin@123');
  emp = await login('demo-college', 'employee', 'EMP001', 'Employee@123');
  studentCk = await login('demo-college', 'student', 'STU2026001', 'Student@123');
  parentCk = await login('demo-college', 'parent', 'PAR001', 'Parent@123');
  const rows = (await withTx({ tenantId }, () => q("select id, student_code from students where student_code in ('STU2026001','STU2026002','STU2026003')"))).rows;
  for (const r of rows) stu[r.student_code.slice(-1)] = r.id;
  seeded = (await withTx({ tenantId }, () => q("select id from transport_rides where status = 'active'"))).rows.map((r) => r.id);
  await withTx({ tenantId }, () => q("update transport_rides set status = 'ended', to_date = current_date where status = 'active'"));
  await cleanup();
  await withTx({ tenantId }, () => q("update transport_rides set status = 'ended', to_date = current_date where status = 'active'"));
});
after(async () => { await cleanup(); await stop(); });

let route; let stops = [];

describe('Routes and stops (office)', () => {
  it('creates a route with ordered stops and rejects bad input', async () => {
    const r = await json('POST', A, { cookie: admin, body: { name: 'TT Route', vehicleNo: 'MH 12 ZZ 1', driverName: 'Test Driver', seats: 2, monthlyFee: 1200, stops: [{ name: 'First', pickupTime: '07:00' }, { name: 'Second', pickupTime: '07:20' }, { name: 'Third' }] } });
    assert.equal(r.status, 201);
    route = r.body.route.id; stops = r.body.route.stops;
    assert.deepEqual(stops.map((s) => s.name), ['First', 'Second', 'Third']);
    assert.equal((await json('POST', A, { cookie: admin, body: { name: 'tt route', seats: 5 } })).status, 409);
    assert.equal((await json('POST', A, { cookie: admin, body: { name: 'TT Bad', seats: 0 } })).status, 400);
    assert.equal((await json('POST', A, { cookie: admin, body: { name: 'TT Bad', stops: [{ name: 'A', pickupTime: '25:00' }] } })).status, 400);
    assert.equal((await json('POST', A, { cookie: admin, body: { name: 'TT Bad', stops: [{ name: 'A' }, { name: 'a' }] } })).status, 400);
  });

  it('reorders and renames stops without losing them', async () => {
    const r = await json('PUT', `${A}/${route}`, { cookie: admin, body: { name: 'TT Route', seats: 2, monthlyFee: 1200, stops: [stops[2], { ...stops[0], name: 'First Stop' }, stops[1]] } });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.route.stops.map((s) => s.name), ['Third', 'First Stop', 'Second']);
    assert.equal(r.body.route.stops[1].id, stops[0].id);
    stops = r.body.route.stops;
  });
});

describe('Putting students on a route', () => {
  it('assigns a student, and one student has only one current ride', async () => {
    const ok = await json('POST', `${A}/rides`, { cookie: admin, body: { studentId: stu[1], stopId: stops[0].id } });
    assert.equal(ok.status, 201); assert.equal(ok.body.ride.route, 'TT Route');
    assert.equal((await json('POST', `${A}/rides`, { cookie: admin, body: { studentId: stu[1], stopId: stops[1].id } })).status, 409);
  });

  it('refuses when the route is full, and refuses fewer seats than riders', async () => {
    assert.equal((await json('POST', `${A}/rides`, { cookie: admin, body: { studentId: stu[2], stopId: stops[1].id } })).status, 201);
    assert.equal((await json('POST', `${A}/rides`, { cookie: admin, body: { studentId: stu[3], stopId: stops[1].id } })).status, 409);
    const cut = await json('PUT', `${A}/${route}`, { cookie: admin, body: { name: 'TT Route', seats: 1 } });
    assert.equal(cut.status, 409);
  });

  it('will not remove a stop that has riders', async () => {
    const r = await json('PUT', `${A}/${route}`, { cookie: admin, body: { name: 'TT Route', seats: 2, stops: [stops[0], stops[1]] } });
    assert.equal(r.status, 200); // the unused stop goes
    const bad = await json('PUT', `${A}/${route}`, { cookie: admin, body: { name: 'TT Route', seats: 2, stops: [stops[1]] } });
    assert.equal(bad.status, 409);
  });

  it('changes a stop (history kept), and ending frees the seat', async () => {
    const ride = (await json('GET', `${A}/rides?search=Aarav`, { cookie: admin })).body.rides[0];
    const ch = await json('PUT', `${A}/rides/${ride.id}/change`, { cookie: admin, body: { stopId: stops[1].id } });
    assert.equal(ch.status, 200); assert.equal(ch.body.ride.stop, 'First Stop');
    const mine = (await json('GET', '/api/student/transport', { cookie: studentCk })).body;
    assert.equal(mine.current.stop, 'First Stop'); assert.ok(mine.history.length >= 1);
    const cur = (await json('GET', `${A}/rides?search=Aarav`, { cookie: admin })).body.rides[0];
    assert.equal((await json('PUT', `${A}/rides/${cur.id}/end`, { cookie: admin, body: {} })).status, 200);
    assert.equal((await json('PUT', `${A}/rides/${cur.id}/end`, { cookie: admin, body: {} })).status, 404);
    assert.equal((await json('GET', '/api/student/transport', { cookie: studentCk })).body.current, null);
  });

  it('deleting a route that has ride records is refused', async () => {
    assert.equal((await json('DELETE', `${A}/${route}`, { cookie: admin })).status, 409);
  });
});

describe('Who can see what', () => {
  it('a parent sees the child\'s route; others cannot use the office screens', async () => {
    await json('POST', `${A}/rides`, { cookie: admin, body: { studentId: stu[1], stopId: stops[0].id } });
    const p = await json('GET', '/api/student/transport', { cookie: parentCk });
    assert.equal(p.status, 200); assert.equal(p.body.current.route, 'TT Route');
    assert.equal((await json('GET', A, { cookie: emp })).status, 403);
    assert.equal((await json('GET', A, { cookie: studentCk })).status, 403);
  });

  it('another institute never sees these routes', async () => {
    const r = await json('GET', A, { cookie: schoolAdmin });
    assert.equal(r.status, 200);
    assert.ok(!r.body.routes.some((x) => x.name.startsWith('TT ')));
    assert.equal((await json('PUT', `${A}/${route}`, { cookie: schoolAdmin, body: { name: 'Hijack', seats: 5 } })).status, 404);
  });
});

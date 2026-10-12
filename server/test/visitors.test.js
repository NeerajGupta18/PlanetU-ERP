/** Visitor management - run with `npm test` (needs `npm run db:setup` first). */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { env } from '../src/config/env.js';
import { createApp } from '../src/app.js';
import { closePool, q, withTx } from '../src/db/pool.js';
import { issueCaptchaToken } from '../src/services/captcha.service.js';
import { addDays, toISO } from '../src/utils/dates.js';

let server; let base; let tenantId;
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
const A = '/api/admin/visitors';
const E = '/api/employee/visitors';
let admin; let uniAdmin; let empA; let empB; let student; let hostA; let hostB;
const ok = { visitorName: 'VT Guest', purpose: 'Meeting', phone: '99999 00000' };

before(async () => {
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  admin = await login('demo-college', 'admin', 'ADM001', 'Admin@123');
  uniAdmin = await login('demo-university', 'admin', 'ADM001', 'Admin@123');
  empA = await login('demo-college', 'employee', 'EMP001', 'Employee@123');
  empB = await login('demo-college', 'employee', 'EMP002', 'Employee@123');
  student = await login('demo-college', 'student', 'STU2026001', 'Student@123');
  tenantId = (await withTx({ platform: true }, () => q("select id from tenants where code = 'demo-college'"))).rows[0].id;
  await withTx({ tenantId }, async () => {
    hostA = (await q("select id from employees where emp_code = 'EMP001'")).rows[0].id;
    hostB = (await q("select id from employees where emp_code = 'EMP002'")).rows[0].id;
  });
});
after(async () => {
  await withTx({ tenantId }, () => q("delete from visitor_visits where visitor_name like 'VT %'"));
  server.close(); await closePool();
});

describe('visitor management', () => {
  it('is for the office and staff only', async () => {
    assert.equal((await json('GET', A, { cookie: student })).status, 403);
    assert.equal((await json('POST', A, { cookie: student, body: ok })).status, 403);
    assert.equal((await json('GET', A, { cookie: empA })).status, 403);
    assert.equal((await json('GET', A, { cookie: admin })).status, 200);
    assert.equal((await json('GET', E, { cookie: empA })).status, 200);
  });

  it('validates a registration', async () => {
    assert.equal((await json('POST', A, { cookie: admin, body: { ...ok, visitorName: ' ' } })).status, 400);
    assert.equal((await json('POST', A, { cookie: admin, body: { ...ok, purpose: 'Sightseeing' } })).status, 400);
    assert.equal((await json('POST', A, { cookie: admin, body: { ...ok, people: 0 } })).status, 400);
    assert.equal((await json('POST', A, { cookie: admin, body: { ...ok, email: 'nope' } })).status, 400);
    assert.equal((await json('POST', A, { cookie: admin, body: { ...ok, hostId: '00000000-0000-4000-8000-000000000000' } })).status, 400);
    assert.equal((await json('POST', A, { cookie: admin, body: { ...ok, expectedOn: toISO(addDays(new Date(), -3)) } })).status, 400);
    assert.equal((await json('POST', A, { cookie: admin, body: { ...ok, idShown: 'Library card' } })).status, 400);
  });

  let pre;
  it('pre-registers a visitor, who gets a pass number', async () => {
    const r = await json('POST', A, { cookie: admin, body: { ...ok, hostId: hostA, organisation: 'Acme', vehicleNo: 'mh12ab1234' } });
    assert.equal(r.status, 201); pre = r.body.visit;
    assert.match(pre.passNo, /^VIS\d{5}$/); assert.equal(pre.status, 'expected'); assert.equal(pre.vehicleNo, 'MH12AB1234');
    const r2 = await json('POST', A, { cookie: admin, body: { ...ok, visitorName: 'VT Guest 2' } });
    assert.notEqual(r2.body.visit.passNo, pre.passNo);
  });

  it('cannot leave before arriving, then checks in and out once', async () => {
    assert.equal((await json('POST', `${A}/${pre.id}/check-out`, { cookie: admin })).status, 409);
    const inn = await json('POST', `${A}/${pre.id}/check-in`, { cookie: admin, body: { idShown: 'Aadhaar' } });
    assert.equal(inn.status, 200); assert.equal(inn.body.visit.status, 'checked_in'); assert.equal(inn.body.visit.idShown, 'Aadhaar');
    assert.equal((await json('POST', `${A}/${pre.id}/check-in`, { cookie: admin })).status, 409);
    assert.equal((await json('POST', `${A}/${pre.id}/cancel`, { cookie: admin })).status, 409);
    const sum = (await json('GET', `${A}/summary`, { cookie: admin })).body;
    assert.ok(sum.inCampus >= 1);
    const out = await json('POST', `${A}/${pre.id}/check-out`, { cookie: admin });
    assert.equal(out.status, 200); assert.equal(out.body.visit.status, 'checked_out'); assert.ok(out.body.visit.checkOutAt);
    assert.equal((await json('POST', `${A}/${pre.id}/check-out`, { cookie: admin })).status, 409);
  });

  it('logs a walk-in as already inside and emails the host', async () => {
    const before0 = (await withTx({ tenantId }, () => q("select count(*)::int as n from notifications where template = 'visitorArrived'"))).rows[0].n;
    const r = await json('POST', A, { cookie: admin, body: { ...ok, visitorName: 'VT Walkin', hostId: hostB, checkIn: true } });
    assert.equal(r.status, 201); assert.equal(r.body.visit.status, 'checked_in'); assert.ok(r.body.visit.checkInAt);
    const after0 = (await withTx({ tenantId }, () => q("select count(*)::int as n from notifications where template = 'visitorArrived'"))).rows[0].n;
    assert.equal(after0, before0 + 1);
  });

  it('a staff member registers only for themselves and sees only their own visitors', async () => {
    const r = await json('POST', E, { cookie: empA, body: { ...ok, visitorName: 'VT Mine', hostId: hostB, checkIn: true } });
    assert.equal(r.status, 201);
    assert.equal(r.body.visit.hostId, hostA); // host forced to the signed-in staff member
    assert.equal(r.body.visit.status, 'expected'); // staff cannot check people in
    const mineA = (await json('GET', E, { cookie: empA })).body.visits;
    assert.ok(mineA.every((v) => v.hostId === hostA));
    assert.ok(mineA.some((v) => v.visitorName === 'VT Mine'));
    const mineB = (await json('GET', E, { cookie: empB })).body.visits;
    assert.equal(mineB.some((v) => v.visitorName === 'VT Mine'), false);
    assert.equal((await json('POST', `${E}/${r.body.visit.id}/cancel`, { cookie: empB })).status, 403);
    const c = await json('POST', `${E}/${r.body.visit.id}/cancel`, { cookie: empA });
    assert.equal(c.status, 200); assert.equal(c.body.visit.status, 'cancelled');
    assert.equal((await json('POST', `${A}/${r.body.visit.id}/check-in`, { cookie: admin })).status, 409);
  });

  it('filters and searches the log', async () => {
    const open = (await json('GET', `${A}?scope=open`, { cookie: admin })).body.visits;
    assert.ok(open.every((v) => ['expected', 'checked_in'].includes(v.status)));
    const found = (await json('GET', `${A}?search=walkin`, { cookie: admin })).body.visits;
    assert.ok(found.length >= 1 && found.every((v) => /walkin/i.test(v.visitorName)));
    assert.equal((await json('POST', `${A}/not-a-uuid/check-in`, { cookie: admin })).status, 404);
  });

  it('keeps one institute\'s visitors away from another', async () => {
    const list = (await json('GET', A, { cookie: uniAdmin })).body.visits;
    assert.equal(list.some((v) => v.visitorName.startsWith('VT ')), false);
    assert.equal((await json('POST', `${A}/${pre.id}/check-in`, { cookie: uniAdmin })).status, 404);
  });
});

/** Assets - run with `npm test` (needs `npm run db:setup` first). */
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

let admin; let schoolAdmin; let tenantId; let empId;
before(async () => {
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  admin = await login('demo-college', 'admin', 'ADM001', 'Admin@123');
  schoolAdmin = await login('demo-school', 'admin', 'ADM001', 'Admin@123');
  tenantId = (await withTx({ platform: true }, () => q("select id from tenants where code = 'demo-college'"))).rows[0].id;
  ({ rows: [{ id: empId }] } = await withTx({ tenantId }, () => q('select id from employees limit 1')));
});
after(async () => {
  await withTx({ tenantId }, () => q("delete from assets where name like 'Test Asset%'"));
  const schoolTenantId = (await withTx({ platform: true }, () => q("select id from tenants where code = 'demo-school'"))).rows[0].id;
  await withTx({ tenantId: schoolTenantId }, () => q("delete from assets where name like 'Test Asset%'"));
  await new Promise((r) => server.close(r));
  await closePool();
});

describe('Row Level Security (database)', () => {
  it('with no tenant context, assets tables are empty; an asset is invisible under another tenant', async () => {
    await withTx({}, async () => {
      assert.equal((await q('select count(*)::int as n from assets')).rows[0].n, 0);
      assert.equal((await q('select count(*)::int as n from asset_logs')).rows[0].n, 0);
    });
    const assetId = await withTx({ tenantId }, async () => (
      await q("insert into assets (asset_tag, name) values ('RLS-PROBE', 'RLS probe') returning id")
    ).rows[0].id);
    const schoolTenantId = (await withTx({ platform: true }, () => q("select id from tenants where code = 'demo-school'"))).rows[0].id;
    try {
      await withTx({ tenantId: schoolTenantId }, async () => {
        assert.equal((await q('select count(*)::int as n from assets where id = $1', [assetId])).rows[0].n, 0);
      });
    } finally {
      await withTx({ tenantId }, () => q('delete from assets where id = $1', [assetId]));
    }
  });
});

describe('Asset register', () => {
  it('creates an asset with an auto-generated tag; rejects an unknown department', async () => {
    const bad = await json('POST', '/api/admin/assets', { cookie: admin, body: { name: '' } });
    assert.equal(bad.status, 400);
    const badDept = await json('POST', '/api/admin/assets', { cookie: admin, body: { name: 'Test Asset One', departmentId: '00000000-0000-0000-0000-000000000000' } });
    assert.equal(badDept.status, 400);
    const r = await json('POST', '/api/admin/assets', { cookie: admin, body: { name: 'Test Asset One', category: 'Computer', location: 'Lab 1' } });
    assert.equal(r.status, 201);
    assert.match(r.body.asset.assetTag, /^AST\d{5}$/);
    assert.equal(r.body.asset.status, 'available');
    assert.equal(r.body.asset.logs.length, 1);
    assert.equal(r.body.asset.logs[0].action, 'created');
  });

  it('tags are sequential and per-tenant; another institute cannot see or edit this asset', async () => {
    const r2 = await json('POST', '/api/admin/assets', { cookie: admin, body: { name: 'Test Asset Two' } });
    const n1 = Number(r2.body.asset.assetTag.slice(3));
    const r3 = await json('POST', '/api/admin/assets', { cookie: admin, body: { name: 'Test Asset Three' } });
    assert.equal(Number(r3.body.asset.assetTag.slice(3)), n1 + 1);

    assert.equal((await json('GET', `/api/admin/assets/${r2.body.asset.id}`, { cookie: schoolAdmin })).status, 404);
    assert.equal((await json('PUT', `/api/admin/assets/${r2.body.asset.id}`, { cookie: schoolAdmin, body: { name: 'Hacked' } })).status, 404);
    // another institute's own tag sequence is independent of the college's (not sharing the same counter)
    const schoolAsset = await json('POST', '/api/admin/assets', { cookie: schoolAdmin, body: { name: 'Test Asset School' } });
    assert.match(schoolAsset.body.asset.assetTag, /^AST\d{5}$/);
  });
});

describe('Assignment and status', () => {
  let assetId;
  before(async () => { assetId = (await json('POST', '/api/admin/assets', { cookie: admin, body: { name: 'Test Asset Assign' } })).body.asset.id; });

  it('assigning sets status to in_use; unassigning clears it', async () => {
    const bad = await json('PUT', `/api/admin/assets/${assetId}/assign`, { cookie: admin, body: { employeeId: '00000000-0000-0000-0000-000000000000' } });
    assert.equal(bad.status, 404);
    const r = await json('PUT', `/api/admin/assets/${assetId}/assign`, { cookie: admin, body: { employeeId: empId } });
    assert.equal(r.status, 200);
    assert.equal(r.body.asset.status, 'in_use');
    assert.equal(r.body.asset.assignedTo, empId);
    const noop = await json('PUT', `/api/admin/assets/${assetId}/unassign`, { cookie: schoolAdmin });
    assert.equal(noop.status, 404); // another institute can't touch it
    const un = await json('PUT', `/api/admin/assets/${assetId}/unassign`, { cookie: admin });
    assert.equal(un.body.asset.status, 'available');
    assert.equal(un.body.asset.assignedTo, null);
    assert.equal((await json('PUT', `/api/admin/assets/${assetId}/unassign`, { cookie: admin })).status, 409); // already unassigned
  });

  it('cannot set in_use without an assignment; retiring clears any assignment', async () => {
    const bad = await json('PUT', `/api/admin/assets/${assetId}/status`, { cookie: admin, body: { status: 'in_use' } });
    assert.equal(bad.status, 400);
    await json('PUT', `/api/admin/assets/${assetId}/assign`, { cookie: admin, body: { employeeId: empId } });
    const retire = await json('PUT', `/api/admin/assets/${assetId}/status`, { cookie: admin, body: { status: 'retired', note: 'End of life' } });
    assert.equal(retire.body.asset.status, 'retired');
    assert.equal(retire.body.asset.assignedTo, null);
    assert.equal((await json('PUT', `/api/admin/assets/${assetId}/assign`, { cookie: admin, body: { employeeId: empId } })).status, 409); // cannot assign a retired asset
    assert.equal((await json('PUT', `/api/admin/assets/${assetId}/status`, { cookie: admin, body: { status: 'bogus' } })).status, 400);
  });

  it('logs maintenance with a cost, and the log is visible on the asset', async () => {
    const noNote = await json('POST', `/api/admin/assets/${assetId}/maintenance`, { cookie: admin, body: { cost: 500 } });
    assert.equal(noNote.status, 400);
    const r = await json('POST', `/api/admin/assets/${assetId}/maintenance`, { cookie: admin, body: { note: 'Replaced battery', cost: 500 } });
    assert.equal(r.status, 200);
    const entry = r.body.asset.logs.find((l) => l.action === 'maintenance');
    assert.equal(entry.note, 'Replaced battery');
    assert.equal(Number(entry.cost), 500);
  });
});

describe('Filters and deletion', () => {
  it('filters by search, status and category', async () => {
    await json('POST', '/api/admin/assets', { cookie: admin, body: { name: 'Test Asset Filter', category: 'Furniture' } });
    const byCat = await json('GET', '/api/admin/assets?category=Furniture', { cookie: admin });
    assert.ok(byCat.body.assets.every((a) => a.category === 'Furniture'));
    const bySearch = await json('GET', '/api/admin/assets?search=Filter', { cookie: admin });
    assert.ok(bySearch.body.assets.some((a) => a.name === 'Test Asset Filter'));
    const byStatus = await json('GET', '/api/admin/assets?status=available', { cookie: admin });
    assert.ok(byStatus.body.assets.every((a) => a.status === 'available'));
  });

  it('deleting removes the asset and its logs', async () => {
    const r = await json('POST', '/api/admin/assets', { cookie: admin, body: { name: 'Test Asset Delete Me' } });
    assert.equal((await json('DELETE', `/api/admin/assets/${r.body.asset.id}`, { cookie: schoolAdmin })).status, 404);
    assert.equal((await json('DELETE', `/api/admin/assets/${r.body.asset.id}`, { cookie: admin })).status, 200);
    assert.equal((await json('GET', `/api/admin/assets/${r.body.asset.id}`, { cookie: admin })).status, 404);
  });
});

describe('Assets module gating', () => {
  it('can be switched off independently of other modules', async () => {
    const sa = await login('', 'super_admin', 'SA001', 'SuperAdmin@123');
    const list = (await json('GET', '/api/super-admin/tenants', { cookie: sa })).body.tenants;
    const college = list.find((t) => t.code === 'demo-college');
    await json('PUT', `/api/super-admin/tenants/${college.id}`, { cookie: sa, body: { modules: college.modules.filter((m) => m !== 'assets') } });
    assert.equal((await json('GET', '/api/admin/assets', { cookie: admin })).status, 403);
    assert.equal((await json('GET', '/api/admin/employees', { cookie: admin })).status, 200);
    await json('PUT', `/api/super-admin/tenants/${college.id}`, { cookie: sa, body: { modules: college.modules } });
  });
});

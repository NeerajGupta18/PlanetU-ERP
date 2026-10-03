/** File storage inside PostgreSQL (STORAGE_DRIVER=db), for hosts with no persistent disk. */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, describe, it } from 'node:test';
import { closePool, q, withTx } from '../src/db/pool.js';
import * as dbStore from '../src/storage/db.js';

const tenantId = async (code) => (await withTx({ platform: true }, () => q('select id from tenants where code = $1', [code]))).rows[0].id;
const keyFor = (t) => `${t}/${crypto.randomUUID()}`;
const made = [];
after(async () => {
  for (const k of made) await dbStore.remove(k).catch(() => {});
  await closePool();
});

describe('Database file store', () => {
  it('stores, returns and removes bytes exactly', async () => {
    const t = await tenantId('demo-college'); const key = keyFor(t); made.push(key);
    const bytes = Buffer.concat([Buffer.from('%PDF-1.4\n'), crypto.randomBytes(300_000), Buffer.from([0, 255, 0, 10, 13])]);
    await dbStore.put(key, bytes);
    assert.ok((await dbStore.get(key)).equals(bytes), 'byte-for-byte identical, including binary and NUL bytes');
    await dbStore.remove(key);
    await assert.rejects(dbStore.get(key), (e) => e.code === 'ENOENT');
    await dbStore.remove(key); // removing twice is harmless
  });

  it('refuses a key that is not "<tenant uuid>/<uuid>" - nothing user-supplied can steer it', async () => {
    for (const bad of ['../etc/passwd', 'x/y', '', 'not-a-uuid/also-not', `${crypto.randomUUID()}/../${crypto.randomUUID()}`, `${crypto.randomUUID()}`]) {
      await assert.rejects(dbStore.put(bad, Buffer.from('x')), /Invalid storage key/, bad);
    }
  });

  it('will not overwrite an existing file (same rule as the disk store)', async () => {
    const t = await tenantId('demo-college'); const key = keyFor(t); made.push(key);
    await dbStore.put(key, Buffer.from('first'));
    await assert.rejects(dbStore.put(key, Buffer.from('second')));
    assert.equal((await dbStore.get(key)).toString(), 'first');
  });

  it("another institute cannot read an institute's stored file, even knowing the key", async () => {
    const a = await tenantId('demo-college'); const b = await tenantId('demo-school'); const key = keyFor(a); made.push(key);
    await dbStore.put(key, Buffer.from('secret certificate'));
    const asB = await withTx({ tenantId: b }, () => q('select storage_key from file_blobs where storage_key = $1', [key]));
    assert.equal(asB.rowCount, 0, 'row level security hides it from institute B');
    const asA = await withTx({ tenantId: a }, () => q('select storage_key from file_blobs where storage_key = $1', [key]));
    assert.equal(asA.rowCount, 1);
    await assert.rejects(withTx({ tenantId: b }, () => q('insert into file_blobs (storage_key, tenant_id, data) values ($1, $2, $3)', [keyFor(a), a, Buffer.from('x')])), 'B cannot plant a file in A');
  });

  it('is removed with its institute (no orphaned documents)', async () => {
    const { rows: [t] } = await withTx({ platform: true }, () => q("insert into tenants (code, name, type) values ('blobtest-gone', 'Blob Test', 'school') returning id"));
    await dbStore.put(`${t.id}/${crypto.randomUUID()}`, Buffer.from('x'));
    await withTx({ platform: true }, () => q('delete from tenants where id = $1', [t.id]));
    const n = await withTx({ platform: true }, () => q('select count(*)::int as n from file_blobs where tenant_id = $1', [t.id]));
    assert.equal(n.rows[0].n, 0);
  });
});

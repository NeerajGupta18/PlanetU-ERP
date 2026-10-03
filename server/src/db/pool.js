/**
 * PostgreSQL access + tenant context.
 *
 * Every query runs inside a transaction whose first statement sets
 * `app.tenant_id` (and `app.is_platform` for vendor-level work). Row Level
 * Security policies read those settings, so a query can never see or write
 * another tenant's rows - even if a controller forgets a WHERE clause.
 *
 *   await withTx({ tenantId }, async () => { await q('select ...') })
 *
 * `q()` finds the current transaction through AsyncLocalStorage, so
 * controllers never pass a connection around.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import pg from 'pg';
import { env } from '../config/env.js';

// Return DATE / TIME as plain strings ("2026-09-28", "09:00") - the whole app works in calendar strings.
pg.types.setTypeParser(1082, (v) => v);
pg.types.setTypeParser(1083, (v) => v.slice(0, 5));

const als = new AsyncLocalStorage();

export const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 10 });
// An idle-client error must not crash the process
pool.on('error', (err) => console.error('[db] idle client error', err.message));

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);

async function applyContext(client, { tenantId = null, platform = false }) {
  await client.query(
    "select set_config('app.tenant_id', $1, true), set_config('app.is_platform', $2, true)",
    [tenantId || '', platform ? 'on' : 'off'],
  );
}

/** Opens a transaction with the given tenant context. Caller must commit()/rollback(). */
export async function beginTx(ctx, targetPool = pool) {
  const client = await targetPool.connect();
  let done = false;
  try {
    await client.query('begin');
    await applyContext(client, ctx);
  } catch (err) {
    client.release(true);
    throw err;
  }
  const finish = async (commit) => {
    if (done) return;
    done = true;
    try { await client.query(commit ? 'commit' : 'rollback'); } finally { client.release(); }
  };
  return { client, commit: () => finish(true), rollback: () => finish(false), get done() { return done; } };
}

/** Runs fn inside a transaction with tenant context; commits on success, rolls back on error. */
export async function withTx(ctx, fn, targetPool = pool) {
  const tx = await beginTx(ctx, targetPool);
  try {
    const result = await als.run({ client: tx.client }, fn);
    await tx.commit();
    return result;
  } catch (err) {
    await tx.rollback().catch(() => {});
    throw err;
  }
}

/** Runs fn with an already-open transaction bound as the current one (used by the request middleware). */
export const runInTx = (tx, fn) => als.run({ client: tx.client }, fn);

/** Query using the current request/transaction. Fails closed when there is no tenant context. */
export function q(text, params) {
  const store = als.getStore();
  if (!store) throw new Error('Database access outside a tenant context');
  return store.client.query(text, params);
}

/**
 * Vendor-console helper: temporarily switch the current transaction to a
 * specific tenant (e.g. to count that tenant's rows), then switch back.
 */
export async function inTenant(tenantId, fn) {
  const store = als.getStore();
  if (!store) throw new Error('Database access outside a tenant context');
  const { rows: [prev] } = await store.client.query(
    "select current_setting('app.tenant_id', true) as t, current_setting('app.is_platform', true) as p",
  );
  await applyContext(store.client, { tenantId, platform: false });
  try {
    return await fn();
  } finally {
    await applyContext(store.client, { tenantId: prev.t || null, platform: prev.p === 'on' });
  }
}

export async function closePool() {
  await pool.end();
}

/** Point the current transaction at another tenant (used while provisioning a new client). */
export function switchTenant(tenantId) {
  const store = als.getStore();
  if (!store) throw new Error('Database access outside a tenant context');
  return store.client.query("select set_config('app.tenant_id', $1, true)", [tenantId || '']);
}

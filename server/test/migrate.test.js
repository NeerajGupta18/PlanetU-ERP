/** Migrations run the way they will on a real server: by a limited (non-superuser) database owner, again and again. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { after, before, describe, it } from 'node:test';
import pg from 'pg';
import { env } from '../src/config/env.js';
import { runMigrations } from '../src/db/migrate.js';

const OWNER = 'erp_migtest_owner';
const DB = 'planetu_migtest';
const original = env.MIGRATE_DATABASE_URL;
const admin = () => new pg.Client({ connectionString: original });
const limitedUrl = () => { const u = new URL(original); u.username = OWNER; u.password = 'Migtest-Pass-1'; u.pathname = `/${DB}`; return u.toString(); };

// These tests build throw-away databases and roles, so they need an account that may create roles
const canCreateRoles = await (async () => {
  const c = admin(); await c.connect();
  try { return (await c.query('select rolsuper or rolcreaterole as ok from pg_roles where rolname = current_user')).rows[0].ok; } finally { await c.end(); }
})();
const SKIP = canCreateRoles ? false : 'needs a database account that can create roles';

async function cleanup() {
  const c = admin(); await c.connect();
  try {
    await c.query(`drop database if exists ${DB} with (force)`);
    await c.query(`drop role if exists ${OWNER}`);
  } finally { await c.end(); }
}

before(async () => {
  if (!canCreateRoles) return;
  await cleanup();
  const c = admin(); await c.connect();
  try {
    await c.query(`create role ${OWNER} login createrole password 'Migtest-Pass-1'`);
    await c.query(`create database ${DB} owner ${OWNER}`);
  } finally { await c.end(); }
});
after(async () => { env.MIGRATE_DATABASE_URL = original; if (canCreateRoles) await cleanup(); });

describe('Migrations by a non-superuser database owner', { skip: SKIP }, () => {
  it('apply every migration, and a repeat run (what every update does) changes nothing and does not fail', async () => {
    const files = fs.readdirSync(env.MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).length;
    env.MIGRATE_DATABASE_URL = limitedUrl();
    try {
      const first = []; await runMigrations({ log: (m) => first.push(m) });
      assert.equal(first.filter((m) => /applied/.test(m)).length, files, 'all migrations applied by the limited owner');
      for (let i = 0; i < 2; i += 1) {
        const again = []; await runMigrations({ log: (m) => again.push(m) });
        assert.ok(again.some((m) => /up to date/.test(m)), 'a repeat run reports up to date');
        assert.ok(!again.some((m) => /applied/.test(m)));
      }
    } finally { env.MIGRATE_DATABASE_URL = original; }
  });

  it('the app role stays unable to bypass tenant isolation', async () => {
    const c = admin(); await c.connect();
    try {
      const { rows: [r] } = await c.query("select rolsuper, rolbypassrls, rolcreaterole, rolcreatedb from pg_roles where rolname = 'erp_app'");
      assert.deepEqual(r, { rolsuper: false, rolbypassrls: false, rolcreaterole: false, rolcreatedb: false });
    } finally { await c.end(); }
  });

  it('the schema the limited owner built enforces row-level security for the app role', async () => {
    const u = new URL(limitedUrl()); const c = new pg.Client({ connectionString: u.toString() }); await c.connect();
    try {
      const { rows } = await c.query("select relname, relrowsecurity, relforcerowsecurity from pg_class where relname in ('students', 'quizzes', 'billing_invoices', 'learning_enrollments') order by relname");
      assert.equal(rows.length, 4);
      for (const r of rows) assert.deepEqual([r.relrowsecurity, r.relforcerowsecurity], [true, true], r.relname);
    } finally { await c.end(); }
  });
});

describe('Single-role mode (a host that gives one login that cannot create roles)', { skip: SKIP }, () => {
  const ONE = 'erp_migtest_single'; const DB1 = 'planetu_migtest_single';
  const oneUrl = () => { const u = new URL(original); u.username = ONE; u.password = 'Migtest-Pass-2'; u.pathname = `/${DB1}`; return u.toString(); };
  const drop = async () => { const c = admin(); await c.connect(); try { await c.query(`drop database if exists ${DB1} with (force)`); await c.query(`drop role if exists ${ONE}`); } finally { await c.end(); } };
  before(async () => {
    await drop();
    const c = admin(); await c.connect();
    try { await c.query(`create role ${ONE} login password 'Migtest-Pass-2'`); await c.query(`create database ${DB1} owner ${ONE}`); } finally { await c.end(); }
  });
  after(async () => { env.DB_SINGLE_ROLE = false; env.MIGRATE_DATABASE_URL = original; await drop(); });

  it('builds the whole schema with an account that has no CREATEROLE, and a repeat run is a no-op', async () => {
    const files = fs.readdirSync(env.MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).length;
    env.DB_SINGLE_ROLE = true; env.MIGRATE_DATABASE_URL = oneUrl();
    const first = []; await runMigrations({ log: (m) => first.push(m) });
    assert.equal(first.filter((m) => /applied/.test(m)).length, files);
    assert.ok(first.some((m) => /single-role mode/.test(m)));
    const again = []; await runMigrations({ log: (m) => again.push(m) });
    assert.ok(again.some((m) => /up to date/.test(m)) && !again.some((m) => /applied/.test(m)));
  });

  it('still forces row-level security on every tenant table, so the owner account cannot see across institutes', async () => {
    const c = new pg.Client({ connectionString: oneUrl() }); await c.connect();
    try {
      const { rows } = await c.query("select c.relname, c.relrowsecurity, c.relforcerowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped) order by 1");
      assert.ok(rows.length > 30, `found ${rows.length} tenant tables`);
      const loose = rows.filter((r) => !(r.relrowsecurity && r.relforcerowsecurity)).map((r) => r.relname);
      assert.deepEqual(loose, [], 'every table that holds a tenant_id has forced row-level security');
      const me = (await c.query('select rolsuper, rolbypassrls from pg_roles where rolname = current_user')).rows[0];
      assert.deepEqual(me, { rolsuper: false, rolbypassrls: false });
    } finally { await c.end(); }
  });
});


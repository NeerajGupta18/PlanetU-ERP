/**
 * Applies migrations/*.sql in order (each once, in its own transaction) using the
 * OWNER connection, then makes sure the restricted application role exists and
 * has exactly the privileges it needs. Safe to run repeatedly.
 *
 *   npm run db:migrate
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { env } from '../config/env.js';

export async function runMigrations({ log = console.log } = {}) {
  const client = new pg.Client({ connectionString: env.MIGRATE_DATABASE_URL });
  await client.connect();
  try {
    await client.query(
      'create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())',
    );

    // The restricted role the API connects as: no superuser, no BYPASSRLS. It is what keeps one institute's data away
    // from another's, so its attributes are verified on every run.
    if (env.DB_SINGLE_ROLE) {
      log('[migrate] single-role mode: the app connects as the account that owns the tables (no separate erp_app role). Row Level Security is forced on every table.');
    }
    const pw = client.escapeLiteral(env.APP_DB_PASSWORD);
    const { rows: [role] } = env.DB_SINGLE_ROLE ? { rows: [undefined] } : await client.query(
      "select rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolcanlogin from pg_roles where rolname = 'erp_app'",
    );
    if (env.DB_SINGLE_ROLE) {
      // nothing to create or alter
    } else if (!role) {
      await client.query(`create role erp_app login password ${pw} nosuperuser nobypassrls nocreatedb nocreaterole`);
    } else {
      if (role.rolsuper || role.rolbypassrls || role.rolcreaterole || role.rolcreatedb || !role.rolcanlogin) {
        // Only touch the attributes when they are wrong: a limited (non-superuser) owner may not even re-state
        // NOBYPASSRLS, so an unconditional ALTER would fail on every run after the first.
        await client.query('alter role erp_app login nosuperuser nobypassrls nocreatedb nocreaterole');
      }
      try {
        await client.query(`alter role erp_app password ${pw}`);
      } catch (err) {
        if (err.code !== '42501') throw err; // insufficient_privilege: the role was made by someone else
        log('[migrate] note: could not set the erp_app password (the role was created by another account). Leaving it as it is.');
      }
    }

    const applied = new Set((await client.query('select name from schema_migrations')).rows.map((r) => r.name));
    const files = fs.readdirSync(env.MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = fs.readFileSync(path.join(env.MIGRATIONS_DIR, file), 'utf8');
      await client.query('begin');
      try {
        await client.query(sql);
        await client.query('insert into schema_migrations (name) values ($1)', [file]);
        await client.query('commit');
        log(`[migrate] applied ${file}`);
      } catch (err) {
        await client.query('rollback');
        throw new Error(`Migration ${file} failed: ${err.message}`);
      }
    }

    if (!env.DB_SINGLE_ROLE) await client.query(`
      grant usage on schema public to erp_app;
      grant select, insert, update, delete on all tables in schema public to erp_app;
      grant usage on all sequences in schema public to erp_app;
      alter default privileges in schema public grant select, insert, update, delete on tables to erp_app;
      alter default privileges in schema public grant usage on sequences to erp_app;
      revoke all on schema_migrations from erp_app;
      revoke update, delete on audit_log from erp_app;
    `);
    log('[migrate] up to date');
  } finally {
    await client.end();
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href) {
  runMigrations().catch((err) => { console.error(err.message); process.exit(1); });
}

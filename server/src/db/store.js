/**
 * Tiny JSON-file data store.
 *
 * Phase 1 keeps the setup zero-config (no database server needed). Everything
 * in the app reads data through `db()`, so moving to MySQL / PostgreSQL / MongoDB
 * later only means replacing this file and the small services that query it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { env } from '../config/env.js';
import { buildSeed, migrate, refreshDemoDates } from './seed.js';

let cache = null;

function writeToDisk() {
  fs.mkdirSync(path.dirname(env.DB_FILE), { recursive: true });
  const tmp = `${env.DB_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(cache, null, 2));
  fs.renameSync(tmp, env.DB_FILE);
}

export function db() {
  if (cache) return cache;
  if (fs.existsSync(env.DB_FILE)) {
    cache = JSON.parse(fs.readFileSync(env.DB_FILE, 'utf8'));
    // Demo data is anchored to "today" so the calendar/timetable always look alive.
    refreshDemoDates(cache);
    // Backfills collections added by later phases (e.g. Admin's departments/
    // designations) into a db.json that was seeded before they existed.
    migrate(cache);
  } else {
    cache = buildSeed();
    writeToDisk();
    console.log(`[db] Created demo database at ${env.DB_FILE}`);
  }
  return cache;
}

export function save() {
  writeToDisk();
}

export function resetDb() {
  cache = buildSeed();
  writeToDisk();
  return cache;
}

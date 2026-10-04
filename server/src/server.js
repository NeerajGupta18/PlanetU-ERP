import { env } from './config/env.js';
import { createApp } from './app.js';
import { pool } from './db/pool.js';
import { refreshDemoTenants } from './db/seed.js';
import { startMailWorker } from './services/notifications.service.js';
import { startBillingWorker } from './services/billingRun.service.js';
import { bootstrapVendorFromEnv } from './db/vendor.js';
import { ensureDemoInstitutes } from './db/seed.js';

// Fail early with a helpful message instead of a stack trace on the first request
try {
  const { rows: [r] } = await pool.query("select to_regclass('public.tenants') as t");
  if (!r.t) throw new Error('The database is empty (no tables yet).');

  // Tenant isolation relies on Row Level Security. PostgreSQL superusers and BYPASSRLS roles skip it entirely,
  // which would silently turn isolation OFF - so refuse to run as one.
  const { rows: [role] } = await pool.query(
    'select current_user as name, rolsuper, rolbypassrls from pg_roles where rolname = current_user',
  );
  if (role.rolsuper || role.rolbypassrls) {
    throw new Error(
      `DATABASE_URL connects as "${role.name}", which bypasses Row Level Security (superuser/BYPASSRLS). `
      + 'Connect as a restricted account: the erp_app role (the owner role is only for migrations), or, on a host that gives you a single non-superuser login, set DB_SINGLE_ROLE=true.',
    );
  }
} catch (err) {
  console.error(`\n[db] Cannot use PostgreSQL at ${env.DATABASE_URL.replace(/:[^:@/]+@/, ':****@')}\n     ${err.message}`);
  console.error('     Check DATABASE_URL, that PostgreSQL is running (docker compose up -d), and that you ran: npm run db:setup\n');
  process.exit(1);
}

await bootstrapVendorFromEnv();
if (env.DEMO_MODE) {
  // A failure here must not stop the real site from starting
  try { await ensureDemoInstitutes({ reset: env.DEMO_RESET_ON_START }); } catch (e) { console.error('[demo] could not load the sample institutes:', e.message); }
} // hosts without a shell: create the owner account from VENDOR_* settings (only if missing)
if (env.DEMO_REFRESH) await refreshDemoTenants(); // keep demo dates anchored to today (development only)

// Loud on purpose: reCAPTCHA silently falling back to the custom check
// (e.g. one key missing, a stray quote/space pasted into .env, or the
// server not restarted after editing .env) is the #1 cause of "I added
// the keys but it's still showing the old checkbox" confusion.
if (env.RECAPTCHA_ENABLED) {
  console.log(`[captcha] Google reCAPTCHA v2 is ACTIVE (site key: ${env.RECAPTCHA_SITE_KEY.slice(0, 10)}...)`);
} else if (env.RECAPTCHA_SITE_KEY || env.RECAPTCHA_SECRET_KEY) {
  console.warn(
    '[captcha] WARNING: only one of RECAPTCHA_SITE_KEY / RECAPTCHA_SECRET_KEY is set in server/.env - '
    + 'BOTH are required. Falling back to the built-in custom check until both are set.',
  );
} else {
  console.log('[captcha] Using the built-in custom human check (no RECAPTCHA_SITE_KEY/RECAPTCHA_SECRET_KEY set in server/.env).');
}

if (env.isProd && env.MAIL_TRANSPORT !== 'smtp') {
  console.warn('[mail] WARNING: MAIL_TRANSPORT is not "smtp" - password links and notifications will NOT reach anyone. Set MAIL_TRANSPORT=smtp and SMTP_URL.');
}
if (env.MAIL_WORKER) startMailWorker(env.MAIL_POLL_SECONDS * 1000);
if (env.BILLING_WORKER) startBillingWorker();
if (env.isProd && !env.BILLING_VENDOR_GSTIN) console.warn('[billing] WARNING: BILLING_VENDOR_GSTIN is not set - invoices will not carry your GSTIN. See .env.example.');

createApp().listen(env.PORT, () => {
  console.log(`[api] PlanetU ERP API running on http://localhost:${env.PORT}`);
});

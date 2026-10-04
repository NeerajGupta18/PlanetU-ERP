import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(__dirname, '../..');

const isProd = process.env.NODE_ENV === 'production';

if (!['local', 'db'].includes(process.env.STORAGE_DRIVER || 'local')) {
  throw new Error('STORAGE_DRIVER must be "local" or "db"');
}
if (isProd && !process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET must be set when NODE_ENV=production');
}

export const env = {
  isProd,
  PORT: Number(process.env.PORT) || 5000,
  JWT_SECRET: process.env.JWT_SECRET || 'dev-only-secret-do-not-use-in-production-0123456789',
  COOKIE_NAME: 'erp_session',
  COOKIE_SECURE: process.env.COOKIE_SECURE === 'true',
  SESSION_HOURS: 8,
  // PostgreSQL. The app connects as a restricted role (erp_app) so Row Level
  // Security is always enforced. Migrations/seeding use the owner connection.
  DATABASE_URL: process.env.DATABASE_URL || 'postgres://erp_app:erp_app_dev@localhost:5432/planetu_erp',
  MIGRATE_DATABASE_URL: process.env.MIGRATE_DATABASE_URL || 'postgres://erp_owner:erp_owner_dev@localhost:5432/planetu_erp',
  APP_DB_PASSWORD: process.env.APP_DB_PASSWORD || 'erp_app_dev',
  // Email. 'log' prints mail to the console (development); 'smtp' sends through SMTP_URL.
  // Read lazily so tests and hosting platforms can change them at runtime.
  get MAIL_TRANSPORT() { return process.env.MAIL_TRANSPORT || 'log'; },
  get SMTP_URL() { return process.env.SMTP_URL || ''; },
  get MAIL_FROM_ADDRESS() { return process.env.MAIL_FROM_ADDRESS || 'no-reply@planetu.example'; },
  // One database account both owns the tables and runs the app. For hosts that give you a single database login and
  // do not let it create roles (Row Level Security is still FORCED on every table; the server refuses to start if
  // that one account could bypass it). Leave off wherever you can create the separate restricted erp_app role.
  DB_SINGLE_ROLE: process.env.DB_SINGLE_ROLE === 'true',
  // Where uploaded files are kept: 'local' (a folder on disk) or 'db' (inside PostgreSQL, for hosts with no persistent disk)
  STORAGE_DRIVER: process.env.STORAGE_DRIVER || 'local',
  // How many proxies sit between the internet and the app. Wrong values make every visitor look like one IP
  // (shared rate limits) or let a visitor forge their IP. The vendor can check it: /api/super-admin/diagnostics/network
  TRUST_PROXY_HOPS: Math.min(5, Math.max(0, Number.parseInt(process.env.TRUST_PROXY_HOPS ?? '1', 10) || 0)),
  // Public demo: loads the sample institutes at start-up (only the ones that are missing) and lists their sign-ins on the
  // login page for one-click filling. Never includes the platform owner. Their passwords cannot be changed while this is on.
  DEMO_MODE: process.env.DEMO_MODE === 'true',
  // With DEMO_MODE: rebuild the sample institutes from scratch on every start (the free Render plan restarts when it wakes up)
  DEMO_RESET_ON_START: process.env.DEMO_RESET_ON_START === 'true',
  MAIL_WORKER: process.env.MAIL_WORKER !== 'false',
  // How often the mail outbox is checked. 15s is right for a normal database; raise it (e.g. 300) on a database that
  // sleeps when idle, so the poll does not keep it awake around the clock.
  MAIL_POLL_SECONDS: Math.min(3600, Math.max(5, Number(process.env.MAIL_POLL_SECONDS) || 15)),
  // Public address of the web app - used in the links inside emails
  // Render (and similar hosts) tell the app its own public address; use it when APP_URL is not set by hand
  get APP_URL() { return (process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || 'http://localhost:5173').replace(/\/$/, ''); },
  UPLOAD_DIR: process.env.UPLOAD_DIR || path.join(serverRoot, 'data', 'uploads'),
  MIGRATIONS_DIR: path.join(serverRoot, 'migrations'),
  // Re-anchor the demo tenants' rolling dates (events, duties, notices) to today on start
  DEMO_REFRESH: process.env.DEMO_REFRESH ? process.env.DEMO_REFRESH === 'true' : !isProd,
  CLIENT_DIST: path.resolve(serverRoot, '../client/dist'),

  // Google reCAPTCHA v2. Both keys must be set to enable it; otherwise the
  // app automatically falls back to the built-in custom human check.
  RECAPTCHA_SITE_KEY: process.env.RECAPTCHA_SITE_KEY || '',
  RECAPTCHA_SECRET_KEY: process.env.RECAPTCHA_SECRET_KEY || '',
  get RECAPTCHA_ENABLED() {
    return Boolean(this.RECAPTCHA_SITE_KEY && this.RECAPTCHA_SECRET_KEY);
  },

  // Razorpay (online fee payments). KEY_ID is public (sent to the browser); KEY_SECRET and
  // WEBHOOK_SECRET must never leave the server. Online payment is switched on when the
  // key pair is present; the webhook endpoint additionally needs RAZORPAY_WEBHOOK_SECRET.
  // Read lazily so tests and hosting platforms can change them at runtime.
  get RAZORPAY_KEY_ID() { return process.env.RAZORPAY_KEY_ID || ''; },
  get RAZORPAY_KEY_SECRET() { return process.env.RAZORPAY_KEY_SECRET || ''; },
  get RAZORPAY_WEBHOOK_SECRET() { return process.env.RAZORPAY_WEBHOOK_SECRET || ''; },
  get RAZORPAY_ENABLED() { return Boolean(this.RAZORPAY_KEY_ID && this.RAZORPAY_KEY_SECRET); },

  // Vendor-side billing (PlanetU invoicing its institutes). These are the ISSUER's details printed on every
  // tax invoice. Subscriptions are paid through the SAME Razorpay keys as fees (above). Read lazily.
  get BILLING_VENDOR_NAME() { return process.env.BILLING_VENDOR_NAME || 'PlanetU Technologies'; },
  get BILLING_VENDOR_ADDRESS() { return process.env.BILLING_VENDOR_ADDRESS || ''; },
  get BILLING_VENDOR_STATE() { return process.env.BILLING_VENDOR_STATE || 'Maharashtra'; },
  get BILLING_VENDOR_GSTIN() { return process.env.BILLING_VENDOR_GSTIN || ''; },
  get BILLING_VENDOR_PAN() { return process.env.BILLING_VENDOR_PAN || ''; },
  get BILLING_VENDOR_EMAIL() { return process.env.BILLING_VENDOR_EMAIL || ''; },
  get BILLING_SAC() { return process.env.BILLING_SAC || '998314'; },
  get BILLING_GST_RATE() { const n = Number(process.env.BILLING_GST_RATE); return Number.isFinite(n) && n >= 0 && n <= 40 ? n : 18; },
  get BILLING_INVOICE_PREFIX() { return (process.env.BILLING_INVOICE_PREFIX || 'PU').replace(/[^A-Za-z0-9]/g, '').slice(0, 5) || 'PU'; },
  get BILLING_BANK_DETAILS() { return process.env.BILLING_BANK_DETAILS || ''; },
  get BILLING_UPI_ID() { return process.env.BILLING_UPI_ID || ''; },
  // Days: how long before a period ends the next invoice is issued; trial length; days after the due date before locking
  get BILLING_INVOICE_LEAD_DAYS() { const n = Number(process.env.BILLING_INVOICE_LEAD_DAYS); return Number.isInteger(n) && n >= 0 && n <= 60 ? n : 7; },
  get BILLING_TRIAL_DAYS() { const n = Number(process.env.BILLING_TRIAL_DAYS); return Number.isInteger(n) && n >= 0 && n <= 180 ? n : 14; },
  get BILLING_GRACE_DAYS() { const n = Number(process.env.BILLING_GRACE_DAYS); return Number.isInteger(n) && n >= 0 && n <= 60 ? n : 7; },
  BILLING_WORKER: process.env.BILLING_WORKER !== 'false',
};

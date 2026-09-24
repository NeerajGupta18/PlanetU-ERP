import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(__dirname, '../..');

const isProd = process.env.NODE_ENV === 'production';

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
  DB_FILE: path.join(serverRoot, 'data', 'db.json'),
  CLIENT_DIST: path.resolve(serverRoot, '../client/dist'),

  // Google reCAPTCHA v2. Both keys must be set to enable it; otherwise the
  // app automatically falls back to the built-in custom human check.
  RECAPTCHA_SITE_KEY: process.env.RECAPTCHA_SITE_KEY || '',
  RECAPTCHA_SECRET_KEY: process.env.RECAPTCHA_SECRET_KEY || '',
  get RECAPTCHA_ENABLED() {
    return Boolean(this.RECAPTCHA_SITE_KEY && this.RECAPTCHA_SECRET_KEY);
  },
};

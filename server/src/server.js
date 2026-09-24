import { env } from './config/env.js';
import { createApp } from './app.js';
import { db } from './db/store.js';

db(); // load (or create) the demo database at startup

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

createApp().listen(env.PORT, () => {
  console.log(`[api] PlanetU ERP API running on http://localhost:${env.PORT}`);
});

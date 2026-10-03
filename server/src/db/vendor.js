/**
 * Creating the platform owner ("vendor" / super admin) account for a REAL deployment.
 *
 * The demo seed creates SA001 with a published password, which must never exist on a live system. On a real
 * server run `npm run create-vendor` instead: you choose the login and a strong password, and nothing is printed back.
 */
import bcrypt from 'bcryptjs';
import { q, withTx } from './pool.js';

const KNOWN_DEFAULTS = new Set(['superadmin@123', 'admin@123', 'student@123', 'employee@123', 'password', 'password123']);

/** Why a password is not acceptable, or null when it is fine. */
export function passwordProblem(pw, login = '') {
  if (typeof pw !== 'string' || pw.length < 12) return 'Use at least 12 characters.';
  if (pw.length > 128) return 'Use at most 128 characters.';
  if (!/[a-z]/.test(pw) || !/[A-Z]/.test(pw) || !/\d/.test(pw)) return 'Use upper-case and lower-case letters and at least one number.';
  if (KNOWN_DEFAULTS.has(pw.toLowerCase())) return 'That is one of the published demo passwords.';
  if (login && pw.toLowerCase().includes(String(login).toLowerCase())) return 'The password must not contain the login.';
  return null;
}

export async function createVendor({ login, name, email, password, reset = false }) {
  login = String(login || '').trim();
  if (!/^[A-Za-z0-9._-]{3,40}$/.test(login)) throw new Error('Login must be 3 to 40 letters, numbers, dots, dashes or underscores.');
  if (['sa001'].includes(login.toLowerCase())) throw new Error('SA001 is the demo account name. Choose your own login.');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(email || ''))) throw new Error('Enter a valid email address.');
  const problem = passwordProblem(password, login);
  if (problem) throw new Error(`Password too weak. ${problem}`);
  const hash = await bcrypt.hash(password, 12);

  return withTx({ platform: true }, async () => {
    const { rows: [existing] } = await q("select id from users where role = 'super_admin' and lower(login_id) = lower($1)", [login]);
    if (existing && !reset) throw new Error('A vendor account with that login already exists. Add --reset to change its password.');
    if (existing) {
      await q('update users set password_hash = $2, email = $3, name = $4 where id = $1', [existing.id, hash, email, name || 'Platform Owner']);
      return { created: false, login };
    }
    await q("insert into users (role, login_id, email, name, password_hash) values ('super_admin', $1, $2, $3, $4)", [login, email, name || 'Platform Owner', hash]);
    return { created: true, login };
  });
}

/**
 * For hosts with no shell (a free Render web service): create the owner account at startup from VENDOR_LOGIN,
 * VENDOR_EMAIL and VENDOR_PASSWORD. It only creates a missing account (or, with VENDOR_RESET=true, changes the password
 * of that login), and the same strength rules apply. Remove VENDOR_PASSWORD from the host's settings afterwards.
 */
export async function bootstrapVendorFromEnv({ log = console.log, source = process.env } = {}) {
  const { VENDOR_LOGIN: login, VENDOR_EMAIL: email, VENDOR_PASSWORD: password, VENDOR_NAME: name } = source;
  if (!login && !email && !password) return { action: 'none' };
  const reset = source.VENDOR_RESET === 'true';
  try {
    // Once the account exists the settings are left in place harmlessly (and the password may be removed): stay silent
    if (login && !reset) {
      const { rows: [exists] } = await withTx({ platform: true }, () => q("select id from users where role = 'super_admin' and lower(login_id) = lower($1)", [login]));
      if (exists) return { action: 'exists' };
    }
    if (!login || !email || !password) {
      log('[vendor] VENDOR_LOGIN, VENDOR_EMAIL and VENDOR_PASSWORD must all be set to create the owner account. Skipping.');
      return { action: 'incomplete' };
    }
    const r = await createVendor({ login, name, email, password, reset });
    log(r.created ? `[vendor] Owner account "${r.login}" created. Remove VENDOR_PASSWORD from the settings now.` : `[vendor] Password for "${r.login}" changed. Remove VENDOR_RESET and VENDOR_PASSWORD from the settings now.`);
    return { action: r.created ? 'created' : 'reset' };
  } catch (e) {
    log(`[vendor] Owner account NOT created: ${e.message}`);
    return { action: 'refused', reason: e.message };
  }
}

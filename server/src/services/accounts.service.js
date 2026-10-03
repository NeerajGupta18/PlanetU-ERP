import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { q } from '../db/pool.js';
import { HttpError } from '../middleware/error.js';
import { queueEmail, tenantInfo } from './notifications.service.js';

export const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

/** Minimum bar for every password in the system. */
export function checkPassword(pw, user = {}) {
  if (typeof pw !== 'string') throw new HttpError(400, 'Enter a password.');
  if (pw.length < 8 || pw.length > 128) throw new HttpError(400, 'Use a password of 8 to 128 characters.');
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) throw new HttpError(400, 'Use at least one letter and one number.');
  const low = pw.toLowerCase();
  if ([user.loginId, user.login_id, user.email].some((v) => v && v.toLowerCase() === low)) {
    throw new HttpError(400, 'Your password cannot be the same as your ID or email.');
  }
}

/** Creates a single-use link token (only its hash is stored); older unused ones are cancelled. */
export async function issueToken(userId, hours) {
  const token = crypto.randomBytes(32).toString('base64url');
  await q('delete from password_resets where user_id = $1 and used_at is null', [userId]);
  await q(
    "insert into password_resets (user_id, token_hash, expires_at) values ($1, $2, now() + make_interval(hours => $3))",
    [userId, sha(token), hours],
  );
  return token;
}

const link = (token, code) => `${env.APP_URL}/reset-password?token=${token}${code ? `&institute=${encodeURIComponent(code)}` : ''}`;

/** "Your account is ready - set your password" email. Call inside the user's tenant context. */
export async function sendSetupLink(user, hours = 72) {
  const info = await tenantInfo();
  const token = await issueToken(user.id, hours);
  await queueEmail(user.email, 'accountSetup', {
    institute: info.name, name: user.name, instituteCode: info.code || '-', loginId: user.loginId, link: link(token, info.code), hours,
  });
}

export async function sendResetLink(user, minutes = 60) {
  const info = await tenantInfo();
  const token = await issueToken(user.id, minutes / 60);
  await queueEmail(user.email, 'passwordReset', { institute: info.name, name: user.name, link: link(token, info.code), minutes });
}

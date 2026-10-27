import crypto from 'node:crypto';
import { q } from '../db/pool.js';
import { HttpError } from '../middleware/error.js';
import { sha } from './accounts.service.js';

/**
 * Trusted devices for fingerprint sign-in on the Android app. The phone keeps the token in its secure storage and
 * hands it over only after a fingerprint; the server stores just its hash. Every query here runs inside the
 * institute's own transaction, so Row Level Security keeps one institute's devices invisible to another.
 */
export const DEVICE_DAYS = 30;
export const MAX_DEVICES_PER_USER = 5;

const newToken = () => `pud_${crypto.randomBytes(32).toString('base64url')}`;
export const looksLikeDeviceToken = (t) => typeof t === 'string' && /^pud_[A-Za-z0-9_-]{43}$/.test(t);

const cleanLabel = (label) => {
  const s = typeof label === 'string' ? label.replace(/\s+/g, ' ').trim().slice(0, 80) : '';
  return s || 'Android phone';
};

/** Issues a new token for this user on this phone. Returns the token once; only its hash is kept. */
export async function issueDevice(user, label) {
  const token = newToken();
  const { rows: [d] } = await q(
    `insert into trusted_devices (user_id, label, token_hash, expires_at) values ($1, $2, $3, now() + make_interval(days => $4))
     returning id, label, created_at as "createdAt", expires_at as "expiresAt"`,
    [user.id, cleanLabel(label), sha(token), DEVICE_DAYS],
  );
  // Keep the newest few: older trusted phones of the same account are dropped
  await q(
    `update trusted_devices set revoked_at = now(), revoked_reason = 'removed'
     where id in (select id from trusted_devices where user_id = $1 and revoked_at is null and expires_at > now()
                  order by created_at desc offset $2)`,
    [user.id, MAX_DEVICES_PER_USER],
  );
  return { ...d, token };
}

/**
 * Finds the account a token belongs to, in the current institute only. Returns { device, user } or a reason:
 * 'invalid' (unknown, revoked, another institute's, or the password changed since), 'expired', 'inactive'.
 */
export async function findByToken(token) {
  if (!looksLikeDeviceToken(token)) return { reason: 'invalid' };
  const { rows: [r] } = await q(
    `select d.id, d.revoked_at as "revokedAt", d.expires_at as "expiresAt", d.created_at as "createdAt",
            u.id as "userId", u.role, u.login_id as "loginId", u.email, u.name, u.status,
            u.must_change_password as "mustChangePassword", u.password_changed_at as "passwordChangedAt"
     from trusted_devices d join users u on u.id = d.user_id and u.tenant_id = d.tenant_id
     where d.token_hash = $1`,
    [sha(token)],
  );
  if (!r || r.revokedAt) return { reason: 'invalid', deviceId: r?.id };
  if (new Date(r.passwordChangedAt) > new Date(r.createdAt)) return { reason: 'invalid', deviceId: r.id };
  if (new Date(r.expiresAt) <= new Date()) return { reason: 'expired', deviceId: r.id };
  if (r.status !== 'active') return { reason: 'inactive', deviceId: r.id, userId: r.userId };
  const user = {
    id: r.userId, role: r.role, loginId: r.loginId, email: r.email, name: r.name, mustChangePassword: r.mustChangePassword,
  };
  return { device: { id: r.id }, user };
}

export const touchDevice = (id) => q('update trusted_devices set last_used_at = now() where id = $1', [id]);

/** "Forget this device" on sign-out: the phone proves it holds the token. */
export async function forgetByToken(token) {
  if (!looksLikeDeviceToken(token)) return 0;
  const { rowCount } = await q(
    "update trusted_devices set revoked_at = now(), revoked_reason = 'forget' where token_hash = $1 and revoked_at is null",
    [sha(token)],
  );
  return rowCount;
}

/** Ends every trusted phone of one account (password changed, account switched off). */
export async function revokeAllFor(userIds, reason) {
  const ids = [].concat(userIds).filter(Boolean);
  if (!ids.length) return 0;
  const { rowCount } = await q(
    'update trusted_devices set revoked_at = now(), revoked_reason = $2 where user_id = any($1::uuid[]) and revoked_at is null',
    [ids, reason],
  );
  return rowCount;
}

const DEVICE_COLS = `d.id, d.label, d.created_at as "createdAt", d.last_used_at as "lastUsedAt", d.expires_at as "expiresAt"`;

/** The account's own phones that can still sign in. */
export async function listMine(userId) {
  return (await q(
    `select ${DEVICE_COLS} from trusted_devices d
     where d.user_id = $1 and d.revoked_at is null and d.expires_at > now() order by d.created_at desc`,
    [userId],
  )).rows;
}

/** For the institute admin: every phone that can still sign in, with whose account it is. */
export async function listAll() {
  return (await q(
    `select ${DEVICE_COLS}, u.name as "userName", u.login_id as "loginId", u.role
     from trusted_devices d join users u on u.id = d.user_id and u.tenant_id = d.tenant_id
     where d.revoked_at is null and d.expires_at > now() order by u.name, d.created_at desc limit 500`,
  )).rows;
}

/** Removes one phone: the owner removes their own (userId given), an admin removes any in the institute. */
export async function removeDevice(id, { userId = null, reason }) {
  const { rows: [d] } = await q(
    `update trusted_devices set revoked_at = now(), revoked_reason = $3
     where id = $1 and revoked_at is null and ($2::uuid is null or user_id = $2) returning id, user_id as "userId", label`,
    [id, userId, reason],
  );
  if (!d) throw new HttpError(404, 'That phone is not in the list.');
  return d;
}

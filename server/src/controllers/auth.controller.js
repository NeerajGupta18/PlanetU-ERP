import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { q, switchTenant, withTx } from '../db/pool.js';
import { billingNotice } from '../services/billing.service.js';
import { HttpError } from '../middleware/error.js';
import { checkPassword, sendResetLink, sha } from '../services/accounts.service.js';
import { queueEmail, tenantInfo } from '../services/notifications.service.js';
import { instituteBrief, loadNotices } from '../db/repo.js';
import { audit } from '../db/audit.js';
import {
  answerChallenge, consumeCaptchaToken, createChallenge, issueCaptchaToken, looksHuman, verifyRecaptcha,
} from '../services/captcha.service.js';

export const ROLES = ['super_admin', 'admin', 'student', 'employee'];

const MAX_FAILED = 5;
const LOCK_MS = 15 * 60 * 1000;
const failed = new Map(); // "code:role:identifier" -> { count, lockedUntil }  (move to Redis when running >1 API instance)
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10); // keeps timing similar for unknown users

// What the vendor's own (platform) users see in the top bar - they belong to no institute
const PLATFORM_BRIEF = { name: 'PlanetU Technovision', shortName: 'PlanetU', tagline: 'Elevating ideas into digital success', address: '', phone: '' };

const initials = (name) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('');

export const toPublicUser = (u) => ({
  id: u.id, role: u.role, name: u.name, email: u.email, loginId: u.loginId, initials: initials(u.name),
  mustChangePassword: !!u.mustChangePassword,
});

// The per-client configuration the React app needs: which modules are on and what things are called
export const publicTenant = (t) => t && ({
  code: t.code, name: t.name, type: t.type, modules: t.modules, terminology: t.terminology,
  // True while access is paused for an unpaid subscription: the app then shows the admin only the Billing page
  billingLocked: Boolean(t.billingLocked),
});

async function sessionExtras(user, tenant) {
  if (!tenant) return { institute: PLATFORM_BRIEF, notifications: [], billing: null };
  const notifications = user.role === 'student'
    ? (await loadNotices(5)).map(({ id, title, category, date }) => ({ id, title, category, date }))
    : [];
  // The admin sees a banner when a subscription invoice is due, overdue, or a trial is ending
  const billing = user.role === 'admin' ? await billingNotice().catch(() => null) : null;
  return { institute: await instituteBrief(), notifications, billing };
}

/* ---------- captcha ---------- */

// Tells the login page which widget to render, and the public site key if
// reCAPTCHA is on. Called once when the login page loads.
export const captchaConfig = (req, res) => res.json(
  env.RECAPTCHA_ENABLED
    ? { provider: 'recaptcha', siteKey: env.RECAPTCHA_SITE_KEY }
    : { provider: 'custom' },
);

export async function captchaVerify(req, res) {
  if (env.RECAPTCHA_ENABLED) {
    const { recaptchaToken } = req.body || {};
    const result = await verifyRecaptcha(recaptchaToken, req.ip);
    if (result.success) return res.json({ token: issueCaptchaToken() });
    return res.status(400).json({ message: 'reCAPTCHA check failed. Please try again.' });
  }

  const { elapsedMs, interactions, trusted, website } = req.body || {};
  if (looksHuman({ elapsedMs, interactions, trusted, website })) {
    return res.json({ token: issueCaptchaToken() });
  }
  return res.json({ challenge: createChallenge() });
}

export const captchaNewChallenge = (req, res) => res.json({ challenge: createChallenge() });

export function captchaAnswer(req, res) {
  const { id, answer } = req.body || {};
  const result = answerChallenge(id, answer);
  if (result.ok) return res.json({ token: issueCaptchaToken() });
  return res.status(400).json({
    message: result.expired ? 'That challenge expired. Here is a new one.' : 'Incorrect answer. Try again.',
    challenge: result.expired ? createChallenge() : undefined,
  });
}

/* ---------- session ---------- */
export async function login(req, res) {
  const { role, identifier, password, captchaToken, tenantCode } = req.body || {};

  if (!ROLES.includes(role)) return res.status(400).json({ message: 'Choose a valid role.' });
  const isPlatform = role === 'super_admin';
  if (!isPlatform && (typeof tenantCode !== 'string' || !tenantCode.trim() || tenantCode.length > 60)) {
    return res.status(400).json({ message: 'Enter your institute code.' });
  }
  if (typeof identifier !== 'string' || !identifier.trim() || identifier.length > 120
    || typeof password !== 'string' || !password || password.length > 128) {
    return res.status(400).json({ message: 'Enter your ID or email and your password.' });
  }
  if (!consumeCaptchaToken(captchaToken)) {
    return res.status(400).json({ message: 'Tick "I\'m not a robot" before signing in.', code: 'CAPTCHA' });
  }

  const code = isPlatform ? '' : tenantCode.trim().toLowerCase();
  const id = identifier.trim().toLowerCase();
  const key = `${code}:${role}:${id}`;
  const record = failed.get(key);
  if (record?.lockedUntil > Date.now()) {
    const mins = Math.ceil((record.lockedUntil - Date.now()) / 60000);
    return res.status(429).json({ message: `Too many failed attempts. Try again in ${mins} minute${mins > 1 ? 's' : ''}.` });
  }

  // Lookup runs in platform context (we don't know the tenant yet); the tenant comes from the code, then the user is
  // matched INSIDE that tenant only - the same login ID in another institute is a different person.
  const { tenant, user } = await withTx({ platform: true }, async () => {
    let t = null;
    if (!isPlatform) {
      ({ rows: [t] } = await q(
        'select id, code, name, type, status, plan, modules, terminology, suspension_reason as "suspensionReason" from tenants where code = $1', [code],
      ));
      if (!t) return { tenant: null, user: null };
    }
    const { rows: [u] } = await q(
      `select id, role, login_id as "loginId", email, name, password_hash as "passwordHash",
              must_change_password as "mustChangePassword"
       from users
       where role = $1 and status = 'active' and tenant_id is not distinct from $2::uuid
         and (lower(email) = $3 or lower(login_id) = $3)`,
      [role, t?.id ?? null, id],
    );
    return { tenant: t, user: u };
  });

  const ok = await bcrypt.compare(password, user ? user.passwordHash : DUMMY_HASH);
  if (!user || !ok) {
    const next = { count: (record?.count || 0) + 1, lockedUntil: 0 };
    if (next.count >= MAX_FAILED) next.lockedUntil = Date.now() + LOCK_MS;
    failed.set(key, next);
    // Same message for "wrong institute", "wrong role", "unknown user" and "wrong password"
    return res.status(401).json({
      message: isPlatform ? 'Incorrect ID, password or role.' : 'Incorrect institute code, ID, password or role.',
    });
  }
  if (tenant && tenant.status !== 'active') {
    const billingLocked = tenant.suspensionReason === 'billing';
    // An unpaid subscription locks everyone out except the admin, who must be able to sign in to pay
    if (!(billingLocked && user.role === 'admin')) {
      return res.status(403).json({
        message: billingLocked ? "Your institute's access is temporarily paused. Please contact your institute's administrator."
          : "This institute's account is suspended. Please contact PlanetU support.",
      });
    }
    tenant.billingLocked = true;
  }

  failed.delete(key);
  const token = jwt.sign({ typ: 'session', role: user.role, tid: tenant?.id ?? null, ims: Date.now() }, env.JWT_SECRET, {
    subject: user.id, expiresIn: `${env.SESSION_HOURS}h`,
  });
  res.cookie(env.COOKIE_NAME, token, {
    httpOnly: true, sameSite: 'lax', secure: env.COOKIE_SECURE, maxAge: env.SESSION_HOURS * 3600 * 1000,
  });

  const extras = await withTx({ tenantId: tenant?.id ?? null, platform: !tenant }, async () => {
    await audit(user, 'auth.login', 'user', user.id);
    return sessionExtras(user, tenant);
  });
  return res.json({ user: toPublicUser(user), tenant: publicTenant(tenant), ...extras });
}

// Session restore: runs inside the request's tenant-scoped transaction (see requireAuth)
export async function me(req, res) {
  res.json({
    user: toPublicUser(req.user), tenant: publicTenant(req.tenant), ...(await sessionExtras(req.user, req.tenant)),
  });
}

export function logout(req, res) {
  res.clearCookie(env.COOKIE_NAME);
  res.json({ ok: true });
}

// Lets the login page show which institute a code belongs to before sign-in. Reveals only the display name.
export async function publicTenantInfo(req, res) {
  const code = String(req.params.code || '').trim().toLowerCase();
  const t = await withTx({ platform: true }, async () => (
    (await q("select code, name, type from tenants where code = $1 and (status = 'active' or suspension_reason = 'billing')", [code])).rows[0]
  ));
  if (!t) return res.status(404).json({ message: 'No institute found with that code.' });
  return res.json(t);
}

/* ---------- passwords ---------- */

const GENERIC = { message: 'If that account exists, we have emailed a link to reset the password.' };

// Always answers the same way, so it can't be used to discover who has an account
export async function forgotPassword(req, res) {
  const { tenantCode, email, captchaToken } = req.body || {};
  if (typeof email !== 'string' || !email.trim() || email.length > 120) throw new HttpError(400, 'Enter your email address.');
  if (!consumeCaptchaToken(captchaToken)) throw new HttpError(400, 'Tick "I\'m not a robot" first.');

  await withTx({ platform: true }, async () => {
    let tenant = null;
    if (typeof tenantCode === 'string' && tenantCode.trim()) {
      ({ rows: [tenant] } = await q("select id from tenants where code = $1 and status = 'active'", [tenantCode.trim().toLowerCase()]));
      if (!tenant) return;
    }
    const { rows: [user] } = await q(
      `select id, name, email, login_id as "loginId" from users
       where status = 'active' and tenant_id is not distinct from $1::uuid and lower(email) = lower($2)`,
      [tenant?.id ?? null, email.trim()],
    );
    if (!user) return;
    if (tenant) await switchTenant(tenant.id);
    await sendResetLink(user, 60);
  });
  res.json(GENERIC);
}

export async function resetPassword(req, res) {
  const { token, password } = req.body || {};
  if (typeof token !== 'string' || token.length < 20 || token.length > 200) throw new HttpError(400, 'This link is invalid or has expired.');

  await withTx({ platform: true }, async () => {
    const { rows: [r] } = await q(
      `select r.id, r.tenant_id as "tenantId", u.id as "userId", u.name, u.email, u.login_id as "loginId", u.role, u.status
       from password_resets r join users u on u.id = r.user_id
       where r.token_hash = $1 and r.used_at is null and r.expires_at > now() for update of r`,
      [sha(token)],
    );
    if (!r || r.status !== 'active') throw new HttpError(400, 'This link is invalid or has expired.');
    checkPassword(password, r);
    if (r.tenantId) {
      const { rows: [t] } = await q('select status, suspension_reason as "suspensionReason" from tenants where id = $1', [r.tenantId]);
      // An admin of an institute paused for non-payment may still set a password, since they must sign in to pay
      if (t.status !== 'active' && !(t.suspensionReason === 'billing' && r.role === 'admin')) throw new HttpError(403, "This institute's account is suspended. Please contact PlanetU support.");
    }
    await q(
      'update users set password_hash = $1, must_change_password = false, password_changed_at = $3 where id = $2',
      [await bcrypt.hash(password, 10), r.userId, new Date()],
    );
    await q('update password_resets set used_at = now() where user_id = $1 and used_at is null', [r.userId]);
    if (r.tenantId) await switchTenant(r.tenantId);
    const info = await tenantInfo();
    await queueEmail(r.email, 'passwordChanged', { institute: info.name, name: r.name });
    await audit({ id: r.userId, role: r.role }, 'auth.password_reset', 'user', r.userId);
  });
  res.json({ message: 'Password updated. You can now sign in.' });
}

// Signed-in users. Ends every other session (their tokens predate password_changed_at) and keeps this one alive.
export async function changePassword(req, res) {
  const { currentPassword, newPassword } = req.body || {};
  const { rows: [u] } = await q('select password_hash from users where id = $1', [req.user.id]);
  if (typeof currentPassword !== 'string' || !(await bcrypt.compare(currentPassword, u.password_hash))) {
    throw new HttpError(400, 'Your current password is incorrect.');
  }
  checkPassword(newPassword, req.user);
  if (newPassword === currentPassword) throw new HttpError(400, 'Choose a password different from the current one.');

  await q(
    'update users set password_hash = $1, must_change_password = false, password_changed_at = $3 where id = $2',
    [await bcrypt.hash(newPassword, 10), req.user.id, new Date()],
  );
  const info = await tenantInfo();
  await queueEmail(req.user.email, 'passwordChanged', { institute: info.name, name: req.user.name });
  await audit(req.user, 'auth.password_change', 'user', req.user.id);

  const token = jwt.sign({ typ: 'session', role: req.user.role, tid: req.tenant?.id ?? null, ims: Date.now() }, env.JWT_SECRET, {
    subject: req.user.id, expiresIn: `${env.SESSION_HOURS}h`,
  });
  res.cookie(env.COOKIE_NAME, token, {
    httpOnly: true, sameSite: 'lax', secure: env.COOKIE_SECURE, maxAge: env.SESSION_HOURS * 3600 * 1000,
  });
  res.json({ message: 'Password changed.' });
}

import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { db } from '../db/store.js';
import {
  answerChallenge, consumeCaptchaToken, createChallenge, issueCaptchaToken, looksHuman, verifyRecaptcha,
} from '../services/captcha.service.js';

export const ROLES = ['super_admin', 'admin', 'student', 'employee'];

const MAX_FAILED = 5;
const LOCK_MS = 15 * 60 * 1000;
const failed = new Map(); // "role:identifier" -> { count, lockedUntil }
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10); // keeps timing similar for unknown users

const initials = (name) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('');

export const toPublicUser = (u) => ({
  id: u.id, role: u.role, name: u.name, email: u.email, loginId: u.loginId, initials: initials(u.name),
});

const instituteBrief = () => {
  const i = db().institute;
  return { name: i.name, shortName: i.shortName, tagline: i.tagline, address: i.address, phone: i.phone };
};

function notificationsFor(user) {
  if (user.role !== 'student') return [];
  return [...db().notices].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5)
    .map(({ id, title, category, date }) => ({ id, title, category, date }));
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
  const { role, identifier, password, captchaToken } = req.body || {};

  if (!ROLES.includes(role)) return res.status(400).json({ message: 'Choose a valid role.' });
  if (typeof identifier !== 'string' || !identifier.trim() || identifier.length > 120
    || typeof password !== 'string' || !password || password.length > 128) {
    return res.status(400).json({ message: 'Enter your ID or email and your password.' });
  }
  if (!consumeCaptchaToken(captchaToken)) {
    return res.status(400).json({ message: 'Tick "I\'m not a robot" before signing in.', code: 'CAPTCHA' });
  }

  const id = identifier.trim().toLowerCase();
  const key = `${role}:${id}`;
  const record = failed.get(key);
  if (record?.lockedUntil > Date.now()) {
    const mins = Math.ceil((record.lockedUntil - Date.now()) / 60000);
    return res.status(429).json({ message: `Too many failed attempts. Try again in ${mins} minute${mins > 1 ? 's' : ''}.` });
  }

  const user = db().users.find(
    (u) => u.role === role && u.status === 'active' && (u.email.toLowerCase() === id || u.loginId.toLowerCase() === id),
  );
  const ok = await bcrypt.compare(password, user ? user.passwordHash : DUMMY_HASH);

  if (!user || !ok) {
    const next = { count: (record?.count || 0) + 1, lockedUntil: 0 };
    if (next.count >= MAX_FAILED) next.lockedUntil = Date.now() + LOCK_MS;
    failed.set(key, next);
    // Same message for "wrong role", "unknown user" and "wrong password"
    return res.status(401).json({ message: 'Incorrect ID, password or role.' });
  }

  failed.delete(key);
  const token = jwt.sign({ typ: 'session', role: user.role }, env.JWT_SECRET, {
    subject: user.id, expiresIn: `${env.SESSION_HOURS}h`,
  });
  res.cookie(env.COOKIE_NAME, token, {
    httpOnly: true, sameSite: 'lax', secure: env.COOKIE_SECURE, maxAge: env.SESSION_HOURS * 3600 * 1000,
  });
  return res.json({ user: toPublicUser(user), institute: instituteBrief(), notifications: notificationsFor(user) });
}

export const me = (req, res) => res.json({
  user: toPublicUser(req.user), institute: instituteBrief(), notifications: notificationsFor(req.user),
});

export function logout(req, res) {
  res.clearCookie(env.COOKIE_NAME);
  res.json({ ok: true });
}

export const publicInstitute = (req, res) => res.json(instituteBrief());

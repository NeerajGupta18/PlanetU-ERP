/**
 * Parent consent. At first sign-in a parent is shown what the institute keeps about them and their child, and why,
 * and agrees before going further. Each answer is kept with its purpose, the wording version, and the time.
 * Rows are only added, never changed, so the history of what was agreed stays.
 */
import { q } from '../db/pool.js';
import { audit } from '../db/audit.js';
import { HttpError } from '../middleware/error.js';

/** Raise this when the wording on the consent screen changes: everyone is then asked again. */
export const CONSENT_VERSION = 'v1';

/** The purposes, in the order the screen shows them. `required` ones must be agreed to use the app. */
export const PURPOSES = [
  { key: 'records', required: true, label: "Keep my child's study records", detail: "Attendance, marks, fees, timetable and notices, so the institute can run your child's studies and you can see them here." },
  { key: 'messages', required: false, label: 'Send me reminders by email', detail: 'Fee reminders, results and important notices. You can still see everything in the app if you say no.' },
];

/** Who is asked: parents only (students and staff are covered by the institute's own forms). */
export const asksConsent = (user) => user?.role === 'parent';

/** The newest answer per purpose for this wording, and whether the screen still has to be shown. */
export async function consentStatus(userId) {
  const { rows } = await q(
    `select distinct on (purpose) purpose, granted, recorded_at as "recordedAt"
     from user_consents where user_id = $1 and version = $2 order by purpose, recorded_at desc`, [userId, CONSENT_VERSION],
  );
  const latest = Object.fromEntries(rows.map((r) => [r.purpose, r]));
  const needed = PURPOSES.some((p) => p.required && !latest[p.key]?.granted);
  return {
    needed,
    version: CONSENT_VERSION,
    purposes: PURPOSES.map((p) => ({ ...p, granted: latest[p.key]?.granted ?? null, recordedAt: latest[p.key]?.recordedAt ?? null })),
  };
}

/** Records one answer per purpose. `answers` is { records: true, messages: false }. */
export async function recordConsent(user, answers, { ip, userAgent } = {}) {
  const a = answers || {};
  for (const p of PURPOSES) {
    if (p.required && a[p.key] !== true) {
      throw new HttpError(400, `Tick "${p.label}" to continue. The app cannot show your child's details without it.`);
    }
  }
  const ua = typeof userAgent === 'string' ? userAgent.slice(0, 300) : null;
  for (const p of PURPOSES) {
    await q(
      'insert into user_consents (user_id, purpose, granted, version, ip, user_agent) values ($1, $2, $3, $4, $5, $6)',
      [user.id, p.key, a[p.key] === true, CONSENT_VERSION, ip || null, ua],
    );
  }
  await audit(user, 'consent.recorded', 'user', user.id, { version: CONSENT_VERSION, ...Object.fromEntries(PURPOSES.map((p) => [p.key, a[p.key] === true])) });
  return consentStatus(user.id);
}

/** When each parent of a list agreed (for the office's view of a student's parents). */
export async function consentTimes(userIds) {
  if (!userIds.length) return {};
  const { rows } = await q(
    `select distinct on (user_id) user_id as "userId", recorded_at as "recordedAt"
     from user_consents where user_id = any($1) and purpose = 'records' and granted and version = $2
     order by user_id, recorded_at desc`, [userIds, CONSENT_VERSION],
  );
  return Object.fromEntries(rows.map((r) => [r.userId, r.recordedAt]));
}

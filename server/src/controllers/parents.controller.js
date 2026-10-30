import { env } from '../config/env.js';
import { HttpError } from '../middleware/error.js';
import * as svc from '../services/parents.service.js';

const { CHILD_COOKIE } = svc;

/* ---------- the office ---------- */
export const list = async (req, res) => {
  // Parent names and emails are for the student office, not for every desk that can look a student up
  if (req.office && !req.office.full && req.office.areas?.students?.scope !== 'all') throw new HttpError(403, 'Your staff role does not include this.');
  res.json(await svc.listForStudent(req.params.id));
};
export const add = async (req, res) => res.status(201).json(await svc.addParent(req.params.id, req.body || {}, req.user));
export const remove = async (req, res) => { await svc.removeLink(req.params.id, req.params.userId, req.user); res.json({ success: true }); };
export const inviteAll = async (req, res) => res.json(await svc.inviteAll(req.user));

/* ---------- the parent ---------- */
export const children = async (req, res) => {
  const kids = await svc.childSummaries(req.user.id, req.tenant.modules);
  const wanted = req.cookies?.[CHILD_COOKIE];
  if (wanted && !kids.some((k) => k.id === wanted)) res.clearCookie(CHILD_COOKIE);
  res.json({ children: kids, selected: req.childId ?? (await svc.resolveChild(req.user.id, req.cookies?.[CHILD_COOKIE])) });
};
export async function selectChild(req, res) {
  const kids = await svc.childrenOf(req.user.id);
  const kid = kids.find((k) => k.id === (req.body || {}).childId);
  if (!kid) return res.status(404).json({ message: 'That student is not linked to your account.' });
  res.cookie(CHILD_COOKIE, kid.id, { httpOnly: true, sameSite: 'lax', secure: env.COOKIE_SECURE, maxAge: 30 * 24 * 3600 * 1000 });
  return res.json({ selected: kid.id });
}

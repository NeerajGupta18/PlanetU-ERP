import * as svc from '../services/checkin.service.js';

/* ---------- teacher ---------- */
export const state = async (req, res) => res.json(await svc.state(req.user, req.query.slotId));
export const open = async (req, res) => res.json(await svc.open(req.user, req.body?.slotId, req.body || {}));
export const close = async (req, res) => res.json(await svc.close(req.user, req.body?.slotId));

/* ---------- student ---------- */
export const today = async (req, res) => res.json(await svc.todayFor(req.user.studentId));
export async function checkIn(req, res) {
  const r = await svc.checkIn(req.user, req.body || {});
  if (r.rejected) {
    await req.tx.commit(); // keep the count of wrong tries
    return res.status(r.rejected.status).json({ message: r.rejected.message, code: r.rejected.code });
  }
  return res.json(r);
}

import { HttpError } from '../middleware/error.js';
import * as svc from '../services/onlinePayments.service.js';
import { listPayments } from '../services/fees.service.js';

/* ---------- student ---------- */
export const config = async (req, res) => res.json(svc.onlineConfig());
export const createOrder = async (req, res) => res.status(201).json(await svc.createOrder(req.user, req.body));
export const verify = async (req, res) => res.json(await svc.verifyPayment(req.user, req.body));
export const myPayments = async (req, res) => res.json({ payments: await listPayments({ studentId: req.user.studentId }) });

/* ---------- admin ---------- */
export const listOrders = async (req, res) => res.json({ orders: await svc.listOrders({ status: req.query.status }) });
export const resolveOrder = async (req, res) => {
  await svc.resolveOrder(req.params.id, req.body?.note, req.user);
  res.json({ success: true });
};

/**
 * POST /api/webhooks/razorpay - public (no session); trusted only because of the HMAC signature.
 * Mounted in app.js BEFORE express.json(), because the signature is computed over the exact raw bytes.
 * Any non-2xx makes Razorpay retry, which is what we want for transient failures.
 */
export async function razorpayWebhook(req, res) {
  if (!Buffer.isBuffer(req.body)) throw new HttpError(400, 'Expected a raw body.');
  res.json({ ok: true, ...(await svc.handleWebhook(req.body, req.get('x-razorpay-signature'))) });
}

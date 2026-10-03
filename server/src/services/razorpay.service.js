/**
 * Thin Razorpay client: just the three REST calls and two signature checks the ERP needs.
 * Uses Node's built-in fetch + crypto, so there is no extra dependency to install or audit.
 *
 * Money is always exchanged in PAISE (integer) here; the rest of the app works in rupees.
 */
import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { HttpError } from '../middleware/error.js';

const API = 'https://api.razorpay.com/v1';

function gatewayError(status, message, transient) {
  const err = new HttpError(status, message);
  err.transient = transient; // true = worth retrying later (network / Razorpay 5xx)
  return err;
}

async function call(method, path, body) {
  if (!env.RAZORPAY_ENABLED) throw new HttpError(503, 'Online payments are not enabled for this installation.');
  const auth = Buffer.from(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`).toString('base64');
  let res;
  try {
    res = await fetch(`${API}${path}`, {
      method,
      headers: { Authorization: `Basic ${auth}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw gatewayError(502, 'Could not reach the payment gateway. Please try again in a moment.', true);
  }
  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) {
    throw gatewayError(502, data?.error?.description || 'The payment gateway rejected the request.', res.status >= 500);
  }
  return data;
}

/** Creates a Razorpay order. `receipt` is our own order id (max 40 chars) for easy cross-reference. */
export const createOrder = ({ amountPaise, receipt, notes }) => call('POST', '/orders', {
  amount: amountPaise, currency: 'INR', receipt, notes,
});
export const fetchOrder = (orderId) => call('GET', `/orders/${encodeURIComponent(orderId)}`);
export const fetchPayment = (paymentId) => call('GET', `/payments/${encodeURIComponent(paymentId)}`);

function safeEqualHex(expected, given) {
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(String(given ?? ''), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** The signature Checkout hands the browser: HMAC-SHA256("order_id|payment_id", key_secret). */
export function verifyCheckoutSignature({ orderId, paymentId, signature }) {
  if (!env.RAZORPAY_KEY_SECRET) return false;
  const expected = crypto.createHmac('sha256', env.RAZORPAY_KEY_SECRET).update(`${orderId}|${paymentId}`).digest('hex');
  return safeEqualHex(expected, signature);
}

/** X-Razorpay-Signature on a webhook: HMAC-SHA256(rawBody, webhook_secret). rawBody must be the untouched bytes. */
export function verifyWebhookSignature(rawBody, signature) {
  if (!env.RAZORPAY_WEBHOOK_SECRET || !Buffer.isBuffer(rawBody)) return false;
  const expected = crypto.createHmac('sha256', env.RAZORPAY_WEBHOOK_SECRET).update(rawBody).digest('hex');
  return safeEqualHex(expected, signature);
}

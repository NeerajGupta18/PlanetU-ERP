/**
 * Online fee payment (Razorpay) - the reconciliation logic.
 *
 *   1. createOrder   student picks what to pay; the SERVER works out the amount (never the browser)
 *                    and creates a Razorpay order + an `online_payment_orders` row.
 *   2. Checkout      the browser pays on Razorpay's hosted form (UPI / card / netbanking).
 *   3. verifyPayment the browser returns the signed result. We check the signature, confirm with
 *                    Razorpay that the payment is really captured for the right amount, then settle.
 *   4. webhook       Razorpay independently calls us when the payment is captured. This is what
 *                    saves the day when the student closes the tab right after paying.
 *
 * settle() is the single place money enters the ledger. It locks the order row and is a no-op if
 * the order is already paid, so steps 3 and 4 racing each other can never record a payment twice.
 */
import { randomUUID } from 'node:crypto';
import { env } from '../config/env.js';
import { isUuid, q, withTx } from '../db/pool.js';
import { audit } from '../db/audit.js';
import { HttpError } from '../middleware/error.js';
import { queueEmail, tenantInfo } from './notifications.service.js';
import { recordPayment, studentFees } from './fees.service.js';
import * as gateway from './razorpay.service.js';
import { asPlatform } from './billing.service.js';
import { handleSubscriptionWebhook } from './billingPayments.service.js';

const toPaise = (rupees) => Math.round(Number(rupees) * 100);
const round2 = (n) => Math.round(Number(n) * 100) / 100;
const WEBHOOK_EVENTS = new Set(['payment.captured', 'order.paid', 'payment.failed']);

export const onlineConfig = () => ({ enabled: env.RAZORPAY_ENABLED, keyId: env.RAZORPAY_ENABLED ? env.RAZORPAY_KEY_ID : null });

const lockOrder = async (razorpayOrderId) => (
  await q('select * from online_payment_orders where razorpay_order_id = $1 for update', [razorpayOrderId])
).rows[0];

/* ---------------- 1. create an order ---------------- */

/**
 * body: { feeItemId?, amount? }
 *   - feeItemId omitted -> paying against the student's whole outstanding balance (oldest charge first)
 *   - amount omitted    -> pay the full balance of the chosen scope; or a smaller instalment (>= Rs 1)
 */
export async function createOrder(user, body = {}) {
  if (!env.RAZORPAY_ENABLED) throw new HttpError(503, 'Online payment is not available right now. Please pay at the accounts office.');
  const { feeItemId = null, amount = null } = body;
  const { items } = await studentFees(user.studentId);
  const open = items
    .filter((i) => i.status === 'unpaid' || i.status === 'partial')
    .map((i) => ({ ...i, balance: round2(Number(i.amount) - Number(i.paid)) }))
    .filter((i) => i.balance > 0);

  let due;
  if (feeItemId) {
    if (!isUuid(feeItemId)) throw new HttpError(400, 'Choose a valid charge to pay.');
    const item = open.find((i) => i.id === feeItemId);
    if (!item) throw new HttpError(400, 'That charge is not open for payment.');
    due = item.balance;
  } else {
    due = round2(open.reduce((a, i) => a + i.balance, 0));
  }
  if (due <= 0) throw new HttpError(409, 'You have nothing outstanding to pay.');

  let pay = due;
  if (amount !== null && amount !== undefined && amount !== '') {
    pay = round2(amount);
    if (!Number.isFinite(pay) || pay < 1) throw new HttpError(400, 'The minimum online payment is ₹1.');
    if (pay > due + 0.001) throw new HttpError(400, `You can pay at most ₹${due.toFixed(2)} here.`);
  }

  const id = randomUUID();
  const order = await gateway.createOrder({
    amountPaise: toPaise(pay),
    receipt: id,
    notes: { tenant_id: user.tenantId, student_id: user.studentId, order_id: id },
  });
  await q(
    `insert into online_payment_orders (id, student_id, fee_item_id, amount, razorpay_order_id, created_by)
     values ($1, $2, $3, $4, $5, $6)`,
    [id, user.studentId, feeItemId, pay, order.id, user.id],
  );
  await audit(user, 'fees.online_order', 'student', user.studentId, { orderId: id, amount: pay });

  const { rows: [s] } = await q('select name, email, phone from students where id = $1', [user.studentId]);
  return {
    orderId: order.id, amount: pay, amountPaise: toPaise(pay), currency: 'INR', keyId: env.RAZORPAY_KEY_ID,
    prefill: { name: s?.name, email: s?.email, contact: s?.phone },
  };
}

/* ---------------- the one place money enters the ledger ---------------- */

async function settle(order, { paymentId, method, actor }) {
  if (order.status === 'paid') return { status: 'paid', paymentId: order.payment_id };

  await q('savepoint settle_order');
  let payment;
  try {
    payment = await recordPayment({
      studentId: order.student_id,
      amount: Number(order.amount),
      method: 'online',
      reference: paymentId,
      note: `Paid online via Razorpay${method ? ` (${method})` : ''}`,
      allocations: order.fee_item_id ? [{ feeItemId: order.fee_item_id, amount: Number(order.amount) }] : undefined,
    }, actor);
    await q('release savepoint settle_order');
  } catch (err) {
    // The gateway HAS the money but the ledger refused it (typically: the charge was settled some
    // other way while the student was paying). Keep the evidence and flag it for an admin instead of
    // losing it or failing a webhook that Razorpay would then retry forever.
    await q('rollback to savepoint settle_order');
    await q(
      `update online_payment_orders set status = 'needs_review', razorpay_payment_id = $2, method = $3, failure_reason = $4, paid_at = now() where id = $1`,
      [order.id, paymentId, method ?? null, String(err.message).slice(0, 300)],
    );
    await audit(actor, 'fees.online_needs_review', 'student', order.student_id, { orderId: order.id, paymentId, reason: err.message });
    return { status: 'needs_review' };
  }

  await q(
    `update online_payment_orders set status = 'paid', razorpay_payment_id = $2, method = $3, payment_id = $4, paid_at = now(), failure_reason = null where id = $1`,
    [order.id, paymentId, method ?? null, payment.id],
  );
  const { rows: [s] } = await q('select name, email from students where id = $1', [order.student_id]);
  if (s?.email) {
    const { name: institute } = await tenantInfo();
    await queueEmail(s.email, 'paymentReceived', { institute, name: s.name, amount: Number(order.amount), receiptNo: payment.receiptNo });
  }
  return { status: 'paid', paymentId: payment.id, receiptNo: payment.receiptNo };
}

/* ---------------- 3. the browser reports back ---------------- */

export async function verifyPayment(user, { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature } = {}) {
  if (![orderId, paymentId, signature].every((v) => typeof v === 'string' && v)) throw new HttpError(400, 'Missing payment details.');
  if (!gateway.verifyCheckoutSignature({ orderId, paymentId, signature })) throw new HttpError(400, 'We could not verify this payment.');

  const order = await lockOrder(orderId);
  if (!order || order.student_id !== user.studentId) throw new HttpError(404, 'Payment not found.');
  if (order.status === 'paid') return { status: 'paid', paymentId: order.payment_id };

  // A valid signature proves the order+payment belong together; ask Razorpay whether the money is actually in.
  const pay = await gateway.fetchPayment(paymentId);
  if (pay.order_id !== orderId || Number(pay.amount) !== toPaise(order.amount)) throw new HttpError(409, 'This payment does not match the order.');
  if (pay.status !== 'captured') return { status: 'pending' }; // the webhook settles it the moment it is captured
  return settle(order, { paymentId, method: pay.method, actor: { id: null, role: 'student' } });
}

/* ---------------- 4. Razorpay calls us ---------------- */

export async function handleWebhook(rawBody, signature) {
  if (!gateway.verifyWebhookSignature(rawBody, signature)) throw new HttpError(400, 'Invalid webhook signature.');
  let event;
  try { event = JSON.parse(rawBody.toString('utf8')); } catch { throw new HttpError(400, 'Malformed webhook body.'); }
  const pay = event.payload?.payment?.entity;
  if (!WEBHOOK_EVENTS.has(event.event) || !pay?.order_id) return { ignored: true };

  // Whose order is this? Our own order notes say so. They arrive in the payload for order.paid; otherwise ask
  // Razorpay for the order (authenticated with OUR keys, so it can't be spoofed). The same account takes both
  // student fees and PlanetU subscription payments, and notes.kind tells them apart.
  let notes = event.payload?.order?.entity?.notes;
  if (notes?.kind !== 'subscription' && !isUuid(notes?.tenant_id)) {
    try { notes = (await gateway.fetchOrder(pay.order_id))?.notes; }
    catch (err) { if (err.transient) throw err; return { ignored: true }; } // not an order of ours
  }
  if (notes?.kind === 'subscription') return asPlatform(() => handleSubscriptionWebhook(event, pay));
  const tenantId = notes?.tenant_id;
  if (!isUuid(tenantId)) return { ignored: true };

  return withTx({ tenantId }, async () => {
    const order = await lockOrder(pay.order_id);
    if (!order) return { ignored: true };
    if (event.event === 'payment.failed') {
      // The student can retry on the same order, so a failed attempt is a note, not a final state.
      await q("update online_payment_orders set failure_reason = $2 where id = $1 and status = 'created'", [order.id, String(pay.error_description || 'Payment failed').slice(0, 300)]);
      return { recorded: 'failed' };
    }
    if (Number(pay.amount) !== toPaise(order.amount)) {
      await q("update online_payment_orders set status = 'needs_review', razorpay_payment_id = $2, failure_reason = 'Amount captured does not match the order' where id = $1 and status = 'created'", [order.id, pay.id]);
      return { recorded: 'needs_review' };
    }
    return settle(order, { paymentId: pay.id, method: pay.method, actor: { id: null, role: 'webhook' } });
  });
}

/* ---------------- admin ---------------- */

export async function listOrders({ status } = {}) {
  const params = []; let where = '';
  if (status) { params.push(status); where = 'where o.status = $1'; }
  const { rows } = await q(
    `select o.id, o.amount, o.status, o.method, o.failure_reason as "failureReason", o.razorpay_order_id as "razorpayOrderId",
            o.razorpay_payment_id as "razorpayPaymentId", o.created_at as "createdAt", o.paid_at as "paidAt",
            s.id as "studentId", s.name as "studentName", s.student_code as "studentCode", p.receipt_no as "receiptNo", p.id as "paymentId"
     from online_payment_orders o
     join students s on s.id = o.student_id
     left join payments p on p.id = o.payment_id
     ${where} order by o.created_at desc limit 300`,
    params,
  );
  return rows;
}

/** An admin has dealt with a needs_review order (refunded it in the Razorpay dashboard, or recorded it by hand). */
export async function resolveOrder(id, note, admin) {
  if (!note?.trim()) throw new HttpError(400, 'Say how this was resolved (e.g. "Refunded in Razorpay" or "Recorded manually, receipt RCPT2026-00012").');
  const { rows: [o] } = await q('select id, status, student_id from online_payment_orders where id = $1 for update', [id]);
  if (!o) throw new HttpError(404, 'Order not found.');
  if (o.status !== 'needs_review') throw new HttpError(409, 'Only orders that need review can be resolved.');
  await q("update online_payment_orders set status = 'resolved', failure_reason = $2 where id = $1", [id, note.trim().slice(0, 300)]);
  await audit(admin, 'fees.online_resolved', 'student', o.student_id, { orderId: id, note: note.trim() });
}

/**
 * Paying a subscription invoice online, with the SAME Razorpay account and keys as student fee payments.
 * It has the same four steps as the fee flow (create order -> Checkout -> verify -> webhook), and the same rule:
 * the SERVER decides the amount (it is the invoice total, never anything from the browser), and one function
 * (settleOrder) is the only way an order becomes a payment, so verify and webhook racing is harmless.
 *
 * Subscription orders are told apart from fee orders by their Razorpay notes: { kind: 'subscription', ... }.
 */
import { randomUUID } from 'node:crypto';
import { env } from '../config/env.js';
import { q } from '../db/pool.js';
import { audit } from '../db/audit.js';
import { HttpError } from '../middleware/error.js';
import * as gateway from './razorpay.service.js';
import { getProfile, settleInvoice } from './billing.service.js';
import { toPaise } from './billingCalc.js';

const lockOrder = async (razorpayOrderId) => (await q('select * from billing_orders where razorpay_order_id = $1 for update', [razorpayOrderId])).rows[0];

/* ---------------- 1. create (or resume) an order for an invoice ---------------- */

export async function createOrder({ tenantId, invoiceId, user }) {
  if (!env.RAZORPAY_ENABLED) throw new HttpError(503, 'Online payment is not available right now. Please pay by bank transfer using the details on the invoice.');
  const { rows: [inv] } = await q('select id, number, status, total::float8 as total from billing_invoices where id = $1 and tenant_id = $2', [invoiceId, tenantId]);
  if (!inv) throw new HttpError(404, 'Invoice not found.');
  if (inv.status === 'paid') throw new HttpError(409, 'This invoice is already paid.');
  if (inv.status === 'void') throw new HttpError(409, 'This invoice was voided.');
  if (inv.total <= 0) throw new HttpError(409, 'There is nothing to pay on this invoice.');

  // A retry after a closed checkout reuses the same order: Razorpay orders stay payable until they are paid
  let order = (await q("select * from billing_orders where invoice_id = $1 and status = 'created' order by created_at desc limit 1", [inv.id])).rows[0];
  if (!order) {
    const id = randomUUID();
    const rz = await gateway.createOrder({
      amountPaise: toPaise(inv.total), receipt: id,
      notes: { kind: 'subscription', tenant_id: tenantId, invoice_id: inv.id, order_id: id },
    });
    await q(
      'insert into billing_orders (id, tenant_id, invoice_id, amount, razorpay_order_id, created_by) values ($1, $2, $3, $4, $5, $6)',
      [id, tenantId, inv.id, inv.total, rz.id, user?.id ?? null],
    );
    order = { razorpay_order_id: rz.id };
    await audit(user, 'billing.online_order', 'billing_invoice', inv.id, { tenantId, number: inv.number, amount: inv.total });
  }
  const profile = await getProfile(tenantId);
  return {
    orderId: order.razorpay_order_id, amount: inv.total, amountPaise: toPaise(inv.total), currency: 'INR', keyId: env.RAZORPAY_KEY_ID,
    invoiceNumber: inv.number, prefill: { name: profile.legalName, email: profile.billingEmail || user?.email, contact: profile.billingPhone },
  };
}

/* ---------------- the one place an order becomes a payment ---------------- */

async function settleOrder(order, { paymentId, method, actor }) {
  if (order.status === 'paid') return { status: 'paid' };

  const { rows: [inv] } = await q('select status from billing_invoices where id = $1 for update', [order.invoice_id]);
  if (!inv || inv.status !== 'open') {
    // The gateway HAS the money, but the invoice was settled by other means (e.g. a bank transfer recorded meanwhile) or voided.
    await q(
      `update billing_orders set status = 'needs_review', razorpay_payment_id = $2, method = $3, paid_at = now(), failure_reason = $4 where id = $1`,
      [order.id, paymentId, method ?? null, inv?.status === 'paid' ? 'The invoice was already paid by another route: refund this payment in Razorpay' : 'The invoice was voided before this payment arrived: refund it in Razorpay'],
    );
    await audit(actor, 'billing.online_needs_review', 'billing_invoice', order.invoice_id, { tenantId: order.tenant_id, paymentId });
    return { status: 'needs_review' };
  }

  await q('savepoint settle_billing_order');
  try {
    const r = await settleInvoice(order.invoice_id, {
      method: 'razorpay', reference: paymentId, razorpayPaymentId: paymentId, note: `Paid online via Razorpay${method ? ` (${method})` : ''}`, actor,
    });
    await q('release savepoint settle_billing_order');
    await q("update billing_orders set status = 'paid', razorpay_payment_id = $2, method = $3, paid_at = now(), failure_reason = null where id = $1", [order.id, paymentId, method ?? null]);
    return { status: 'paid', restored: r.restored, paidUntil: r.paidUntil };
  } catch (e) {
    await q('rollback to savepoint settle_billing_order');
    await q("update billing_orders set status = 'needs_review', razorpay_payment_id = $2, method = $3, paid_at = now(), failure_reason = $4 where id = $1", [order.id, paymentId, method ?? null, String(e.message).slice(0, 300)]);
    await audit(actor, 'billing.online_needs_review', 'billing_invoice', order.invoice_id, { tenantId: order.tenant_id, paymentId, reason: e.message });
    return { status: 'needs_review' };
  }
}

/* ---------------- 3. the browser reports back ---------------- */

export async function verifyPayment({ tenantId, user, body }) {
  const { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature } = body || {};
  if (![orderId, paymentId, signature].every((v) => typeof v === 'string' && v)) throw new HttpError(400, 'Missing payment details.');
  if (!gateway.verifyCheckoutSignature({ orderId, paymentId, signature })) throw new HttpError(400, 'We could not verify this payment.');

  const order = await lockOrder(orderId);
  if (!order || order.tenant_id !== tenantId) throw new HttpError(404, 'Payment not found.');
  if (order.status === 'paid') return { status: 'paid' };

  const pay = await gateway.fetchPayment(paymentId);
  if (pay.order_id !== orderId || Number(pay.amount) !== toPaise(order.amount)) throw new HttpError(409, 'This payment does not match the order.');
  if (pay.status !== 'captured') return { status: 'pending' }; // the webhook settles it when captured
  return settleOrder(order, { paymentId, method: pay.method, actor: { id: user?.id ?? null, role: 'admin' } });
}

/* ---------------- 4. Razorpay calls us (dispatched from the shared webhook) ---------------- */

export async function handleSubscriptionWebhook(event, pay) {
  const order = await lockOrder(pay.order_id);
  if (!order) return { ignored: true };
  if (event.event === 'payment.failed') {
    await q("update billing_orders set failure_reason = $2 where id = $1 and status = 'created'", [order.id, String(pay.error_description || 'Payment failed').slice(0, 300)]);
    return { recorded: 'failed' };
  }
  if (Number(pay.amount) !== toPaise(order.amount)) {
    await q("update billing_orders set status = 'needs_review', razorpay_payment_id = $2, failure_reason = 'Amount captured does not match the order' where id = $1 and status = 'created'", [order.id, pay.id]);
    return { recorded: 'needs_review' };
  }
  return settleOrder(order, { paymentId: pay.id, method: pay.method, actor: { id: null, role: 'webhook' } });
}

/* ---------------- vendor: orders that need a human ---------------- */

export async function listReviewOrders() {
  const { rows } = await q(
    `select o.id, o.amount::float8 as amount, o.status, o.failure_reason as "failureReason", o.razorpay_payment_id as "razorpayPaymentId",
            o.paid_at as "paidAt", i.number as "invoiceNumber", t.name as "instituteName"
     from billing_orders o join billing_invoices i on i.id = o.invoice_id join tenants t on t.id = o.tenant_id
     where o.status = 'needs_review' order by o.paid_at desc nulls last`,
  );
  return rows;
}

export async function resolveReviewOrder(id, note, actor) {
  if (!String(note || '').trim()) throw new HttpError(400, 'Say how this was resolved (e.g. "Refunded in the Razorpay dashboard").');
  const { rows: [o] } = await q('select id, status, tenant_id from billing_orders where id = $1 for update', [id]);
  if (!o) throw new HttpError(404, 'Order not found.');
  if (o.status !== 'needs_review') throw new HttpError(409, 'Only orders that need review can be resolved.');
  await q("update billing_orders set status = 'resolved', failure_reason = $2 where id = $1", [id, String(note).trim().slice(0, 300)]);
  await audit(actor, 'billing.online_resolved', 'billing_order', id, { tenantId: o.tenant_id, note });
}

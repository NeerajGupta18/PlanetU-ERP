/**
 * The daily billing run. Safe to run as often as you like (it is idempotent: an invoice for a period can only
 * exist once, and each reminder is recorded so it is sent once), and one institute failing never stops the rest.
 *
 * For each real institute, in order:
 *   1. issue the invoice for the next period when it is within BILLING_INVOICE_LEAD_DAYS of the end of the paid one
 *   2. a cancellation takes effect at the end of the paid period
 *   3. work out whether anything is overdue: past due while inside the grace period, locked once it is over
 *   4. send the most relevant reminder (one per invoice per stage, never a pile of them after downtime)
 */
import { env } from '../config/env.js';
import { q } from '../db/pool.js';
import { audit } from '../db/audit.js';
import * as calc from './billingCalc.js';
import { asPlatform, generateInvoice, notify, todayISO } from './billing.service.js';

const NOTICE_ORDER = ['pre_due', 'due', 'overdue', 'final'];

/** Which reminder stages apply to an open invoice today. The last one that applies is the one to send. */
export function applicableNotices(dueDate, graceDays, today) {
  const out = [];
  if (today >= calc.addDays(dueDate, -2)) out.push('pre_due');
  if (today >= dueDate) out.push('due');
  if (graceDays >= 3 && today >= calc.addDays(dueDate, 3)) out.push('overdue');
  if (graceDays >= 1 && today >= calc.addDays(dueDate, graceDays)) out.push('final');
  return out;
}

async function suspend(sub, reason, invoice, result, today) {
  await q("update tenant_subscriptions set status = 'suspended', suspended_reason = $2, updated_at = now() where tenant_id = $1", [sub.tenant_id, reason]);
  const r = await q("update tenants set status = 'suspended', suspension_reason = 'billing' where id = $1 and status = 'active' returning id", [sub.tenant_id]);
  if (!r.rowCount) return; // already suspended some other way: leave that alone
  result.suspended += 1;
  await audit(null, 'billing.suspend', 'tenant', sub.tenant_id, { tenantId: sub.tenant_id, reason, invoice: invoice?.number ?? null, on: today });
  await notify(sub.tenant_id, 'subscriptionSuspended', { number: invoice?.number ?? null });
}

async function processTenant(tenantId, today, result) {
  const { rows: [sub] } = await q('select * from tenant_subscriptions where tenant_id = $1 for update', [tenantId]);
  if (!sub) return;
  const lead = env.BILLING_INVOICE_LEAD_DAYS;
  const paidUntil = sub.current_period_end;
  const justIssued = new Set();

  /* 1. issue the next invoice */
  if (sub.plan_key !== 'trial' && ['trialing', 'active', 'past_due'].includes(sub.status) && !sub.cancel_at_period_end && paidUntil
      && calc.daysBetween(today, paidUntil) <= lead) {
    const { rowCount } = await q("select 1 from billing_invoices where tenant_id = $1 and period_start = $2 and status <> 'void'", [tenantId, paidUntil]);
    if (!rowCount) {
      try {
        const inv = await generateInvoice(tenantId, { source: 'auto', today });
        justIssued.add(inv.id); result.generated += 1;
      } catch (e) {
        if (e.code === 'BILLING_DETAILS') {
          result.blocked.push({ tenantId, reason: e.message });
          // Ask for the missing details a few times, not every day
          if ([lead, 3, 0].includes(calc.daysBetween(today, paidUntil))) await notify(tenantId, 'subscriptionDetailsNeeded', {});
        } else throw e;
      }
    }
  }

  /* 2. a cancellation ends the access when the paid period ends (no grace: it was the institute's choice) */
  if (sub.cancel_at_period_end && paidUntil && today >= paidUntil && sub.status !== 'suspended') {
    await suspend(sub, 'cancelled', null, result, today);
    return;
  }
  if (sub.status === 'suspended') return; // only a payment, a plan choice or a vendor extension reopens it

  /* 3. overdue? */
  const { rows: open } = await q("select id, number, total::float8 as total, due_date from billing_invoices where tenant_id = $1 and status = 'open' order by due_date", [tenantId]);
  const first = open[0];
  // No open invoice and the paid period has ended: either a trial ran out or invoicing was blocked, so the period end is the due date
  const due = first ? first.due_date : (paidUntil && today >= paidUntil ? paidUntil : null);
  const grace = sub.grace_days;
  if (due && calc.daysBetween(due, today) > 0) {
    if (today <= calc.addDays(due, grace)) {
      if (sub.status !== 'past_due') {
        await q("update tenant_subscriptions set status = 'past_due', updated_at = now() where tenant_id = $1", [tenantId]);
        result.pastDue += 1;
      }
    } else {
      await suspend(sub, first ? 'unpaid' : (sub.plan_key === 'trial' ? 'trial_ended' : 'unpaid'), first, result, today);
      return;
    }
  } else if (sub.status === 'past_due') {
    // The due date moved (a courtesy extension) or was settled elsewhere: back to normal
    const { rowCount: paidEver } = await q('select 1 from billing_payments where tenant_id = $1 limit 1', [tenantId]);
    await q('update tenant_subscriptions set status = $2, updated_at = now() where tenant_id = $1', [tenantId, !paidEver && sub.trial_ends_on && today <= sub.trial_ends_on ? 'trialing' : 'active']);
  }

  /* 4. reminders: only the most relevant stage, once */
  for (const inv of open) {
    if (justIssued.has(inv.id)) continue;
    const stages = applicableNotices(inv.due_date, grace, today);
    const kind = stages[stages.length - 1];
    if (!kind) continue;
    const { rowCount } = await q('insert into billing_notices (invoice_id, kind) values ($1, $2) on conflict do nothing', [inv.id, kind]);
    if (!rowCount) continue;
    await notify(tenantId, 'subscriptionReminder', {
      kind, number: inv.number, total: inv.total, dueDate: inv.due_date, graceEnds: calc.addDays(inv.due_date, grace),
    });
    result.reminders += 1;
  }

  /* trial ending: only when there is no invoice to talk about */
  if (sub.plan_key === 'trial' && sub.status === 'trialing' && sub.trial_ends_on && !sub.trial_notice
      && calc.daysBetween(today, sub.trial_ends_on) <= 3 && calc.daysBetween(today, sub.trial_ends_on) >= 0) {
    await q("update tenant_subscriptions set trial_notice = 'ending' where tenant_id = $1", [tenantId]);
    await notify(tenantId, 'subscriptionTrialEnding', { daysLeft: calc.daysBetween(today, sub.trial_ends_on), endsOn: sub.trial_ends_on });
    result.reminders += 1;
  }
}

/** Runs the whole thing for every billable institute (or just the ones in `only`). `today` is injectable so tests can travel in time. */
export async function runBilling({ today = todayISO(), only = null } = {}) {
  const result = { today, processed: 0, generated: 0, reminders: 0, pastDue: 0, suspended: 0, blocked: [], errors: [] };
  const ids = await asPlatform(async () => (await q(
    `select s.tenant_id from tenant_subscriptions s join tenants t on t.id = s.tenant_id
     where t.plan <> 'demo' and ($1::uuid[] is null or s.tenant_id = any($1::uuid[])) order by t.created_at`, [only],
  )).rows.map((r) => r.tenant_id));
  for (const id of ids) {
    try {
      await asPlatform(() => processTenant(id, today, result));
      result.processed += 1;
    } catch (e) {
      result.errors.push({ tenantId: id, message: e.message });
      console.error(`[billing] ${id}: ${e.message}`);
    }
  }
  return result;
}

let timer; let running = false;
/** Daily in production terms: a first pass shortly after boot, then every few hours (every pass is a no-op if nothing is due). */
export function startBillingWorker({ firstDelayMs = 60_000, everyMs = 6 * 3600_000 } = {}) {
  if (timer) return;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const r = await runBilling();
      if (r.generated || r.suspended || r.errors.length) console.log(`[billing] run: ${r.generated} invoice(s), ${r.reminders} reminder(s), ${r.suspended} suspended, ${r.errors.length} error(s)`);
    } catch (e) { console.error('[billing] run failed:', e.message); } finally { running = false; }
  };
  setTimeout(tick, firstDelayMs).unref();
  timer = setInterval(tick, everyMs);
  timer.unref();
}
export const stopBillingWorker = () => { clearInterval(timer); timer = undefined; };

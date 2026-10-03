/** Plain, dependable transactional emails. Every user-supplied value is HTML-escaped. */
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function layout({ institute, title, lines, cta }) {
  const text = [title, '', ...lines, ...(cta ? ['', `${cta.label}: ${cta.url}`] : []), '', `- ${institute}`].join('\n');
  const html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#1f2937">
<h2 style="color:#4338ca">${esc(title)}</h2>
${lines.map((l) => `<p style="line-height:1.5">${esc(l)}</p>`).join('\n')}
${cta ? `<p><a href="${esc(cta.url)}" style="display:inline-block;padding:10px 18px;background:#4338ca;color:#fff;border-radius:8px;text-decoration:none">${esc(cta.label)}</a></p><p style="font-size:12px;color:#6b7280">If the button doesn't work, copy this link:<br>${esc(cta.url)}</p>` : ''}
<p style="color:#6b7280;font-size:13px">- ${esc(institute)}</p></div>`;
  return { text, html };
}
const mail = (subject, parts) => ({ subject, ...layout(parts) });
const money = (n) => Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const templates = {
  // ---- vendor billing (PlanetU -> institute). Sent platform-level, so the sender shows as PlanetU ----
  subscriptionInvoice: ({ vendor, instituteName, number, total, dueDate, periodStart, periodEnd, url }) => mail(`Invoice ${number} from ${vendor}`, {
    institute: vendor, title: 'Your subscription invoice',
    lines: [`Hello ${instituteName},`, `Invoice ${number} for your PlanetU ERP subscription is ready: ₹${money(total)} for ${periodStart} to ${periodEnd}.`,
      `It is due on ${dueDate}. You can pay online by UPI, card or net banking, and download the GST invoice, from the Billing page.`],
    cta: { label: 'View and pay the invoice', url },
  }),

  subscriptionReminder: ({ vendor, instituteName, kind, number, total, dueDate, graceEnds, url }) => mail(
    {
      pre_due: `Reminder: invoice ${number} is due soon`, due: `Invoice ${number} is due today`,
      overdue: `Overdue: invoice ${number}`, final: `Final notice: invoice ${number} - access will be paused`,
    }[kind],
    {
      institute: vendor,
      title: { pre_due: 'Payment due soon', due: 'Payment due today', overdue: 'Payment overdue', final: 'Final notice before access is paused' }[kind],
      lines: [`Hello ${instituteName},`,
        { pre_due: `Invoice ${number} of ₹${money(total)} is due on ${dueDate}.`, due: `Invoice ${number} of ₹${money(total)} is due today.`,
          overdue: `Invoice ${number} of ₹${money(total)} was due on ${dueDate} and is still unpaid.`,
          final: `Invoice ${number} of ₹${money(total)} (due ${dueDate}) is still unpaid.` }[kind],
        ...(kind === 'overdue' || kind === 'final' ? [`To avoid any interruption, please pay by ${graceEnds}. After that your institute's access is paused until the invoice is paid. Nothing is deleted: your data stays safe and access returns the moment you pay.`] : []),
        'Pay online from the Billing page, or reply to this email if you have already paid by bank transfer.'],
      cta: { label: 'Pay now', url },
    },
  ),

  subscriptionPaid: ({ vendor, instituteName, number, amount, paidUntil, restored, url }) => mail(`Payment received - invoice ${number}`, {
    institute: vendor, title: 'Payment received, thank you',
    lines: [`Hello ${instituteName},`, `We have received ₹${money(amount)} against invoice ${number}.`, `Your subscription is paid up to ${paidUntil}.`,
      ...(restored ? ['Your institute\'s access has been restored.'] : [])],
    cta: { label: 'Open Billing', url },
  }),

  subscriptionSuspended: ({ vendor, instituteName, number, url }) => mail('Your PlanetU ERP access has been paused', {
    institute: vendor, title: 'Access paused for non-payment',
    lines: [`Hello ${instituteName},`, number ? `Invoice ${number} was not paid within the grace period, so access for your institute's users has been paused.` : 'Your subscription has ended, so access for your institute\'s users has been paused.',
      'Your data is safe and nothing has been deleted. Your administrator can still sign in to the Billing page to pay or choose a plan, and everything is restored immediately.'],
    cta: { label: 'Open Billing', url },
  }),

  subscriptionTrialEnding: ({ vendor, instituteName, daysLeft, endsOn, url }) => mail('Your PlanetU ERP trial is ending soon', {
    institute: vendor, title: 'Your free trial ends soon',
    lines: [`Hello ${instituteName},`, `Your free trial ends on ${endsOn} (${daysLeft} day${daysLeft === 1 ? '' : 's'} from now).`,
      'Choose a plan on the Billing page to carry on without interruption. You can pay online straight away.'],
    cta: { label: 'Choose a plan', url },
  }),

  subscriptionDetailsNeeded: ({ vendor, instituteName, url }) => mail('We need your billing details', {
    institute: vendor, title: 'Add your billing details',
    lines: [`Hello ${instituteName},`, 'Your next subscription invoice is due to be issued, but we are missing your billing state, which decides how GST is shown.',
      'Please add your legal name, state and (if you have one) GSTIN on the Billing page.'],
    cta: { label: 'Add billing details', url },
  }),

  paymentReceived: ({ institute, name, amount, receiptNo }) => mail(`Payment received - receipt ${receiptNo}`, {
    institute, title: 'Payment received',
    lines: [`Hello ${name},`, `We have received your online payment of ₹${Number(amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} at ${institute}.`,
      `Your receipt number is ${receiptNo}. You can download the receipt any time from Fees in your student portal.`],
  }),

  applicationReceived: ({ institute, name, applicationNo, statusUrl }) => mail(`We received your application ${applicationNo}`, {
    institute, title: 'Application received',
    lines: [`Hello ${name},`, `Thank you for applying to ${institute}. Your application number is ${applicationNo}. We will review your documents and update you by email.`,
      'Keep your access code safe - you need it, with your application number, to check your status.'],
    cta: { label: 'Check your status', url: statusUrl },
  }),

  documentRejected: ({ institute, name, applicationNo, docLabel, remark, statusUrl }) => mail(`Action needed on application ${applicationNo}`, {
    institute, title: 'A document needs to be replaced',
    lines: [`Hello ${name},`, `Your ${docLabel} could not be accepted.`, `Reason: ${remark}`, 'Please upload a corrected copy and submit your application again.'],
    cta: { label: 'Fix your application', url: statusUrl },
  }),

  applicationDecision: ({ institute, name, applicationNo, decision, note, statusUrl }) => mail(`Update on application ${applicationNo}`, {
    institute, title: { accepted: 'Congratulations - you have been accepted', waitlisted: 'You have been waitlisted', rejected: 'Your application was not successful' }[decision],
    lines: [`Hello ${name},`, `There is an update on application ${applicationNo} at ${institute}.`, ...(note ? [`Message from the institute: ${note}`] : []),
      ...(decision === 'accepted' ? ['We will contact you shortly with the enrolment steps.'] : [])],
    cta: { label: 'View details', url: statusUrl },
  }),

  accessCodeRecovered: ({ institute, name, entries, statusUrl }) => mail('Your new application access code', {
    institute, title: 'New access code',
    lines: [`Hello ${name},`, 'Someone (hopefully you) asked for a new access code. The old code no longer works.',
      ...entries.map((e) => `Application ${e.applicationNo}: access code ${e.accessCode}`), "If you didn't ask for this, you can ignore this email."],
    cta: { label: 'Check your status', url: statusUrl },
  }),

  accountSetup: ({ institute, name, instituteCode, loginId, link, hours }) => mail(`Your ${institute} account is ready`, {
    institute, title: 'Set up your account',
    lines: [`Hello ${name},`, `An account has been created for you at ${institute}.`, `Institute code: ${instituteCode}`, `Your login ID: ${loginId}`,
      `Choose your password with the button below. The link works once and expires in ${hours} hours.`],
    cta: { label: 'Set your password', url: link },
  }),

  passwordReset: ({ institute, name, link, minutes }) => mail('Reset your password', {
    institute, title: 'Reset your password',
    lines: [`Hello ${name},`, `We received a request to reset your password. The link works once and expires in ${minutes} minutes.`,
      "If you didn't ask for this, ignore this email - your password has not changed."],
    cta: { label: 'Choose a new password', url: link },
  }),

  passwordChanged: ({ institute, name }) => mail('Your password was changed', {
    institute, title: 'Password changed',
    lines: [`Hello ${name},`, 'Your password was just changed and every other signed-in session was ended.', "If this wasn't you, reset your password immediately and tell your administrator."],
  }),
};

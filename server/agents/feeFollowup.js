/**
 * Fee follow-up (accountant): finds overdue dues, groups them by guardian, and drafts ONE reminder template in
 * the chosen language. The model only writes wording with placeholders; it never sees a name, phone number or
 * amount. Our code fills the placeholders from the records when the reminders are sent, and the amounts are
 * read again at that moment, so a guardian who paid in between is skipped.
 *
 * Nothing is sent by the assistant: it creates a "Send N reminders" proposal, and only a person's approval in
 * the approval inbox sends the in-app notices (the same notices as the Fees page) and prepares the share links.
 */
import { env } from '../src/config/env.js';
import { HttpError } from '../src/middleware/error.js';
import { isUuid } from '../src/db/pool.js';
import { reminders, whatsappNumber } from '../src/services/fees.service.js';
import { notifyStudent } from '../src/services/inbox.service.js';
import { tenantInfo } from '../src/services/notifications.service.js';
import { Refusal, ask, guardedRun, playbook } from './runner.js';
import { createProposal } from './proposals.js';
import { LANGUAGES, checkTemplate, cleanDraft, fillTemplate } from './templates.js';

export { LANGUAGES, fillTemplate };
export const PLACEHOLDERS = ['guardian', 'students', 'amount', 'since', 'institute', 'link'];
const REQUIRED = ['guardian', 'amount', 'link'];

/** Used when the model's draft breaks a rule, so the accountant always gets a usable, checked template. */
export const STANDARD = {
  en: 'Dear {guardian}, this is a gentle reminder from {institute}. Fees of {amount} for {students} have been due since {since}. Please pay at the fee office or online: {link} Thank you.',
  hi: 'प्रिय {guardian}, {institute} की ओर से विनम्र अनुस्मरण। {students} की {amount} फीस {since} से बकाया है। कृपया फीस कार्यालय में या ऑनलाइन भुगतान करें: {link} धन्यवाद।',
  mr: 'प्रिय {guardian}, {institute} कडून नम्र आठवण. {students} यांची {amount} फी {since} पासून बाकी आहे. कृपया फी कार्यालयात किंवा ऑनलाइन भरा: {link} धन्यवाद.',
};

/** Why a template cannot be used, or null when it is fine. */
export const templateProblem = (t) => checkTemplate(t, { allowed: PLACEHOLDERS, required: REQUIRED });

const rupees = (n) => `Rs. ${Math.round(Number(n)).toLocaleString('en-IN')}`;
const day = (d) => new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
const first = (name) => String(name || '').trim().split(/\s+/)[0] || '';
const guardianKey = (r) => {
  const d = String(r.guardianPhone || '').replace(/\D/g, '').slice(-10);
  return d.length === 10 ? `p:${d}` : `s:${r.id}`;
};


/** Overdue students grouped by guardian (same guardian phone = one reminder). Amounts straight from SQL. */
export async function overdueGroups({ courseId } = {}) {
  if (courseId && !isUuid(courseId)) throw new HttpError(400, 'Choose a class, or leave it empty for all classes.');
  const { students } = await reminders({ courseId, overdueOnly: true });
  const groups = new Map();
  for (const s of students) {
    const key = guardianKey(s);
    const g = groups.get(key) || { key, guardian: s.guardianName || 'Parent', phone: s.guardianPhone || s.phone || '', students: [], overdue: 0, oldestDue: null };
    g.students.push({ id: s.id, code: s.studentCode, name: s.name, course: s.course, overdue: s.overdue, oldestDue: s.oldestDue, parentLinked: s.parentLinked });
    g.overdue = Math.round((g.overdue + s.overdue) * 100) / 100;
    if (!g.oldestDue || (s.oldestDue && s.oldestDue < g.oldestDue)) g.oldestDue = s.oldestDue;
    groups.set(key, g);
  }
  const list = [...groups.values()].sort((a, b) => String(a.oldestDue).localeCompare(String(b.oldestDue)) || b.overdue - a.overdue);
  return {
    groups: list,
    guardians: list.length,
    students: students.length,
    overdueTotal: Math.round(students.reduce((s, x) => s + x.overdue, 0) * 100) / 100,
  };
}

/** What the Fee follow-up screen shows. Phone numbers stay on the server; the screen only learns whether one exists. */
export async function feeOverview(courseId) {
  const o = await overdueGroups({ courseId });
  return { ...o, groups: o.groups.map(({ phone, ...g }) => ({ ...g, hasPhone: Boolean(whatsappNumber(phone)) })) };
}

/** Drafts the template and creates the "Send N reminders" proposal. */
export async function draftReminders(ctx, { language, courseId } = {}) {
  if (!LANGUAGES[language]) throw new HttpError(400, 'Choose English, Hindi or Marathi.');
  return guardedRun(ctx, { agent: 'fees', input: `draft reminders (${LANGUAGES[language]})` }, async (trace) => {
    const o = await overdueGroups({ courseId });
    if (!o.guardians) throw new Refusal(409, 'Nobody has overdue fees right now, so there is nothing to send.');
    // The model gets the language only: no names, no amounts, no phone numbers
    const msg = await ask(trace, {
      messages: [{ role: 'system', content: playbook('fees') }, { role: 'user', content: `Language: ${LANGUAGES[language]}. Write the template.` }],
      maxTokens: 500,
    });
    const drafted = cleanDraft(msg.content);
    const problem = templateProblem(drafted);
    const template = problem ? STANDARD[language] : drafted;
    const n = o.guardians;
    return {
      outcome: 'proposed',
      template,
      usedStandard: Boolean(problem),
      standardReason: problem ? `The assistant's draft was not used because ${problem}. The standard wording is used instead.` : null,
      after: async (runId) => ({
        proposal: await createProposal(ctx, {
          runId, agent: 'fees', kind: 'fee_reminders',
          title: `Send ${n} reminder${n === 1 ? '' : 's'} (${LANGUAGES[language]})`,
          summary: `Overdue fees for ${o.students} student${o.students === 1 ? '' : 's'}, grouped into ${n} guardian${n === 1 ? '' : 's'}. Each guardian gets one reminder in the app, and a ready-to-send WhatsApp link is prepared. Amounts are read again when you approve, so anyone who has paid by then is skipped.`,
          payload: { language, template, courseId: courseId || null, groups: o.groups.map((g) => ({ key: g.key, studentIds: g.students.map((s) => s.id) })) },
          figures: { guardians: n, students: o.students, overdueTotal: o.overdueTotal },
        }),
      }),
    };
  });
}

/** After approval: the in-app notices and the share links, with amounts read now. */
export async function applyFeeReminders(p, user) {
  const { payload } = p;
  const now = await overdueGroups({ courseId: payload.courseId || undefined });
  const byStudent = new Map();
  for (const g of now.groups) for (const s of g.students) byStudent.set(s.id, { g, s });
  const info = await tenantInfo();
  const link = `${env.APP_URL}/login`;
  let sent = 0; let notices = 0; let paidSince = 0;
  const links = [];
  for (const grp of payload.groups) {
    const still = grp.studentIds.map((id) => byStudent.get(id)).filter(Boolean);
    if (!still.length) { paidSince += 1; continue; }
    const g = still[0].g;
    const kids = still.map((x) => x.s);
    const amount = kids.reduce((a, s) => a + s.overdue, 0);
    const since = kids.map((s) => s.oldestDue).filter(Boolean).sort()[0];
    const message = fillTemplate(payload.template, {
      guardian: g.guardian, students: kids.map((s) => first(s.name)).join(', '), amount: rupees(amount),
      since: since ? day(since) : '', institute: info.name, link,
    });
    for (const s of kids) {
      await notifyStudent(s.id, { kind: 'fees', title: 'Fee overdue', body: message.slice(0, 500), link: '/student/fees' }, { parents: true });
      notices += 1;
    }
    const wa = whatsappNumber(g.phone);
    links.push({ guardian: g.guardian, students: kids.map((s) => s.code), amount: Math.round(amount * 100) / 100, whatsapp: wa ? `https://wa.me/${wa}?text=${encodeURIComponent(message)}` : null });
    sent += 1;
  }
  return { sent, notices, paidSince, links, auditMeta: { sent, notices, paidSince } };
}

/** For an approved reminder round: how many guardians have since cleared everything that was overdue. */
export async function feeTracking(p) {
  const now = await overdueGroups({ courseId: p.payload.courseId || undefined });
  const owing = new Set(now.groups.flatMap((g) => g.students.map((s) => s.id)));
  const total = p.payload.groups.length;
  const paid = p.payload.groups.filter((g) => !g.studentIds.some((id) => owing.has(id))).length;
  return { guardians: total, paid, stillOverdue: total - paid };
}

/** What the approver sees: each guardian with amounts as they are now, and one reminder filled in as it will go out. */
export async function feeProposalDetail(p) {
  const now = await overdueGroups({ courseId: p.payload.courseId || undefined });
  const byStudent = new Map();
  for (const g of now.groups) for (const s of g.students) byStudent.set(s.id, { g, s });
  const info = await tenantInfo();
  const groups = p.payload.groups.map((grp) => {
    const still = grp.studentIds.map((id) => byStudent.get(id)).filter(Boolean);
    const kids = still.map((x) => x.s);
    return {
      guardian: still[0]?.g.guardian ?? null,
      hasPhone: Boolean(still[0] && whatsappNumber(still[0].g.phone)),
      students: kids.map((s) => ({ code: s.code, name: s.name, course: s.course, overdue: s.overdue, oldestDue: s.oldestDue })),
      overdue: Math.round(kids.reduce((a, s) => a + s.overdue, 0) * 100) / 100,
      paid: !still.length,
    };
  });
  const firstOpen = groups.find((g) => !g.paid);
  const preview = firstOpen ? fillTemplate(p.payload.template, {
    guardian: firstOpen.guardian, students: firstOpen.students.map((s) => first(s.name)).join(', '), amount: rupees(firstOpen.overdue),
    since: day(firstOpen.students.map((s) => s.oldestDue).filter(Boolean).sort()[0]), institute: info.name, link: `${env.APP_URL}/login`,
  }) : null;
  return {
    groups,
    preview,
    toSend: groups.filter((g) => !g.paid).length,
    tracking: p.status === 'approved' ? await feeTracking(p) : null,
  };
}

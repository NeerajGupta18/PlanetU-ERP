/**
 * Admissions helper (admission office): checks one application or enquiry for missing documents and possible
 * duplicates, suggests the next step, and drafts a reply to the applicant.
 *
 * The checks and the next step are plain code and SQL. The model only drafts the reply's wording, with
 * placeholders our code fills; it gets NO tools, so nothing written inside an enquiry can make it do anything.
 * Text the applicant wrote (a pasted email or WhatsApp message) goes in as untrusted data, with phone numbers
 * and email addresses removed first. The assistant never accepts, rejects, waitlists, offers, waives or deletes:
 * every decision stays with the admission office. The reply itself goes out only after someone approves it.
 */
import { env } from '../src/config/env.js';
import { isUuid, q } from '../src/db/pool.js';
import { HttpError } from '../src/middleware/error.js';
import { REQUIRED_DOCS } from '../src/services/admissions.service.js';
import { whatsappNumber } from '../src/services/fees.service.js';
import { queueEmail, tenantInfo } from '../src/services/notifications.service.js';
import { ask, guardedRun, playbook, untrusted } from './runner.js';
import { createProposal } from './proposals.js';
import { LANGUAGES, checkTemplate, cleanDraft, fillTemplate } from './templates.js';

export const DOC_LABEL = { photo: 'passport-size photo', signature: 'signature', id_proof: 'ID proof', marksheet: 'previous marksheet', other: 'document' };
export const REPLY_PLACEHOLDERS = ['name', 'application_no', 'course', 'missing', 'link'];
const STATUS_WORDS = {
  draft: 'the applicant has started the form but not submitted it yet', submitted: 'submitted, and the office is checking it', documents_pending: 'the office is waiting for a document from the applicant',
  accepted: 'decided by the office', waitlisted: 'decided by the office', rejected: 'decided by the office', enrolled: 'enrolled',
};
// A reply must not announce or promise a decision: those words send it back to the standard wording
const DECISION_WORDS = /\b(accept(ed|ance)?|admitted|admission (is )?confirmed|selected|reject(ed|ion)?|waitlist(ed)?|waive[rd]?|discount|scholarship|offer letter|seat (is )?(confirmed|reserved|guaranteed)|refund)\b/i;

export const STANDARD_REPLY = {
  en: 'Dear {name}, thank you for your interest in {course}. Your application {application_no} is with our admission office. {missing} You can see your application and upload documents here: {link} Our office will contact you about the next step.',
  hi: 'प्रिय {name}, {course} में रुचि के लिए धन्यवाद। आपका आवेदन {application_no} हमारे प्रवेश कार्यालय के पास है। {missing} आप अपना आवेदन देख सकते हैं और दस्तावेज़ यहाँ अपलोड कर सकते हैं: {link} अगले कदम के बारे में हमारा कार्यालय आपसे संपर्क करेगा।',
  mr: 'प्रिय {name}, {course} मध्ये रस दाखवल्याबद्दल धन्यवाद. आपला अर्ज {application_no} आमच्या प्रवेश कार्यालयाकडे आहे. {missing} आपला अर्ज पाहण्यासाठी आणि कागदपत्रे अपलोड करण्यासाठी: {link} पुढील टप्प्याबद्दल आमचे कार्यालय आपल्याशी संपर्क करेल.',
};

/** Why a reply cannot be used, or null when it is fine. */
export function replyProblem(t) {
  const p = checkTemplate(t, { allowed: REPLY_PLACEHOLDERS, required: [], maxLength: 900 });
  if (p) return p;
  if (DECISION_WORDS.test(t)) return 'it talks about a decision, which only the admission office makes';
  return null;
}

/** Phone numbers and email addresses are taken out before any outside text reaches a model. */
export function redactContacts(text) {
  return String(text ?? '')
    .replace(/[^\s@<>()]+@[^\s@<>()]+\.[^\s@<>()]+/g, '[email removed]')
    .replace(/\+?\d[\d\s().-]{7,}\d/g, '[phone removed]');
}

const first = (name) => String(name || '').trim().split(/\s+/)[0] || '';

/** The check: documents, possible duplicates and the next step. All from SQL; no model. */
export async function checkApplication(id) {
  if (!isUuid(id)) throw new HttpError(400, 'Choose an application from the list.');
  const { rows: [a] } = await q(
    `select a.id, a.application_no as "applicationNo", a.name, a.email, a.phone, a.dob, a.status, a.fee_status as "feeStatus",
            a.source, c.name as course
     from applications a join courses c on c.id = a.course_id where a.id = $1`, [id],
  );
  if (!a) throw new HttpError(404, 'That application was not found. Reload the list.');
  const { rows: docs } = await q('select doc_type as "docType", status from application_documents where application_id = $1', [id]);
  const documents = REQUIRED_DOCS.map((t) => {
    const d = docs.filter((x) => x.docType === t);
    const status = d.some((x) => x.status === 'verified') ? 'verified' : d.some((x) => x.status === 'pending' || x.status === 'uploaded') ? 'uploaded'
      : d.some((x) => x.status === 'rejected') ? 'rejected' : d.length ? d[0].status : 'missing';
    return { docType: t, label: DOC_LABEL[t], status };
  });
  const digits = String(a.phone || '').replace(/\D/g, '').slice(-10);
  const { rows: duplicates } = await q(
    `select 'application' as kind, o.application_no as ref, o.status,
            array_remove(array[
              case when lower(o.email) = lower($2) then 'email' end,
              case when length($3) = 10 and right(regexp_replace(coalesce(o.phone, ''), '\\D', '', 'g'), 10) = $3 then 'phone' end,
              case when lower(o.name) = lower($4) and o.dob is not null and o.dob = $5 then 'name and date of birth' end], null) as matched
     from applications o
     where o.id <> $1 and (lower(o.email) = lower($2)
       or (length($3) = 10 and right(regexp_replace(coalesce(o.phone, ''), '\\D', '', 'g'), 10) = $3)
       or (lower(o.name) = lower($4) and o.dob is not null and o.dob = $5))
     union all
     select 'student', s.student_code, s.status,
            array_remove(array[
              case when lower(s.email) = lower($2) then 'email' end,
              case when length($3) = 10 and right(regexp_replace(coalesce(s.phone, ''), '\\D', '', 'g'), 10) = $3 then 'phone' end,
              case when lower(s.name) = lower($4) and s.dob is not null and s.dob = $5 then 'name and date of birth' end], null)
     from students s
     where s.id is distinct from (select student_id from applications where id = $1) and (lower(s.email) = lower($2)
       or (length($3) = 10 and right(regexp_replace(coalesce(s.phone, ''), '\\D', '', 'g'), 10) = $3)
       or (lower(s.name) = lower($4) and s.dob is not null and s.dob = $5))
     limit 10`,
    [id, a.email, digits, a.name, a.dob],
  );
  const missing = documents.filter((d) => d.status === 'missing' || d.status === 'rejected');
  return { application: a, documents, missing, duplicates, nextStep: nextStep(a, documents, duplicates) };
}

/** A suggestion for the office, never an action. Decisions are named as the office's, not the assistant's. */
export function nextStep(a, documents, duplicates) {
  if (duplicates.length) return 'Check the possible duplicate first: open the other record and compare.';
  if (['accepted', 'waitlisted', 'rejected', 'enrolled'].includes(a.status)) return 'The office has already decided this application. No step is suggested.';
  if (a.status === 'draft') return 'The applicant has not submitted the form yet. Send the form link again if they need it.';
  if (documents.some((d) => d.status === 'rejected')) return 'Ask the applicant to upload a fresh copy of the rejected document.';
  if (documents.some((d) => d.status === 'missing')) return 'Ask the applicant for the missing documents.';
  if (documents.some((d) => d.status !== 'verified')) return 'Check the uploaded documents: Admissions, open the application, Check documents.';
  if (a.feeStatus === 'pending') return 'The application fee is still to be paid or waived by the office.';
  return 'Everything is checked. The application is ready for the admission office to decide.';
}

/** Recent applications to choose from (not the decided ones). Codes and names only. */
export async function helperList() {
  const { rows } = await q(
    `select a.id, a.application_no as "applicationNo", a.name, a.status, c.name as course, coalesce(a.submitted_at, a.created_at) as "at"
     from applications a join courses c on c.id = a.course_id
     where a.status in ('draft', 'submitted', 'documents_pending', 'waitlisted')
     order by coalesce(a.submitted_at, a.created_at) desc limit 200`,
  );
  return { applications: rows };
}

/** Checks the application, drafts the reply and creates the "Reply to ..." proposal. */
export async function helpWithEnquiry(ctx, { applicationId, message, language = 'en' } = {}) {
  if (!LANGUAGES[language]) throw new HttpError(400, 'Choose English, Hindi or Marathi.');
  const text = String(message ?? '').trim();
  if (text.length > 2000) throw new HttpError(400, 'Keep the pasted message under 2,000 characters.');
  const check = await checkApplication(applicationId);
  const a = check.application;
  return guardedRun(ctx, { agent: 'admissions', input: `reply to ${a.applicationNo}${text ? ' (with the applicant\'s message)' : ''}` }, async (trace) => {
    // The model gets the course, the stage in words and the missing documents' names. No name, email, phone or number.
    const facts = [
      `Language: ${LANGUAGES[language]}.`,
      `Course: ${a.course}.`,
      `Application stage: ${STATUS_WORDS[a.status] || a.status}.`,
      `Missing documents: ${check.missing.length ? check.missing.map((d) => d.label).join(', ') : 'none'}.`,
    ].join('\n');
    const user = `${facts}\n\n${text ? untrusted('message from the applicant', redactContacts(text)) : 'The applicant sent no message.'}\n\nWrite the reply.`;
    // No tools are offered: whatever the message says, the only possible output is wording
    const msg = await ask(trace, { messages: [{ role: 'system', content: playbook('admissions') }, { role: 'user', content: user }], maxTokens: 600 });
    const drafted = cleanDraft(msg.content);
    const problem = replyProblem(drafted);
    const reply = problem ? STANDARD_REPLY[language] : drafted;
    const figures = { missingDocuments: check.missing.map((d) => d.label), duplicates: check.duplicates.length, nextStep: check.nextStep };
    return {
      outcome: 'proposed',
      check: { ...check, application: { applicationNo: a.applicationNo, name: a.name, course: a.course, status: a.status, feeStatus: a.feeStatus } },
      reply,
      ignoredTools: (msg.tool_calls || []).length,
      usedStandard: Boolean(problem),
      standardReason: problem ? `The assistant's draft was not used because ${problem}. The standard wording is used instead.` : null,
      after: async (runId) => ({
        proposal: await createProposal(ctx, {
          runId, agent: 'admissions', kind: 'enquiry_reply',
          title: `Reply to ${a.applicationNo} (${LANGUAGES[language]})`,
          summary: `A reply to ${first(a.name)} about ${a.course}. It goes by email${whatsappNumber(a.phone) ? ', with a ready-to-send WhatsApp link' : ''}, only when you approve. Suggested next step for the office: ${check.nextStep}`,
          payload: { applicationId: a.id, language, reply },
          figures,
        }),
      }),
    };
  });
}

async function filled(p) {
  const check = await checkApplication(p.payload.applicationId);
  const a = check.application;
  const info = await tenantInfo();
  const missing = check.missing.length ? `Please upload: ${check.missing.map((d) => d.label).join(', ')}.` : '';
  const message = fillTemplate(p.payload.reply, {
    name: first(a.name), application_no: a.applicationNo, course: a.course, missing, link: `${env.APP_URL}/apply/${info.code}/status`,
  }).replace(/\s{2,}/g, ' ').trim();
  return { check, a, info, message };
}

/** After approval: the email to the applicant (through the normal email queue) and a WhatsApp link. */
export async function applyEnquiryReply(p) {
  const { a, info, message } = await filled(p);
  await queueEmail(a.email, 'applicationMessage', { institute: info.name, name: a.name, applicationNo: a.applicationNo, message, statusUrl: `${env.APP_URL}/apply/${info.code}/status` });
  const wa = whatsappNumber(a.phone);
  return { emailed: true, whatsapp: wa ? `https://wa.me/${wa}?text=${encodeURIComponent(message)}` : null, auditMeta: { applicationNo: a.applicationNo } };
}

/** What the approver sees: the check as it is now, and the reply exactly as it will go out. */
export async function replyProposalDetail(p) {
  let f;
  try {
    f = await filled(p);
  } catch (err) {
    // The application was removed after the reply was drafted: the proposal can still be read and rejected
    if (err instanceof HttpError && err.status === 404) return { application: null, documents: [], duplicates: [], nextStep: 'This application no longer exists, so the reply cannot be sent. Reject the proposal.', preview: null, hasPhone: false };
    throw err;
  }
  const { check, a, message } = f;
  return {
    application: { applicationNo: a.applicationNo, name: a.name, course: a.course, status: a.status },
    documents: check.documents, duplicates: check.duplicates, nextStep: check.nextStep,
    preview: message, hasPhone: Boolean(whatsappNumber(a.phone)),
  };
}

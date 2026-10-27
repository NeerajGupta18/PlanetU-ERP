/**
 * Attendance watch (class teacher, principal): flags students absent on each of their last three days of
 * registers, and students below or close to the minimum attendance, then drafts ONE parent note template.
 *
 * The flags and every percentage come from SQL. The model writes wording with placeholders only and never sees a
 * name, phone number or figure. Nothing is sent by the assistant: it creates a "Send N parent notes" proposal, and
 * only a person's approval sends the in-app notices (the same notices as the rest of the app) and prepares the
 * WhatsApp links. A class teacher sees and decides only for their own classes.
 */
import { env } from '../src/config/env.js';
import { isUuid, q } from '../src/db/pool.js';
import { HttpError } from '../src/middleware/error.js';
import { DEFAULT_THRESHOLD, pct } from '../src/services/attendance.service.js';
import { whatsappNumber } from '../src/services/fees.service.js';
import { notifyStudent } from '../src/services/inbox.service.js';
import { tenantInfo } from '../src/services/notifications.service.js';
import { Refusal, ask, guardedRun, playbook } from './runner.js';
import { createProposal } from './proposals.js';
import { LANGUAGES, checkTemplate, cleanDraft, fillTemplate } from './templates.js';
import { hasArea } from './tools.js';

export const MINIMUM = DEFAULT_THRESHOLD;
export const NEAR_BY = 5; // "close to the minimum" = within five points above it
export const NOTE_PLACEHOLDERS = ['guardian', 'student', 'percent', 'minimum', 'institute', 'link'];
const REQUIRED = ['student', 'percent'];

export const STANDARD_NOTE = {
  en: 'Dear {guardian}, we would like to share a note from {institute} about {student}\'s attendance. It is now {percent}, and the minimum needed is {minimum}. We would be glad to talk if anything is making it hard to attend. You can see the details in the app: {link}',
  hi: 'प्रिय {guardian}, {institute} की ओर से {student} की उपस्थिति के बारे में एक सूचना। अभी उपस्थिति {percent} है, और न्यूनतम {minimum} आवश्यक है। यदि आने में कोई कठिनाई है तो हमसे बात करें। विवरण ऐप में देखें: {link}',
  mr: 'प्रिय {guardian}, {institute} कडून {student} यांच्या उपस्थितीबद्दल एक सूचना. सध्या उपस्थिती {percent} आहे, आणि किमान {minimum} आवश्यक आहे. येण्यात काही अडचण असल्यास आमच्याशी बोला. तपशील ॲपमध्ये पाहा: {link}',
};
export const noteProblem = (t) => checkTemplate(t, { allowed: NOTE_PLACEHOLDERS, required: REQUIRED });

const first = (name) => String(name || '').trim().split(/\s+/)[0] || '';

/** Which classes this person watches: every class (attendance office role), or the classes they are class teacher of. */
export function watchScope(ctx) {
  if (hasArea(ctx, 'attendance')) return { all: true, courseIds: [] };
  return { all: false, courseIds: ctx.classes || [] };
}
export const canWatch = (ctx) => ctx.tenant?.modules?.includes('attendance') && (hasArea(ctx, 'attendance') || (ctx.classes || []).length > 0);

/**
 * Active students with their term attendance and their last three days of registers. A day counts as absent when
 * the student attended none of that day's submitted registers.
 */
async function studentFigures({ courseIds, studentIds } = {}) {
  const params = [];
  const where = ["s.status = 'Active'"];
  if (courseIds) { params.push(courseIds); where.push(`s.course_id = any($${params.length}::uuid[])`); }
  if (studentIds) { params.push(studentIds); where.push(`s.id = any($${params.length}::uuid[])`); }
  const { rows } = await q(
    `with days as (
       select rec.student_id, a.on_date, bool_or(rec.status in ('present', 'late')) as attended
       from attendance_records rec join attendance_sessions a on a.id = rec.session_id
       where a.status = 'submitted' group by rec.student_id, a.on_date
     ), recent as (
       select student_id, on_date, attended, row_number() over (partition by student_id order by on_date desc) as rn from days
     ), streak as (
       select student_id, count(*) filter (where rn <= 3)::int as days, count(*) filter (where rn <= 3 and not attended)::int as absent,
              max(on_date) filter (where rn = 1) as last_day
       from recent group by student_id
     ), term as (
       select rec.student_id, count(*)::int as marks, count(*) filter (where rec.status in ('present', 'late'))::int as attended
       from attendance_records rec join attendance_sessions a on a.id = rec.session_id
       where a.status = 'submitted' group by rec.student_id
     )
     select s.id, s.student_code as code, s.name, s.course_id as "courseId", c.code as "classCode", c.name as class,
            t.marks, t.attended, coalesce(st.days, 0) as "recentDays", coalesce(st.absent, 0) as "recentAbsent", st.last_day as "lastDay",
            s.guardian->>'name' as "guardianName", s.guardian->>'phone' as "guardianPhone", s.phone,
            exists (select 1 from parent_links l where l.student_id = s.id) as "parentLinked"
     from students s join term t on t.student_id = s.id left join streak st on st.student_id = s.id
     left join courses c on c.id = s.course_id
     where ${where.join(' and ')}`, params,
  );
  return rows.map((r) => {
    const percent = pct(r.attended, r.marks);
    const threeInARow = r.recentDays >= 3 && r.recentAbsent >= 3;
    const level = percent < MINIMUM ? 'below' : percent < MINIMUM + NEAR_BY ? 'near' : null;
    return { ...r, percent, threeInARow, level, flagged: threeInARow || Boolean(level) };
  });
}

/** The flagged students in this person's classes, worst first. Phone numbers stay on the server. */
export async function watchOverview(ctx, courseId) {
  if (courseId && !isUuid(courseId)) throw new HttpError(400, 'Choose a class, or leave it empty for all your classes.');
  const scope = watchScope(ctx);
  if (courseId && !scope.all && !scope.courseIds.includes(courseId)) throw new HttpError(403, 'You are not the class teacher of that class.');
  const courseIds = courseId ? [courseId] : scope.all ? undefined : scope.courseIds;
  const all = await studentFigures({ courseIds });
  const flagged = all.filter((s) => s.flagged).sort((a, b) => Number(b.threeInARow) - Number(a.threeInARow) || a.percent - b.percent || a.code.localeCompare(b.code));
  const { rows: classes } = await q(
    `select id, code, name from courses ${scope.all ? '' : 'where id = any($1::uuid[])'} order by code`, scope.all ? [] : [scope.courseIds],
  );
  return {
    minimum: MINIMUM, nearBy: NEAR_BY, classes,
    watched: all.length,
    counts: {
      flagged: flagged.length,
      threeInARow: flagged.filter((s) => s.threeInARow).length,
      below: flagged.filter((s) => s.level === 'below').length,
      near: flagged.filter((s) => s.level === 'near').length,
    },
    students: flagged.map(({ guardianPhone, phone, marks, attended, ...s }) => ({ ...s, marks, attended, hasPhone: Boolean(whatsappNumber(guardianPhone || phone)) })),
  };
}

/** Drafts the note and creates the "Send N parent notes" proposal. */
export async function draftNotes(ctx, { language, courseId, studentIds } = {}) {
  if (!LANGUAGES[language]) throw new HttpError(400, 'Choose English, Hindi or Marathi.');
  if (studentIds !== undefined && (!Array.isArray(studentIds) || studentIds.length > 200 || !studentIds.every(isUuid))) {
    throw new HttpError(400, 'Choose the students from the list.');
  }
  return guardedRun(ctx, { agent: 'attendance', input: `draft parent notes (${LANGUAGES[language]})` }, async (trace) => {
    const o = await watchOverview(ctx, courseId);
    const chosen = studentIds ? o.students.filter((s) => studentIds.includes(s.id)) : o.students;
    if (!chosen.length) throw new Refusal(409, 'No student in your classes needs a note right now.');
    // The model gets the language only: no names, no figures, no phone numbers
    const msg = await ask(trace, {
      messages: [{ role: 'system', content: playbook('attendance') }, { role: 'user', content: `Language: ${LANGUAGES[language]}. Write the note.` }],
      maxTokens: 500,
    });
    const drafted = cleanDraft(msg.content);
    const problem = noteProblem(drafted);
    const template = problem ? STANDARD_NOTE[language] : drafted;
    const n = chosen.length;
    const counts = { threeInARow: chosen.filter((s) => s.threeInARow).length, below: chosen.filter((s) => s.level === 'below').length, near: chosen.filter((s) => s.level === 'near').length };
    return {
      outcome: 'proposed',
      template,
      usedStandard: Boolean(problem),
      standardReason: problem ? `The assistant's draft was not used because ${problem}. The standard wording is used instead.` : null,
      after: async (runId) => ({
        proposal: await createProposal(ctx, {
          runId, agent: 'attendance', kind: 'parent_notes',
          title: `Send ${n} parent note${n === 1 ? '' : 's'} (${LANGUAGES[language]})`,
          summary: `Attendance notes for ${n} student${n === 1 ? '' : 's'}: ${counts.threeInARow} absent on each of their last three days, ${counts.below} below ${MINIMUM}%, ${counts.near} close to it. Parents get the note in the app, and a ready-to-send WhatsApp link is prepared. Figures are read again when you approve.`,
          payload: { language, template, courseIds: [...new Set(chosen.map((s) => s.courseId))], studentIds: chosen.map((s) => s.id) },
          figures: { students: n, ...counts, minimum: MINIMUM },
        }),
      }),
    };
  });
}

function noteFor(template, s, info) {
  return fillTemplate(template, {
    guardian: s.guardianName || 'Parent', student: first(s.name), percent: `${s.percent}%`, minimum: `${MINIMUM}%`,
    institute: info.name, link: `${env.APP_URL}/login`,
  });
}

/** After approval: the in-app notices and the share links, with figures read now. A student no longer flagged is skipped. */
export async function applyParentNotes(p) {
  const now = await studentFigures({ studentIds: p.payload.studentIds });
  const info = await tenantInfo();
  let sent = 0; let improved = 0;
  const links = [];
  for (const s of now) {
    if (!s.flagged) { improved += 1; continue; }
    const message = noteFor(p.payload.template, s, info);
    await notifyStudent(s.id, { kind: 'attendance', title: 'A note about attendance', body: message.slice(0, 500), link: '/student/attendance' }, { parents: true });
    const wa = whatsappNumber(s.guardianPhone || s.phone);
    links.push({ student: `${s.name} (${s.code})`, percent: s.percent, whatsapp: wa ? `https://wa.me/${wa}?text=${encodeURIComponent(message)}` : null });
    sent += 1;
  }
  return { sent, improved, links, auditMeta: { sent, improved } };
}

/** What the approver sees: each student with figures as they are now, and one note filled in as it will go out. */
export async function notesProposalDetail(p) {
  const now = await studentFigures({ studentIds: p.payload.studentIds });
  const info = await tenantInfo();
  const students = now.map((s) => ({
    code: s.code, name: s.name, classCode: s.classCode, percent: s.percent, threeInARow: s.threeInARow, level: s.level, flagged: s.flagged,
    parentLinked: s.parentLinked, hasPhone: Boolean(whatsappNumber(s.guardianPhone || s.phone)),
  })).sort((a, b) => a.percent - b.percent);
  const firstOpen = now.find((s) => s.flagged);
  return {
    template: p.payload.template, language: p.payload.language, minimum: MINIMUM,
    students, toSend: students.filter((s) => s.flagged).length,
    preview: firstOpen ? noteFor(p.payload.template, firstOpen, info) : null,
  };
}

/** The classes this employee is class teacher of. */
export async function classesOf(employeeId) {
  if (!employeeId) return [];
  const { rows } = await q('select id from courses where class_teacher_id = $1', [employeeId]);
  return rows.map((r) => r.id);
}

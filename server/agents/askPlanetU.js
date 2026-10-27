/**
 * Ask PlanetU (principal, admin): plain-words questions over the institute's own data, read only, plus the
 * one-screen morning brief. The answer always comes with the figures it used, straight from the tools' SQL.
 * If the model's wording contains a number that is not in those figures, the wording is not shown.
 */
import { HttpError } from '../src/middleware/error.js';
import { Refusal, ask, guardedRun, playbook, toolLoop, ungroundedNumbers } from './runner.js';
import { runTool, toolAllowed } from './tools.js';

export const ASK_TOOLS = ['attendance_by_class', 'students_below_attendance', 'fee_dues', 'fee_collections', 'student_counts',
  'admissions_summary', 'staff_on_leave', 'waiting_for_decision', 'exams_status'];

const CANNOT = 'I could not find figures for that. I can answer about attendance, fee dues and collections, student numbers, applications, staff on leave, items waiting for a decision and exams.';
const UNSURE = 'Here are the figures for your question. I could not word an answer that matches them exactly, so please read the figures below.';

export async function askQuestion(ctx, question) {
  const text = String(question ?? '').replace(/\s+/g, ' ').trim();
  if (text.length < 3) throw new HttpError(400, 'Type a question, for example: Which classes had the lowest attendance this week?');
  if (text.length > 300) throw new HttpError(400, 'Keep the question under 300 characters.');
  return guardedRun(ctx, { agent: 'ask', input: text }, async (trace) => {
    const today = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const { text: answer, results } = await toolLoop(ctx, trace, {
      system: `${playbook('ask')}\n\nToday is ${today}.`, user: text, toolNames: ASK_TOOLS,
    });
    let shown = answer;
    let grounded = true;
    if (!results.length) {
      // With no figures, any number in the wording is made up; and an empty answer needs a plain reply
      if (!answer || ungroundedNumbers(answer, [], text).length) shown = CANNOT;
    } else if (!answer || ungroundedNumbers(answer, results, text).length) {
      shown = UNSURE; grounded = false;
    }
    return { outcome: 'answered', answer: shown, grounded, figures: results.map((r) => ({ tool: r.name, args: r.args, ...r.result })) };
  });
}

/* ---------------- morning brief ---------------- */

const BRIEF = [
  ['attendance_by_class', { period: 'yesterday' }, 'attendanceYesterday'],
  ['attendance_by_class', { period: 'this_week' }, 'attendanceWeek'],
  ['students_below_attendance', { threshold: 75 }, 'below75'],
  ['fee_dues', {}, 'dues'],
  ['fee_collections', { period: 'yesterday' }, 'collectedYesterday'],
  ['waiting_for_decision', {}, 'waiting'],
  ['staff_on_leave', { period: 'today' }, 'onLeave'],
  ['admissions_summary', {}, 'admissions'],
];

/** Today's figures, each straight from a tool (only those this person's role covers). No model involved. */
export async function briefFigures(ctx) {
  const out = {};
  for (const [name, args, key] of BRIEF) {
    if (!toolAllowed(ctx, name)) continue;
    const r = await runTool(ctx, [name], name, args);
    if (r.ok) out[key] = r.result;
  }
  // Only codes and the lowest few: the screen links to the full lists
  if (out.below75) out.below75 = { ...out.below75, lowest: out.below75.lowest.slice(0, 5) };
  return { date: new Date().toISOString().slice(0, 10), figures: out };
}

/** The brief in a few plain sentences, written by the model from the same figures. */
export async function briefSummary(ctx) {
  const brief = await briefFigures(ctx);
  if (!Object.keys(brief.figures).length) throw new HttpError(403, 'Your role does not cover any of the morning brief.');
  return guardedRun(ctx, { agent: 'brief', input: 'morning brief' }, async (trace) => {
    // Codes and first names are left out here: the summary talks about classes and totals only
    const compact = JSON.parse(JSON.stringify(brief.figures));
    if (compact.below75) delete compact.below75.lowest;
    if (compact.onLeave) delete compact.onLeave.staff;
    const msg = await ask(trace, {
      messages: [{ role: 'system', content: playbook('brief') }, { role: 'user', content: `Today's figures (JSON):\n${JSON.stringify(compact)}` }],
      maxTokens: 400,
    });
    const text = (msg.content || '').trim();
    const figuresList = Object.values(compact).map((result) => ({ result }));
    if (!text) throw new Refusal(424, 'The assistant gave an empty summary. The figures are shown below.');
    const ok = !ungroundedNumbers(text, figuresList).length;
    return { outcome: 'answered', summary: ok ? text : null, grounded: ok, ...brief };
  });
}

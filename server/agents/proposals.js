/**
 * The approval inbox. A proposal is the ONLY thing an assistant writes. Nothing changes until a person whose
 * office role covers the change approves it; then the app's own functions apply it (fee reminders, the student
 * importer, the staff importer). Rejecting changes nothing. Every decision is also written to the audit log.
 */
import { q } from '../src/db/pool.js';
import { audit } from '../src/db/audit.js';
import { HttpError } from '../src/middleware/error.js';
import { hasArea } from './tools.js';

// Which office area may decide each kind. Staff import is the institute admin's alone (like the Setup page).
// Parent notes may also be decided by a class teacher, for their own classes only.
const KINDS = {
  fee_reminders: { area: 'fees', module: 'fees' },
  student_import: { area: 'students', module: 'students' },
  staff_import: { area: null, module: null },
  parent_notes: { area: 'attendance', module: 'attendance', classTeacher: true },
  enquiry_reply: { area: 'admissions', module: 'admissions' },
};

export function canDecide(ctx, kind) {
  const k = KINDS[kind];
  if (!k) return false;
  if (k.module && !ctx.tenant?.modules?.includes(k.module)) return false;
  if (k.classTeacher && (ctx.classes || []).length) return true;
  return k.area ? hasArea(ctx, k.area) : Boolean(ctx.office?.full);
}
export const decidableKinds = (ctx) => Object.keys(KINDS).filter((k) => canDecide(ctx, k));

/** A class teacher (without the attendance office role) only sees parent notes for classes they teach. */
const onlyOwnClasses = (ctx) => !hasArea(ctx, 'attendance');
function canDecideRow(ctx, p) {
  if (!canDecide(ctx, p.kind)) return false;
  if (p.kind !== 'parent_notes' || !onlyOwnClasses(ctx)) return true;
  const mine = ctx.classes || [];
  return (p.payload?.courseIds || []).every((id) => mine.includes(id));
}

export async function createProposal(ctx, { runId, agent, kind, title, summary, payload, figures }) {
  const { rows: [p] } = await q(
    `insert into agent_proposals (run_id, agent, kind, title, summary, payload, figures, created_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8) returning id, status, title, summary, figures, created_at as "createdAt"`,
    [runId, agent, kind, title.slice(0, 200), String(summary).slice(0, 2000), JSON.stringify(payload), JSON.stringify(figures), ctx.user.id],
  );
  return { ...p, kind, agent };
}

const LIST_COLUMNS = `p.id, p.agent, p.kind, p.title, p.summary, p.figures, p.status, p.created_at as "createdAt",
  p.decided_at as "decidedAt", p.decision_note as "decisionNote", cu.name as "createdBy", du.name as "decidedBy"`;
const FROM = 'from agent_proposals p left join users cu on cu.id = p.created_by left join users du on du.id = p.decided_by';

/** Proposals this person may decide, newest first, with the count still waiting. */
export async function listProposals(ctx, { status } = {}) {
  const kinds = decidableKinds(ctx);
  if (status && !['pending', 'approved', 'rejected', 'failed'].includes(status)) throw new HttpError(400, 'Unknown status.');
  const params = [kinds];
  let scope = '';
  if (onlyOwnClasses(ctx)) { params.push(JSON.stringify(ctx.classes || [])); scope = ` and (p.kind <> 'parent_notes' or coalesce(p.payload->'courseIds', '[]') <@ $${params.length}::jsonb)`; }
  let where = `p.kind = any($1)${scope}`;
  const countParams = [...params];
  if (status) { params.push(status); where += ` and p.status = $${params.length}`; }
  const { rows } = await q(`select ${LIST_COLUMNS} ${FROM} where ${where} order by (p.status = 'pending') desc, p.created_at desc limit 100`, params);
  const { rows: [c] } = await q(`select count(*)::int as n from agent_proposals p where p.status = 'pending' and p.kind = any($1)${scope}`, countParams);
  return { proposals: rows, pending: c.n };
}

async function loadOwn(ctx, id, lock = false) {
  const { rows: [p] } = await q(`select p.*, cu.name as "createdByName", du.name as "decidedByName" ${FROM} where p.id = $1 ${lock ? 'for update of p' : ''}`, [id]);
  if (!p || !canDecideRow(ctx, p)) throw new HttpError(404, 'That proposal was not found.');
  return p;
}

/**
 * One proposal with what the person needs to decide: for fee reminders the guardians and amounts as they are
 * NOW (and, once sent, how many have paid since); for an import the cleaned rows' check; for parent notes the
 * students' figures now; for a reply the application's check. Phone numbers and the raw sheet are not sent to
 * the browser before approval. `details` maps a kind to its detail function.
 */
export async function getProposal(ctx, id, details) {
  const p = await loadOwn(ctx, id);
  const base = {
    id: p.id, agent: p.agent, kind: p.kind, title: p.title, summary: p.summary, figures: p.figures, status: p.status,
    createdAt: p.created_at, createdBy: p.createdByName, decidedAt: p.decided_at, decidedBy: p.decidedByName, decisionNote: p.decision_note, result: p.result,
  };
  if (p.kind === 'fee_reminders') return { ...base, template: p.payload.template, language: p.payload.language, ...(await details.fee_reminders(p)) };
  if (p.kind === 'parent_notes' || p.kind === 'enquiry_reply') return { ...base, ...(await details[p.kind](p)) };
  return { ...base, fileName: p.payload.fileName, ...(await details.import(p)) };
}

/**
 * Approve or reject. Approval runs the change inside a savepoint: if the change itself fails (say, an email is
 * now taken), the proposal is marked "failed" with the reason and nothing half-done is kept.
 */
export async function decide(ctx, id, { decision, note }, apply) {
  if (!['approve', 'reject'].includes(decision)) throw new HttpError(400, 'Choose approve or reject.');
  const text = String(note ?? '').trim().slice(0, 500);
  const p = await loadOwn(ctx, id, true);
  if (p.status !== 'pending') throw new HttpError(409, `This proposal was already ${p.status}.`);
  let status = 'rejected'; let result = null;
  if (decision === 'approve') {
    await q('savepoint agent_apply');
    try {
      const { auditMeta, ...r } = await apply(p, ctx.user);
      await q('release savepoint agent_apply');
      status = 'approved'; result = r;
      await audit(ctx.user, `assistant.${p.kind}`, 'agent_proposal', p.id, auditMeta || {});
    } catch (err) {
      await q('rollback to savepoint agent_apply');
      if (!(err instanceof HttpError) || err.status >= 500) throw err;
      status = 'failed'; result = { error: err.message };
    }
  }
  await q(
    'update agent_proposals set status = $2, decided_by = $3, decided_at = now(), decision_note = $4, result = $5 where id = $1',
    [p.id, status, ctx.user.id, text || null, result ? JSON.stringify(result) : null],
  );
  await audit(ctx.user, decision === 'approve' ? 'assistant.approve' : 'assistant.reject', 'agent_proposal', p.id, { kind: p.kind, status });
  return { id: p.id, status, result };
}

/** The run log for the admin: who asked, which assistant, tools, outcome, tokens. */
export async function listRuns() {
  const { rows } = await q(
    `select r.id, r.agent, r.input, r.tools, r.outcome, r.model, r.prompt_tokens + r.completion_tokens as tokens, r.created_at as "createdAt",
            u.name as "user", r.actor_role as role,
            (select json_build_object('id', p.id, 'title', p.title, 'status', p.status) from agent_proposals p where p.run_id = r.id limit 1) as proposal
     from agent_runs r left join users u on u.id = r.user_id order by r.created_at desc limit 100`,
  );
  return { runs: rows };
}

/**
 * The AI assistants and their approval inbox: /api/assistants/...
 *
 * Everything runs as the signed-in person, inside their own request transaction (Row Level Security), with the
 * same office roles as the rest of the admin area: the institute admin has every assistant; a principal has Ask
 * PlanetU; an accountant Fee follow-up; an admission officer the Setup fixer for student sheets. Staff sheets and
 * the run log stay with the institute admin.
 */
import { Router } from 'express';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';
import { HttpError } from '../middleware/error.js';
import { rebindTx, requireAuth } from '../middleware/auth.js';
import { officeOf } from '../services/staff.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { uuidParam } from './wrap.js';
import { llmStatus } from '../../agents/llm.js';
import { tokensToday } from '../../agents/runner.js';
import { hasArea } from '../../agents/tools.js';
import { askQuestion, briefFigures, briefSummary } from '../../agents/askPlanetU.js';
import { applyFeeReminders, draftReminders, feeOverview, feeProposalDetail } from '../../agents/feeFollowup.js';
import { applyImport, fixSheet } from '../../agents/setupFixer.js';
import { decidableKinds, decide, getProposal, listProposals, listRuns } from '../../agents/proposals.js';
import { IMPORT_LIMITS, analyse as analyseStudents, previewRow as studentRow } from '../services/studentImport.service.js';
import { analyse as analyseStaff, previewRow as staffRow } from '../services/staffImport.service.js';

const router = Router();
const h = asyncHandler;

/** Who is asking, with their office powers (as in the admin area). Students and parents have no assistants. */
async function assistantAccess(req, res, next) {
  try {
    let office;
    if (req.user.role === 'admin') office = { full: true };
    else if (req.user.role === 'employee') {
      const o = await officeOf(req.user);
      if (!o) throw new HttpError(403, 'You do not have access to the assistants.');
      office = { full: false, areas: o.areas, roles: o.roles };
      req.user = { ...req.user, role: 'admin', staff: { roles: o.roles.map((r) => r.role) } };
    } else throw new HttpError(403, 'You do not have access to the assistants.');
    req.ctx = { user: req.user, tenant: req.tenant, office };
    req.can = {
      ask: office.full || hasArea(req.ctx, 'dashboard'),
      fees: req.tenant.modules.includes('fees') && hasArea(req.ctx, 'fees'),
      setupStudents: req.tenant.modules.includes('students') && hasArea(req.ctx, 'students'),
      setupStaff: office.full,
      inbox: decidableKinds(req.ctx).length > 0,
      log: office.full,
    };
    return next();
  } catch (err) {
    return next(err);
  }
}
const need = (key) => (req, res, next) => (req.can[key] ? next() : next(new HttpError(403, 'Your role does not include this assistant.')));

// Each person may start only a few runs a minute (the model provider's own limit is shared by the institute)
const runLimit = rateLimit({
  windowMs: 60 * 1000, limit: () => env.AGENT_RUNS_PER_MINUTE, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => `u:${req.user.id}`,
  handler: (req, res) => res.status(429).json({ message: 'The assistant is busy, try again in a minute.', code: 'BUSY' }),
});

const sheetParser = multer({ storage: multer.memoryStorage(), limits: { fileSize: IMPORT_LIMITS.maxBytes, files: 1 } }).single('file');
const sheetUpload = (req, res, next) => sheetParser(req, res, (err) => {
  if (!err) return rebindTx(req, res, next);
  if (err.code === 'LIMIT_FILE_SIZE') return next(new HttpError(413, 'That file is too large (2 MB at most).'));
  return next(new HttpError(400, 'Could not read the upload. Send one CSV file in the "file" field.'));
});

router.use(requireAuth, assistantAccess);
router.param('id', uuidParam);

router.get('/status', h(async (req, res) => {
  const s = llmStatus('agent');
  res.json({
    connected: s.connected, model: s.connected ? s.model : null,
    tokensToday: await tokensToday(), dailyTokens: env.AGENT_DAILY_TOKENS, can: req.can,
  });
}));

/* Ask PlanetU */
router.post('/ask', need('ask'), runLimit, h(async (req, res) => res.json(await askQuestion(req.ctx, req.body?.question))));
router.get('/brief', need('ask'), h(async (req, res) => res.json(await briefFigures(req.ctx))));
router.post('/brief/summary', need('ask'), runLimit, h(async (req, res) => res.json(await briefSummary(req.ctx))));

/* Fee follow-up */
router.get('/fees/overview', need('fees'), h(async (req, res) => res.json(await feeOverview(req.query.courseId || undefined))));
router.post('/fees/draft', need('fees'), runLimit, h(async (req, res) => res.json(await draftReminders(req.ctx, req.body || {}))));

/* Setup fixer */
router.post('/setup/clean', runLimit, sheetUpload, h(async (req, res) => {
  const kind = req.body?.kind;
  if (!(kind === 'staff' ? req.can.setupStaff : kind === 'students' ? req.can.setupStudents : false)) {
    throw new HttpError(kind === 'staff' || kind === 'students' ? 403 : 400, kind === 'staff' || kind === 'students' ? 'Your role does not include this kind of sheet.' : 'Choose whether the sheet lists students or staff.');
  }
  res.json(await fixSheet(req.ctx, { buffer: req.file?.buffer, kind, fileName: req.file?.originalname }));
}));

/* Approval inbox */
async function importDetail(p) {
  const staff = p.kind === 'staff_import';
  const a = await (staff ? analyseStaff : analyseStudents)(Buffer.from(p.payload.csv, 'utf8'));
  return { check: { summary: a.summary, rows: a.rows.slice(0, 200).map(staff ? staffRow : studentRow) } };
}
const applyProposal = (p, user) => (p.kind === 'fee_reminders' ? applyFeeReminders(p, user) : applyImport(p, user));

router.get('/proposals', need('inbox'), h(async (req, res) => res.json(await listProposals(req.ctx, { status: req.query.status || undefined }))));
router.get('/proposals/:id', need('inbox'), h(async (req, res) => res.json(await getProposal(req.ctx, req.params.id, { feeDetail: feeProposalDetail, importDetail }))));
router.post('/proposals/:id/decide', need('inbox'), h(async (req, res) => res.json(await decide(req.ctx, req.params.id, req.body || {}, applyProposal))));

/* Run log */
router.get('/runs', need('log'), h(async (req, res) => res.json(await listRuns())));

export default router;

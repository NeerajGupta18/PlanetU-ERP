import { Router } from 'express';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { q, withTx } from '../db/pool.js';
import { HttpError } from '../middleware/error.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { MAX_BYTES } from '../services/files.service.js';
import * as raw from '../controllers/publicAdmissions.controller.js';
import { uuidParam } from './wrap.js';

const router = Router({ mergeParams: true });
router.param('id', uuidParam);

// Limits are read per request so they can be tuned (and tested) without a restart
const limit = (name, def) => rateLimit({
  windowMs: 60 * 60 * 1000, limit: () => Number(process.env[name] || def), standardHeaders: true, legacyHeaders: false,
  message: { message: 'Too many requests. Please try again later.' },
});
const general = limit('PUBLIC_RATE_LIMIT', 300);
const creates = limit('PUBLIC_CREATE_LIMIT', 10);
const lookups = limit('PUBLIC_LOOKUP_LIMIT', 30); // guards the access code against guessing

// Resolves the institute from the URL and checks it is active and offers admissions
const resolveTenant = asyncHandler(async (req, res, next) => {
  const code = String(req.params.code || '').toLowerCase();
  const t = await withTx({ platform: true }, async () => (
    await q("select id, code, name, terminology from tenants where code = $1 and status = 'active' and 'admissions' = any(modules)", [code])
  ).rows[0]);
  if (!t) throw new HttpError(404, 'Admissions are not open at this institute.');
  req.publicTenant = t;
  next();
});

// Runs the handler inside a transaction scoped to that institute, committing before the response is sent
const inTenant = (fn) => asyncHandler(async (req, res) => {
  const tx = { status: 200, body: null };
  const fakeRes = {
    status(c) { tx.status = c; return this; },
    json(b) { tx.body = b; return this; },
  };
  await withTx({ tenantId: req.publicTenant.id }, () => fn(req, fakeRes));
  res.status(tx.status).json(tx.body);
});

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_BYTES, files: 1 } });
const h = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, inTenant(v)]));

router.use(general, resolveTenant);
router.get('/info', h.info);
router.post('/applications', creates, h.create);
router.post('/applications/lookup', lookups, h.lookup);
router.post('/applications/recover', lookups, h.recover);
router.get('/applications/:id', h.status);
router.post('/applications/:id/documents', upload.single('file'), h.upload);
router.post('/applications/:id/submit', h.submit);

export default router;

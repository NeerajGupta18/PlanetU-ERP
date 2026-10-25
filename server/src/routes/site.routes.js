import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { withTx } from '../db/pool.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { createDemoRequest } from '../services/demoRequests.service.js';

// The public landing page (no sign-in): only the "Book a demo" form talks to the server
const router = Router();
// Read per request so it can be tuned (and tested) without a restart
const demoLimit = rateLimit({
  windowMs: 60 * 60 * 1000, limit: () => Number(process.env.DEMO_REQUEST_LIMIT || 5), standardHeaders: true, legacyHeaders: false,
  message: { message: 'Too many requests from this connection. Please try again in an hour, or email us instead.' },
});

router.post('/demo-requests', demoLimit, asyncHandler(async (req, res) => {
  // A hidden "website" field that people never see: bots that fill every box are thanked and ignored
  if (req.body?.website) return res.status(201).json({ ok: true });
  await withTx({ platform: true }, () => createDemoRequest(req.body || {}));
  return res.status(201).json({ ok: true });
}));

export default router;

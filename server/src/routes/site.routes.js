import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';
import { withTx } from '../db/pool.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { createDemoRequest } from '../services/demoRequests.service.js';
import { llmStatus } from '../../agents/llm.js';
import { MAX_MESSAGE, answer, bookDemo, leaveMessage, startSession } from '../../agents/supportChat.js';

// The public landing page (no sign-in): the "Book a demo" form and the help chat talk to the server
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

/* ---- Support Help Agent (the chat bubble) ---- */
const chatStart = rateLimit({
  windowMs: 60 * 60 * 1000, limit: () => Number(process.env.PUBLIC_CHAT_STARTS || 10), standardHeaders: true, legacyHeaders: false,
  message: { message: 'Too many chats from this connection. Please try again later, or book a demo.' },
});
const chatMessages = rateLimit({
  windowMs: 60 * 1000, limit: () => env.PUBLIC_CHAT_PER_MINUTE, standardHeaders: true, legacyHeaders: false,
  message: { message: 'The assistant is busy, try again in a minute.', code: 'BUSY' },
});

router.get('/chat/status', (req, res) => res.json({ connected: llmStatus('public').connected, maxMessage: MAX_MESSAGE }));
router.post('/chat/start', chatStart, (req, res, next) => {
  try { res.json(startSession(req.body?.captchaToken)); } catch (err) { next(err); }
});
router.post('/chat/message', chatMessages, asyncHandler(async (req, res) => res.json(await answer(req.body || {}))));
router.post('/chat/demo', demoLimit, asyncHandler(async (req, res) => res.status(201).json(await bookDemo(req.body || {}))));
router.post('/chat/leave-message', demoLimit, asyncHandler(async (req, res) => res.status(201).json(await leaveMessage(req.body || {}))));

export default router;

import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAuth } from '../middleware/auth.js';
import * as auth from '../controllers/auth.controller.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false,
  message: { message: 'Too many requests. Please wait a few minutes and try again.' },
});

router.get('/captcha/config', auth.captchaConfig);
router.get('/demo-logins', auth.demoLogins);
router.post('/captcha/verify', limiter, asyncHandler(auth.captchaVerify));
router.get('/captcha/challenge', limiter, auth.captchaNewChallenge);
router.post('/captcha/challenge', limiter, auth.captchaAnswer);
router.post('/login', limiter, asyncHandler(auth.login));
router.get('/me', requireAuth, asyncHandler(auth.me));
router.get('/tenant/:code', limiter, asyncHandler(auth.publicTenantInfo));
router.post('/forgot-password', limiter, asyncHandler(auth.forgotPassword));
router.post('/reset-password', limiter, asyncHandler(auth.resetPassword));
router.post('/change-password', requireAuth, asyncHandler(auth.changePassword));
router.post('/logout', auth.logout);

export default router;

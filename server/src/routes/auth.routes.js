import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAuth, requireRole } from '../middleware/auth.js';
import * as auth from '../controllers/auth.controller.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { uuidParam } from './wrap.js';

const router = Router();
router.param('id', uuidParam);

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false,
  message: { message: 'Too many requests. Please wait a few minutes and try again.' },
});
// Fingerprint sign-in and "forget this device" take a token instead of a password: kept on a tighter leash.
// Read per request so tests can tune it.
const deviceLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, limit: () => Number(process.env.DEVICE_LOGIN_LIMIT || 20), standardHeaders: true, legacyHeaders: false,
  message: { code: 'RATE_LIMITED', message: 'Too many tries. Please wait a few minutes, or sign in with your password.' },
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

// Fingerprint sign-in on the Android app (trusted devices)
router.post('/device-login', deviceLimiter, asyncHandler(auth.deviceLogin));
router.post('/devices/forget', deviceLimiter, asyncHandler(auth.forgetDevice));
router.post('/devices', requireAuth, asyncHandler(auth.trustDevice));
router.get('/devices', requireAuth, asyncHandler(auth.myDevices));
router.delete('/devices/:id', requireAuth, asyncHandler(auth.removeMyDevice));
router.get('/devices/all', requireAuth, requireRole('admin'), asyncHandler(auth.allDevices));
router.delete('/devices/all/:id', requireAuth, requireRole('admin'), asyncHandler(auth.removeAnyDevice));

export default router;

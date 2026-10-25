import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import * as rawInbox from '../controllers/inbox.controller.js';
import * as rawSetup from '../controllers/setup.controller.js';
import * as rawConsent from '../controllers/consent.controller.js';
import { wrapAll } from './wrap.js';

const inbox = wrapAll(rawInbox);
const setup = wrapAll(rawSetup);
const consent = wrapAll(rawConsent);
const router = Router();
// The bell in the top bar, for every role that belongs to an institute (the platform admin has none)
router.use(requireAuth, requireRole('admin', 'employee', 'student', 'parent'));
router.get('/notifications', inbox.bell);
router.post('/notifications/read-all', inbox.readAll);
router.post('/notifications/:id/read', inbox.read);
// The institute's own logo (sidebar, top bar, and later receipts and ID cards)
router.get('/logo', setup.logo);
// What a parent agreed to at first sign-in, and recording that answer
router.get('/consent', consent.status);
router.post('/consent', consent.record);

export default router;

import { Router } from 'express';
import { requireAuth, requireModule, requireRole } from '../middleware/auth.js';
import * as rawParents from '../controllers/parents.controller.js';
import { wrapAll } from './wrap.js';

const parents = wrapAll(rawParents);
const router = Router();
// Everything a parent reads about a child goes through the student routes (see middleware/parent.js); this is only
// the list of children and the choice of which one is showing.
router.use(requireAuth, requireRole('parent'), requireModule('parent_portal'));
router.get('/children', parents.children);
router.post('/child', parents.selectChild);

export default router;

import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import * as student from '../controllers/student.controller.js';

const router = Router();
router.use(requireAuth, requireRole('student'));

router.get('/dashboard', student.dashboard);
router.get('/profile', student.profile);
router.get('/institute', student.institute);
router.get('/calendar', student.calendar);
router.get('/timetable', student.timetable);

export default router;

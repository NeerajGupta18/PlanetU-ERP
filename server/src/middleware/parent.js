import { HttpError } from './error.js';
import { CHILD_COOKIE, resolveChild } from '../services/parents.service.js';

/**
 * What a parent may open in the student area: reading their child's attendance, timetable, results, fees (and paying
 * them), notices and calendar, and raising tickets. Everything else there (quizzes, learning, library, ID card,
 * certificates, feedback) is for the student.
 */
const PARENT_ALLOWED = /^\/(dashboard|profile|institute|calendar|timetable|attendance|results|fees|notices|grievances)(\/|$)/;

/**
 * Lets the student routes serve a parent: it points the request at the child the parent has chosen (checked against
 * their links, never trusted from the client), so every student endpoint then answers for that child.
 * Students pass straight through.
 */
export async function asChild(req, res, next) {
  if (req.user.role !== 'parent') return next();
  try {
    if (!req.tenant.modules.includes('parent_portal')) {
      return res.status(403).json({ message: 'This module is not enabled for your institute.', code: 'MODULE_DISABLED' });
    }
    if (!PARENT_ALLOWED.test(req.path)) return res.status(403).json({ message: 'This section is for the student.' });
    const childId = await resolveChild(req.user.id, req.cookies?.[CHILD_COOKIE]);
    if (!childId) throw new HttpError(403, 'No student is linked to your account yet. Please ask the office.');
    req.childId = childId;
    req.user = { ...req.user, studentId: childId, profileId: childId };
    return next();
  } catch (err) {
    return next(err);
  }
}

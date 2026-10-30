import { HttpError } from './error.js';
import { CHILD_COOKIE, childrenOf } from '../services/parents.service.js';

/**
 * What a parent may open in the student area: reading their child's day, attendance, timetable, results, fees (and paying
 * them), hostel and transport, notices and calendar, and raising tickets. Everything else there (quizzes, learning, library, ID card,
 * certificates, feedback) is for the student.
 */
const PARENT_ALLOWED = /^\/(dashboard|my-day|profile|institute|calendar|timetable|attendance|results|fees|notices|grievances|hostel|transport)(\/|$)/;

/**
 * Lets the student routes serve a parent: it points the request at the child the parent has chosen (checked against
 * their links, never trusted from the client), so every student endpoint then answers for that child.
 * A choice that is not one of their children is refused with no data, and forgotten so the next request starts clean.
 * Students pass straight through.
 */
export async function asChild(req, res, next) {
  if (req.user.role !== 'parent') return next();
  try {
    if (!req.tenant.modules.includes('parent_portal')) {
      return res.status(403).json({ message: 'This module is not enabled for your institute.', code: 'MODULE_DISABLED' });
    }
    if (!PARENT_ALLOWED.test(req.path)) return res.status(403).json({ message: 'This section is for the student.' });
    const kids = await childrenOf(req.user.id);
    if (!kids.length) throw new HttpError(403, 'No student is linked to your account yet. Please ask the office.');
    const wanted = req.cookies?.[CHILD_COOKIE];
    if (wanted && !kids.some((k) => k.id === wanted)) {
      res.clearCookie(CHILD_COOKIE);
      throw new HttpError(403, 'That student is not linked to your account.');
    }
    const childId = wanted || kids[0].id;
    req.childId = childId;
    req.user = { ...req.user, studentId: childId, profileId: childId };
    return next();
  } catch (err) {
    return next(err);
  }
}

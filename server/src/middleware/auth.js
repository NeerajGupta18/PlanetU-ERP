import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { db } from '../db/store.js';

export function requireAuth(req, res, next) {
  const token = req.cookies?.[env.COOKIE_NAME];
  if (!token) return res.status(401).json({ message: 'Please sign in to continue.' });
  try {
    const payload = jwt.verify(token, env.JWT_SECRET);
    if (payload.typ !== 'session') throw new Error('wrong token type');
    const user = db().users.find((u) => u.id === payload.sub && u.status === 'active');
    if (!user) throw new Error('user not found');
    req.user = user;
    return next();
  } catch {
    res.clearCookie(env.COOKIE_NAME);
    return res.status(401).json({ message: 'Your session has expired. Please sign in again.' });
  }
}

/** Usage: router.use(requireRole('student')) */
export const requireRole = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user?.role)) {
    return res.status(403).json({ message: 'You do not have access to this section.' });
  }
  return next();
};

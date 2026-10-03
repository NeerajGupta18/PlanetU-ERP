import { asyncHandler } from '../utils/asyncHandler.js';
import { isUuid } from '../db/pool.js';

/** Wraps every exported handler so a rejected promise reaches the error middleware. */
export const wrapAll = (mod) => Object.fromEntries(
  Object.entries(mod).map(([k, v]) => [k, typeof v === 'function' ? asyncHandler(v) : v]),
);

/** router.param('id', uuidParam) - a malformed id is simply "not found", never a database error. */
export const uuidParam = (req, res, next, value) => (
  isUuid(value) ? next() : res.status(404).json({ message: 'Not found.' })
);

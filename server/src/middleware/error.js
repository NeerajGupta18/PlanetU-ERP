import { env } from '../config/env.js';

export function notFound(req, res) {
  res.status(404).json({ message: `Route not found: ${req.method} ${req.originalUrl}` });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : err.name === 'MulterError' ? 400 : err.status || 500;
  if (err.code === 'LIMIT_FILE_SIZE') err.message = 'That file is too large (5 MB maximum).';
  if (status >= 500) console.error(err);
  res.status(status).json({
    message: status >= 500 && env.isProd ? 'Something went wrong on our side.' : err.message,
    // A machine-readable reason (e.g. TIME_UP, NO_ATTEMPTS) so a screen can react to it. Only our own deliberate
    // errors carry one; database and library errors also have a `code`, and those must never be sent to a browser.
    ...(err instanceof HttpError && typeof err.code === 'string' && /^[A-Z_]+$/.test(err.code) ? { code: err.code } : {}),
  });
}

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

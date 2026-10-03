import { HttpError } from '../middleware/error.js';
import { deleteFile, findAccessible, readBytes, saveUpload } from '../services/files.service.js';

export async function upload(req, res) {
  const file = await saveUpload({ file: req.file, purpose: req.body?.purpose || 'general', user: req.user });
  res.status(201).json({ file });
}

export async function download(req, res) {
  const f = await findAccessible(req.params.id, req.user);
  if (!f) throw new HttpError(404, 'File not found.');
  // Release the database transaction before streaming bytes
  await req.tx.commit();
  const bytes = await readBytes(f);
  res.set({
    'Content-Type': f.mime,
    'Content-Length': bytes.length,
    'X-Content-Type-Options': 'nosniff',
    // Only PDF/PNG/JPEG are ever stored (checked by their bytes), and nosniff pins the type. Images are additionally
    // sandboxed. A PDF cannot be: Chrome refuses to show its built-in PDF viewer for a sandboxed response, which
    // would make "view on screen" impossible. frame-ancestors lets only our own pages embed a file in the viewer.
    'Content-Security-Policy': f.mime === 'application/pdf' ? "default-src 'none'; frame-ancestors 'self'" : "default-src 'none'; sandbox; frame-ancestors 'self'",
    'Cache-Control': 'private, no-store',
    'Content-Disposition': `${req.query.download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(f.original_name)}`,
  });
  res.end(bytes);
}

export async function remove(req, res) {
  const f = await findAccessible(req.params.id, req.user);
  if (!f) throw new HttpError(404, 'File not found.');
  await deleteFile(f);
  res.json({ success: true });
}

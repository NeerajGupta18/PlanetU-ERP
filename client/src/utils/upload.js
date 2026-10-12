import { api } from '../api/http.js';

export const MAX_UPLOAD_MB = 5;
/** Upload a PDF/PNG/JPEG and return the new file id. Throws an Error with a readable message. */
export async function uploadFile(file, purpose = 'document') {
  if (!file) return null;
  if (file.size > MAX_UPLOAD_MB * 1024 * 1024) throw new Error(`The file is larger than ${MAX_UPLOAD_MB} MB.`);
  const fd = new FormData();
  fd.set('purpose', purpose);
  fd.set('file', file);
  const r = await api.post('/files', fd);
  return r.file.id;
}

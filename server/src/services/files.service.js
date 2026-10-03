import crypto from 'node:crypto';
import { q } from '../db/pool.js';
import { HttpError } from '../middleware/error.js';
import * as storage from '../storage/index.js';

export const MAX_BYTES = 5 * 1024 * 1024;
export const PURPOSES = ['general', 'admission', 'profile', 'document'];

// Allowed types, identified by their leading bytes - the browser-declared type and the file
// extension are ignored because both are trivially forged.
const SIGNATURES = [
  { mime: 'application/pdf', ext: 'pdf', test: (b) => b.subarray(0, 5).toString('latin1') === '%PDF-' },
  { mime: 'image/png', ext: 'png', test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: 'image/jpeg', ext: 'jpg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
];

export const sniff = (buffer) => SIGNATURES.find((s) => s.test(buffer));

const cleanName = (name) => String(name || 'file').replace(/[\\/\u0000-\u001f]/g, '_').replace(/^\.+/, '').slice(0, 120) || 'file';

/** Validates and stores an uploaded file for the current tenant. Must run inside a tenant transaction. */
export async function saveUpload({ file, purpose, user }) {
  if (!file) throw new HttpError(400, 'Attach a file (form field "file").');
  if (!PURPOSES.includes(purpose)) throw new HttpError(400, `Purpose must be one of: ${PURPOSES.join(', ')}.`);
  const type = sniff(file.buffer);
  if (!type) throw new HttpError(415, 'Only PDF, PNG and JPEG files are accepted.');

  const { rows: [{ t }] } = await q("select current_setting('app.tenant_id') as t");
  const key = `${t}/${crypto.randomUUID()}`;
  await storage.put(key, file.buffer);
  try {
    const { rows: [row] } = await q(
      `insert into files (created_by, purpose, original_name, mime, size_bytes, sha256, storage_key)
       values ($1, $2, $3, $4, $5, $6, $7) returning id, purpose, original_name as name, mime, size_bytes as size, created_at as "createdAt"`,
      [user.id, purpose, cleanName(file.originalname), type.mime, file.size,
        crypto.createHash('sha256').update(file.buffer).digest('hex'), key],
    );
    return row;
  } catch (err) {
    await storage.remove(key); // no orphan bytes if the record couldn't be written
    throw err;
  }
}

/** A file is visible to admins of its institute and to the person who uploaded it - nobody else. */
export async function findAccessible(id, user) {
  const { rows: [f] } = await q(
    `select id, created_by, original_name, mime, size_bytes, storage_key from files where id = $1`, [id],
  );
  if (!f) return null;
  if (user.role === 'admin' || f.created_by === user.id) return f;
  // A faculty member can open the certificate a student attached to a learning assignment they created
  // or teach the subject of - and nothing else of the student's.
  if (user.role === 'employee' && user.employeeId) {
    const { rowCount } = await q(
      `select 1 from learning_enrollments e
         join learning_assignments a on a.id = e.assignment_id
       where e.evidence_file_id = $1
         and (a.created_by_employee = $2
              or exists (select 1 from timetable_slots s where s.employee_id = $2 and s.course_id = a.target_course_id and lower(s.subject) = lower(a.subject)))
       limit 1`,
      [id, user.employeeId],
    );
    if (rowCount) return f;
  }
  return null;
}

export const readBytes = (f) => storage.get(f.storage_key);
export const deleteFile = async (f) => {
  await q('delete from files where id = $1', [f.id]);
  await storage.remove(f.storage_key);
};

import { q } from './pool.js';

/** Append-only record of who did what. The app's DB role cannot update or delete these rows. */
export async function audit(user, action, entity = null, entityId = null, meta = {}) {
  await q(
    'insert into audit_log (actor_id, actor_role, action, entity, entity_id, meta) values ($1, $2, $3, $4, $5, $6)',
    [user?.id ?? null, user?.role ?? null, action, entity, entityId == null ? null : String(entityId), meta],
  );
}

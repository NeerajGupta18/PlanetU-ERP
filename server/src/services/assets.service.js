import { q } from '../db/pool.js';
import { HttpError } from '../middleware/error.js';
import { audit } from '../db/audit.js';
import { nextNumber } from '../db/series.js';

const STATUSES = ['available', 'in_use', 'maintenance', 'retired'];

const ASSET_SELECT = `
  select a.id, a.asset_tag as "assetTag", a.name, a.category, a.location, a.purchase_date as "purchaseDate",
         a.purchase_value as "purchaseValue", a.status, a.notes, a.created_at as "createdAt",
         a.department_id as "departmentId", d.name as department,
         a.assigned_to as "assignedTo", e.name as "assignedToName", e.emp_code as "assignedToCode"
  from assets a
  left join departments d on d.id = a.department_id
  left join employees e on e.id = a.assigned_to`;

export async function listAssets({ search, status, category, departmentId } = {}) {
  const where = []; const params = [];
  if (search) { params.push(`%${String(search).toLowerCase()}%`); where.push(`(lower(a.name) like $${params.length} or lower(a.asset_tag) like $${params.length})`); }
  if (status) { params.push(status); where.push(`a.status = $${params.length}`); }
  if (category) { params.push(category); where.push(`a.category = $${params.length}`); }
  if (departmentId) { params.push(departmentId); where.push(`a.department_id = $${params.length}`); }
  const { rows } = await q(`${ASSET_SELECT} ${where.length ? `where ${where.join(' and ')}` : ''} order by a.asset_tag`, params);
  return rows;
}

export async function getAsset(id) {
  const { rows: [a] } = await q(`${ASSET_SELECT} where a.id = $1`, [id]);
  if (!a) throw new HttpError(404, 'Asset not found.');
  const { rows: logs } = await q(
    `select l.id, l.action, l.note, l.cost, l.logged_at as "loggedAt", u.name as "loggedByName"
     from asset_logs l left join users u on u.id = l.logged_by where l.asset_id = $1 order by l.logged_at desc`,
    [id],
  );
  return { ...a, logs };
}

async function logAction(assetId, action, note, cost, admin) {
  await q('insert into asset_logs (asset_id, action, note, cost, logged_by) values ($1, $2, $3, $4, $5)',
    [assetId, action, note || '', cost ?? null, admin.id]);
}

export async function createAsset(body, admin) {
  const { name, category, departmentId, location, purchaseDate, purchaseValue, notes } = body || {};
  if (!name?.trim()) throw new HttpError(400, 'Name is required.');
  if (departmentId) {
    const { rowCount } = await q('select 1 from departments where id = $1', [departmentId]);
    if (!rowCount) throw new HttpError(400, 'Unknown department.');
  }
  const tag = await nextNumber('asset', { prefix: 'AST', padding: 5 });
  const { rows: [a] } = await q(
    `insert into assets (asset_tag, name, category, department_id, location, purchase_date, purchase_value, notes)
     values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
    [tag, name.trim(), (category || '').trim(), departmentId || null, (location || '').trim(), purchaseDate || null, purchaseValue ?? null, (notes || '').trim()],
  );
  await logAction(a.id, 'created', `Added to the register`, null, admin);
  return getAsset(a.id);
}

export async function updateAsset(id, body) {
  const cur = await getAsset(id);
  const { name, category, departmentId, location, purchaseDate, purchaseValue, notes } = body || {};
  if (departmentId !== undefined && departmentId) {
    const { rowCount } = await q('select 1 from departments where id = $1', [departmentId]);
    if (!rowCount) throw new HttpError(400, 'Unknown department.');
  }
  await q(
    `update assets set name = $1, category = $2, department_id = $3, location = $4, purchase_date = $5, purchase_value = $6, notes = $7 where id = $8`,
    [name?.trim() || cur.name, category ?? cur.category, departmentId !== undefined ? (departmentId || null) : cur.departmentId,
      location ?? cur.location, purchaseDate !== undefined ? (purchaseDate || null) : cur.purchaseDate,
      purchaseValue !== undefined ? purchaseValue : cur.purchaseValue, notes ?? cur.notes, id],
  );
  return getAsset(id);
}

export async function assign(id, employeeId, admin) {
  const cur = await getAsset(id);
  if (cur.status === 'retired') throw new HttpError(409, 'A retired asset cannot be assigned.');
  const { rowCount } = await q('select 1 from employees where id = $1', [employeeId]);
  if (!rowCount) throw new HttpError(404, 'Employee not found.');
  await q("update assets set assigned_to = $1, status = 'in_use' where id = $2", [employeeId, id]);
  await logAction(id, 'assigned', null, null, admin);
  return getAsset(id);
}

export async function unassign(id, admin) {
  const cur = await getAsset(id);
  if (!cur.assignedTo) throw new HttpError(409, 'This asset is not currently assigned to anyone.');
  await q("update assets set assigned_to = null, status = 'available' where id = $1", [id]);
  await logAction(id, 'unassigned', null, null, admin);
  return getAsset(id);
}

export async function setStatus(id, status, note, admin) {
  if (!STATUSES.includes(status)) throw new HttpError(400, `Status must be one of: ${STATUSES.join(', ')}.`);
  const cur = await getAsset(id);
  if (status === 'in_use' && !cur.assignedTo) throw new HttpError(400, 'Assign this asset to someone before marking it in use.');
  const clearAssignment = ['available', 'maintenance', 'retired'].includes(status);
  await q(`update assets set status = $1 ${clearAssignment ? ', assigned_to = null' : ''} where id = $2`, [status, id]);
  await logAction(id, 'status_change', note || `Marked ${status.replace('_', ' ')}`, null, admin);
  return getAsset(id);
}

export async function logMaintenance(id, note, cost, admin) {
  if (!note?.trim()) throw new HttpError(400, 'Describe the maintenance performed.');
  const { rowCount } = await q('select 1 from assets where id = $1', [id]);
  if (!rowCount) throw new HttpError(404, 'Asset not found.');
  await logAction(id, 'maintenance', note.trim(), cost ?? null, admin);
  return getAsset(id);
}

export async function deleteAsset(id) {
  const { rowCount } = await q('delete from assets where id = $1', [id]);
  if (!rowCount) throw new HttpError(404, 'Asset not found.');
}

import { q } from './pool.js';

/**
 * Atomically issues the next number in a per-tenant series and formats it,
 * e.g. nextNumber('employee', { prefix: 'EMP', padding: 3 }) -> "EMP007".
 * The same mechanism will produce PRNs, receipt numbers, library card numbers...
 * A tenant can change its prefix/padding by editing its number_series row.
 */
export async function nextNumber(key, defaults = {}) {
  const { rows: [r] } = await q(
    `insert into number_series (key, prefix, padding, next_value) values ($1, $2, $3, 2)
     on conflict (tenant_id, key) do update set next_value = number_series.next_value + 1
     returning prefix, padding, next_value - 1 as n`,
    [key, defaults.prefix ?? '', defaults.padding ?? 4],
  );
  return `${r.prefix}${String(r.n).padStart(r.padding, '0')}`;
}

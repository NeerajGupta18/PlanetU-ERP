import { EmptyState, Loader } from './Feedback.jsx';

/**
 * The one table every list uses, so all lists look and behave the same:
 *   <DataTable caption="Students" rows={students} rowKey="id"
 *     columns={[
 *       { key: 'name', label: 'Name', render: (s) => <strong>{s.name}</strong> },
 *       { key: 'due', label: 'Due', num: true, render: (s) => inr(s.due) },
 *       { key: 'actions', label: '', actions: true, render: (s) => <button ...>View</button> },
 *     ]}
 *     empty={{ title: 'No students yet', hint: 'Import them from a spreadsheet.', action: { label: 'Import students', to: '...' } }} />
 *
 * columns   key, label, render(row) (default row[key]), num (right-aligned figures), muted, actions (the buttons cell)
 * rows      the rows; null/undefined shows "Loading..."
 * empty     EmptyState props for no rows - say what fills the table and how (no empty boxes)
 * onRowClick  makes each row open something; the row is also reachable with the keyboard (Enter)
 * On a phone every row becomes a small card, each value with its column name. After four rows the table
 * scrolls (lib/autoScroll.js), like every other list.
 */
export default function DataTable({ columns, rows, rowKey = 'id', empty, onRowClick, caption, rowClassName }) {
  if (!rows) return <Loader />;
  if (rows.length === 0) return empty ? <EmptyState compact {...empty} /> : null;
  const keyOf = typeof rowKey === 'function' ? rowKey : (r) => r[rowKey];
  const cellClass = (c) => [c.num && 'num', c.muted && 'muted', c.actions && 'row-actions'].filter(Boolean).join(' ') || undefined;
  return (
    <div className="table-wrap">
      <table className="table table--stack">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr>{columns.map((c) => <th key={c.key} scope="col" className={c.num ? 'num' : undefined}>{c.actions && !c.label ? <span className="sr-only">Actions</span> : c.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={keyOf(r)}
              className={[onRowClick && 'is-clickable', rowClassName?.(r)].filter(Boolean).join(' ') || undefined}
              onClick={onRowClick ? (e) => { if (!e.target.closest('a, button, input, select, label')) onRowClick(r); } : undefined}
              onKeyDown={onRowClick ? (e) => { if (e.key === 'Enter' && e.target === e.currentTarget) onRowClick(r); } : undefined}
              tabIndex={onRowClick ? 0 : undefined}
            >
              {columns.map((c) => (
                <td key={c.key} className={cellClass(c)} data-label={c.label && !c.actions ? c.label : undefined}>
                  {c.render ? c.render(r) : (r[c.key] ?? '-')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

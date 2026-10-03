import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Download, FileSpreadsheet, FileText, FileType2, FileBarChart2 } from 'lucide-react';
import { useFetch } from '../../hooks/useFetch.js';
import { Card, PageBanner, StatCard } from '../../components/ui/Ui.jsx';
import { DataBoundary, EmptyState, ErrorState, Loader } from '../../components/ui/Feedback.jsx';
import { fmtDate } from '../../utils/dates.js';

const GROUPS = ['Students', 'People', 'Fees', 'Attendance', 'Learning', 'Exams'];
const money = (n) => Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function show(v, type) {
  if (v === null || v === undefined || v === '') return <span className="muted">-</span>;
  if (type === 'date') return fmtDate(String(v).slice(0, 10));
  if (type === 'money') return money(v);
  if (type === 'percent' || type === 'number') return typeof v === 'number' ? String(+v.toFixed(2)) : v;
  return String(v);
}

export default function Reports() {
  const [sp, setSp] = useSearchParams();
  const catalogue = useFetch('/admin/reports');
  const reports = catalogue.data?.reports || [];
  const key = sp.get('report') || '';
  const def = reports.find((r) => r.key === key) || null;

  // The URL holds the report and its filters, so a configured report can be bookmarked, shared or linked to
  const values = useMemo(() => Object.fromEntries((def?.params || []).map((p) => [p.key, sp.get(p.key) || ''])), [def, sp]);
  const setValue = (k, v) => setSp((cur) => {
    const next = new URLSearchParams(cur);
    if (v === '' || v === false) next.delete(k); else next.set(k, v === true ? 'true' : v);
    return next;
  }, { replace: true });
  const choose = (k) => setSp(k ? { report: k } : {});

  const needed = (def?.params || []).filter((p) => p.required && !values[p.key]);
  const query = useMemo(() => {
    const q = new URLSearchParams();
    Object.entries(values).forEach(([k, v]) => { if (v) q.set(k, v); });
    return q.toString();
  }, [values]);

  return (
    <>
      <PageBanner icon={FileBarChart2} title="Reports & exports" subtitle="Preview a report, then download it as Excel, PDF or CSV" />
      <DataBoundary loading={catalogue.loading} error={catalogue.error} data={catalogue.data} reload={catalogue.reload}>
        <div className="grid-2" style={{ gridTemplateColumns: 'minmax(240px, 300px) minmax(0, 1fr)', alignItems: 'start' }}>
          <Card title="Reports">
            {GROUPS.map((g) => {
              const items = reports.filter((r) => r.group === g);
              if (!items.length) return null;
              return (
                <div key={g} style={{ marginBottom: 12 }}>
                  <div className="muted" style={{ fontSize: 11.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 4 }}>{g}</div>
                  {items.map((r) => (
                    <button
                      key={r.key} type="button" onClick={() => choose(r.key)} aria-current={r.key === key}
                      className={`report-pick ${r.key === key ? 'is-active' : ''}`}
                    >{r.title}</button>
                  ))}
                </div>
              );
            })}
          </Card>

          {!def ? (
            <Card><EmptyState title="Choose a report" hint="Pick one on the left. You can narrow it with filters before downloading." /></Card>
          ) : (
            <ReportView key={def.key} def={def} values={values} setValue={setValue} query={query} needed={needed} />
          )}
        </div>
      </DataBoundary>
    </>
  );
}

function ParamInput({ p, value, setValue, courses, exams }) {
  const id = `rp-${p.key}`;
  const common = { id, className: 'input', value, style: { width: '100%' } };
  switch (p.type) {
    case 'course':
      return (<select {...common} onChange={(e) => setValue(p.key, e.target.value)}><option value="">All</option>{courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>);
    case 'exam':
      return (<select {...common} onChange={(e) => setValue(p.key, e.target.value)}><option value="">Choose an exam...</option>{exams.map((x) => <option key={x.id} value={x.id}>{x.name} · {x.course} · sem {x.semester}</option>)}</select>);
    case 'enum':
      return (<select {...common} onChange={(e) => setValue(p.key, e.target.value)}><option value="">All</option>{p.options.map((o) => <option key={o} value={o}>{p.labels?.[o] || o}</option>)}</select>);
    case 'date':
      return <input {...common} type="date" onChange={(e) => setValue(p.key, e.target.value)} />;
    case 'int': case 'percent':
      return <input {...common} type="number" min={p.min ?? 0} max={p.max ?? 100} onChange={(e) => setValue(p.key, e.target.value)} />;
    case 'bool':
      return (<label style={{ display: 'flex', gap: 8, alignItems: 'center', paddingTop: 8 }}><input type="checkbox" checked={value === 'true'} onChange={(e) => setValue(p.key, e.target.checked)} /> Yes</label>);
    default:
      return <input {...common} type="text" onChange={(e) => setValue(p.key, e.target.value)} />;
  }
}

function ReportView({ def, values, setValue, query, needed }) {
  const timetable = useFetch(def.params.some((p) => p.type === 'course') ? '/admin/timetable/filters' : null);
  const examList = useFetch(def.params.some((p) => p.type === 'exam') ? '/admin/exams' : null);
  const courses = timetable.data?.courses || [];
  const exams = examList.data?.exams || [];

  const ready = needed.length === 0;
  const [debounced, setDebounced] = useState(query);
  useEffect(() => { const t = setTimeout(() => setDebounced(query), 250); return () => clearTimeout(t); }, [query]);
  const data = useFetch(ready ? `/admin/reports/${def.key}?format=json${debounced ? `&${debounced}` : ''}` : null);
  const d = data.data;

  const link = (format) => `/api/admin/reports/${def.key}?format=${format}${query ? `&${query}` : ''}`;
  const disabled = !ready || !d || d.total === 0;
  const btn = (format, Icon, label) => (
    <a
      className={`btn btn--outline btn--sm ${disabled ? 'is-disabled' : ''}`} href={disabled ? undefined : link(format)} download={format !== 'pdf' ? '' : undefined}
      aria-disabled={disabled} onClick={(e) => { if (disabled) e.preventDefault(); }}
    ><Icon size={14} /> {label}</a>
  );

  return (
    <div style={{ display: 'grid', gap: 18, minWidth: 0 }}>
      <Card
        title={def.title}
        action={(
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {btn('xlsx', FileSpreadsheet, 'Excel')}
            {btn('pdf', FileText, 'PDF')}
            {btn('csv', FileType2, 'CSV')}
          </div>
        )}
      >
        <p className="muted" style={{ marginTop: 0 }}>{def.description}</p>
        {def.params.length > 0 && (
          <div className="filters__grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
            {def.params.map((p) => (
              <div key={p.key} className="form-field">
                <label className="label" htmlFor={`rp-${p.key}`} style={{ marginTop: 0 }}>{p.label}{p.required ? ' *' : ''}</label>
                <ParamInput p={p} value={values[p.key] || ''} setValue={setValue} courses={courses} exams={exams} />
              </div>
            ))}
          </div>
        )}
      </Card>

      {!ready ? (
        <Card><EmptyState title={`Choose ${needed.map((p) => p.label.toLowerCase()).join(' and ')}`} hint="This report needs it before it can be shown." /></Card>
      ) : data.error && !d ? (
        <Card><ErrorState error={data.error} onRetry={data.reload} /></Card>
      ) : !d ? (
        <Card><Loader /></Card>
      ) : (
        <>
          {d.summary.length > 0 && (
            <div className="stats" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
              {d.summary.slice(0, 8).map(([k, v], i) => <StatCard key={k} value={v} label={k} tone={['indigo', 'green', 'amber', 'rose'][i % 4]} />)}
            </div>
          )}
          <Card title={`Preview${d.total ? ` · ${d.total} row${d.total === 1 ? '' : 's'}` : ''}`}>
            {d.total === 0 ? (
              <EmptyState title="No records match these filters" hint="Widen the dates or clear a filter." />
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead><tr>{d.columns.map((c) => <th key={c.key} style={['int', 'number', 'money', 'percent'].includes(c.type) ? { textAlign: 'right' } : undefined}>{c.header}</th>)}</tr></thead>
                  <tbody>
                    {d.rows.map((r, i) => (
                      <tr key={i}>
                        {d.columns.map((c) => (
                          <td key={c.key} style={['int', 'number', 'money', 'percent'].includes(c.type) ? { textAlign: 'right', whiteSpace: 'nowrap' } : { whiteSpace: 'nowrap' }}>{show(r[c.key], c.type)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {d.truncated && <p className="note"><Download size={12} style={{ verticalAlign: '-2px' }} /> Showing the first {d.rows.length} of {d.total} rows. The downloads contain all {d.total}.</p>}
            {d.columns.some((c) => c.pdf === false) && <p className="note">The PDF leaves out {d.columns.filter((c) => c.pdf === false).length} wide columns to fit the page; Excel and CSV have every column.</p>}
          </Card>
        </>
      )}
    </div>
  );
}

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { EmptyState } from '../ui/Feedback.jsx';

/**
 * The dashboards' small charts, drawn as plain SVG or HTML so they add almost nothing to the download. Each one has an
 * aria-label and a hidden table with the same numbers, uses the institute's colour (--brand) and says something
 * useful when there is too little data. Text stays in the text colours. Status colours only ever mean status.
 * The line chart over time is LineChart in components/ui/Charts.jsx.
 */

function HiddenTable({ caption, head, rows }) {
  return (
    <div className="sr-only">
      <table>
        <caption>{caption}</caption>
        {head && <thead><tr>{head.map((h) => <th key={h} scope="col">{h}</th>)}</tr></thead>}
        <tbody>{rows.map((r) => <tr key={r[0]}><th scope="row">{r[0]}</th>{r.slice(1).map((c, i) => <td key={i}>{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

/** A tiny line for a KPI card. Needs at least two real points, otherwise it draws nothing rather than a flat guess. */
export function Sparkline({ values, label, width = 72, height = 26 }) {
  const real = (values || []).filter((v) => v !== null && v !== undefined);
  if (real.length < 2) return null;
  const lo = Math.min(...real); const hi = Math.max(...real); const span = hi - lo || 1;
  const x = (i) => (i / (values.length - 1)) * (width - 4) + 2;
  const y = (v) => height - 3 - ((v - lo) / span) * (height - 6);
  const runs = []; let cur = [];
  values.forEach((v, i) => {
    if (v === null || v === undefined) { if (cur.length) runs.push(cur); cur = []; } else cur.push(`${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  });
  if (cur.length) runs.push(cur);
  const lastAt = values.reduce((at, v, i) => (v === null || v === undefined ? at : i), 0);
  return (
    <>
      <svg className="spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
        {runs.map((r) => (r.length > 1 ? <polyline key={r[0]} points={r.join(' ')} className="spark__line" /> : <circle key={r[0]} cx={r[0].split(',')[0]} cy={r[0].split(',')[1]} r="1.5" className="spark__dot" />))}
        <circle cx={x(lastAt)} cy={y(values[lastAt])} r="2.5" className="spark__dot" />
      </svg>
      <HiddenTable caption={label} rows={values.map((v, i) => [`Point ${i + 1}`, v ?? 'No data'])} />
    </>
  );
}

/** A percentage or score as a ring, with the figure in the middle. */
export function Ring({ value, max = 100, label, size = 96, text, tone = 'brand' }) {
  const has = value !== null && value !== undefined;
  const stroke = Math.max(6, Math.round(size / 11));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const share = has ? Math.max(0, Math.min(1, value / max)) : 0;
  return (
    <div className="ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${label}: ${has ? (text || value) : 'no data yet'}`}>
        <circle cx={size / 2} cy={size / 2} r={r} className="ring__track" strokeWidth={stroke} />
        {has && <circle cx={size / 2} cy={size / 2} r={r} className={`ring__value ring__value--${tone}`} strokeWidth={stroke} strokeDasharray={`${share * c} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />}
      </svg>
      <div className="ring__text" aria-hidden="true">{has ? (text || value) : '-'}</div>
    </div>
  );
}

/** Two bars per period (collected next to billed), with a legend and a tooltip on hover or tap. */
export function PairedBars({ data, series, format, axisFormat, caption, height = 200 }) {
  const [hover, setHover] = useState(null);
  const W = 640; const pad = { t: 10, r: 6, b: 24, l: 54 };
  const max = Math.max(1, ...data.flatMap((d) => series.map((s) => d[s.key] || 0)));
  const pow = 10 ** Math.floor(Math.log10(max));
  const top = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((v) => v >= max) || max;
  const plot = height - pad.t - pad.b;
  const band = (W - pad.l - pad.r) / Math.max(1, data.length);
  const barW = Math.min(26, band / 3);
  const y = (v) => pad.t + plot - (v / top) * plot;
  return (
    <div className="chart" onMouseLeave={() => setHover(null)}>
      <div className="dash-legend">{series.map((s) => <span key={s.key}><i className={`dash-swatch dash-swatch--${s.tone}`} aria-hidden="true" />{s.label}</span>)}</div>
      <svg viewBox={`0 0 ${W} ${height}`} width="100%" role="img" aria-label={caption}>
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={pad.l} x2={W - pad.r} y1={y(top * f)} y2={y(top * f)} className={f === 0 ? 'chart__base' : 'chart__grid'} />
            <text x={pad.l - 8} y={y(top * f)} className="chart__axis" textAnchor="end" dominantBaseline="middle">{axisFormat(top * f)}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const cx = pad.l + band * i + band / 2;
          return (
            <g key={d.label}>
              {series.map((s, k) => {
                const v = d[s.key] || 0; const h = Math.max(v > 0 ? 2 : 0, (v / top) * plot);
                return h > 0 && <rect key={s.key} x={cx + (k - series.length / 2) * (barW + 2) + 1} y={pad.t + plot - h} width={barW} height={h} rx="3" className={`dash-bar dash-bar--${s.tone} ${hover !== null && hover !== i ? 'is-dim' : ''}`} />;
              })}
              <text x={cx} y={height - 7} className="chart__axis" textAnchor="middle">{d.label}</text>
              <rect x={cx - band / 2} y={pad.t} width={band} height={plot} fill="transparent" onMouseEnter={() => setHover(i)} onClick={() => setHover(i)} />
            </g>
          );
        })}
      </svg>
      {hover !== null && (
        <div className="dash-tip" role="status">
          <strong>{data[hover].full || data[hover].label}</strong>
          {series.map((s) => <span key={s.key}>{s.label}: {format(data[hover][s.key] || 0)}</span>)}
        </div>
      )}
      <HiddenTable caption={caption} head={['Period', ...series.map((s) => s.label)]} rows={data.map((d) => [d.full || d.label, ...series.map((s) => format(d[s.key] || 0))])} />
    </div>
  );
}

/** One bar split into parts that add up to a whole, named below with their values. */
export function StackedBar({ parts, format, caption, empty }) {
  const total = parts.reduce((a, p) => a + (p.value || 0), 0);
  if (!total) return <EmptyState compact {...empty} />;
  return (
    <div>
      <div className="dash-stack" role="img" aria-label={`${caption}: ${parts.map((p) => `${p.label} ${format(p.value)}`).join(', ')}`}>
        {parts.filter((p) => p.value > 0).map((p) => <span key={p.label} className={`dash-stack__part dash-swatch--${p.tone}`} style={{ flexGrow: p.value }} title={`${p.label}: ${format(p.value)}`} />)}
      </div>
      <ul className="dash-stack__key">
        {parts.map((p) => <li key={p.label}><i className={`dash-swatch dash-swatch--${p.tone}`} aria-hidden="true" /><span>{p.label}</span><strong>{format(p.value)}</strong></li>)}
      </ul>
    </div>
  );
}

const shade = (v) => (v === null || v === undefined ? null : Math.round(6 + (Math.max(0, Math.min(100, v)) / 100) * 54));

/**
 * Rows against measures, each cell tinted from pale to the institute's colour. The figure is always written in the
 * cell, and text stays dark because the tint never goes past 60%. Clicking a row drills into it: `rows` with their
 * own `rows` open in place, and rows with `to` go to that page.
 */
export function Heatmap({ rows, columns, caption, title, empty }) {
  const [open, setOpen] = useState(null);
  if (!rows.length) return <EmptyState compact {...empty} />;
  const single = rows.length === 1 && rows[0].rows?.length;
  const current = single ? rows[0] : rows.find((r) => r.key === open);
  const shown = current ? current.rows : rows;
  return (
    <div className="heat">
      {current && (
        <div className="heat__crumb">
          {!single && <button type="button" className="btn btn--outline btn--sm" onClick={() => setOpen(null)}><ChevronLeft size={14} aria-hidden="true" /> All</button>}
          <strong>{current.name}</strong>
        </div>
      )}
      <table className="heat__table">
        <caption className="sr-only">{caption}</caption>
        <thead><tr><th scope="col">{current ? current.childTitle : title}</th>{columns.map((c) => <th scope="col" key={c.key} title={c.meaning}>{c.label}</th>)}</tr></thead>
        <tbody>
          {shown.map((r) => (
            <tr key={r.key}>
              <th scope="row">
                {r.rows?.length ? <button type="button" className="heat__open" onClick={() => setOpen(r.key)}>{r.name}</button>
                  : r.to ? <Link className="heat__open" to={r.to}>{r.name}</Link> : r.name}
              </th>
              {columns.map((c) => {
                const v = r[c.key]; const s = shade(v); const low = v !== null && v !== undefined && c.low !== undefined && v < c.low;
                return (
                  <td key={c.key} className={`heat__cell ${low ? 'is-low' : ''}`} style={s === null ? undefined : { background: `color-mix(in srgb, var(--brand) ${s}%, white)` }}>
                    {v === null || v === undefined ? <span className="muted">No data</span> : <>{v}%{low && <small> low</small>}</>}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Stages in order, each bar as wide as its count, so a drop between two stages is plain to see. */
export function Funnel({ stages, caption, empty, to }) {
  const max = Math.max(0, ...stages.map((s) => s.count));
  if (!max) return <EmptyState compact {...empty} />;
  return (
    <div className="funnel">
      <ol aria-label={caption}>
        {stages.map((s) => (
          <li key={s.stage}>
            <span className="funnel__label">{s.label}</span>
            <span className="funnel__track"><span className="funnel__bar" style={{ width: `${s.count ? Math.max(4, (s.count / max) * 100) : 0}%` }} /></span>
            <strong className="funnel__n">{s.count}</strong>
          </li>
        ))}
      </ol>
      {to && <Link className="chart-note" to={to}>Open the admissions board</Link>}
    </div>
  );
}

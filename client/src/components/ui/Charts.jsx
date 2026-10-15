import { useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * Two small single-series charts for the dashboards: bars for amounts per period, a line for a percentage over
 * time. One hue (PlanetU purple), thin marks, light gridlines, a tooltip on hover or tap, and a hidden table so a
 * screen reader gets the same numbers. Text stays in the text colours; the series colour is only on the marks.
 */

function useWidth() {
  const ref = useRef(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    if (ref.current) setWidth(ref.current.clientWidth);
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

/** Round "nice" axis steps: 1, 2, 2.5 or 5 times a power of ten. */
function niceTicks(max, count = 4) {
  if (!(max > 0)) return [0, 1];
  const raw = max / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw);
  const ticks = [];
  for (let v = 0; v <= max + step * 0.001; v += step) ticks.push(v);
  if (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step);
  return ticks;
}

const PAD = { top: 12, right: 8, bottom: 26, left: 52 };

function Tooltip({ tip }) {
  if (!tip) return null;
  return (
    <div className="chart__tip" style={{ left: tip.x, top: tip.y }} role="status">
      <strong>{tip.value}</strong>
      <span>{tip.label}</span>
    </div>
  );
}

function DataTable({ caption, rows, format }) {
  return (
    <table className="sr-only">
      <caption>{caption}</caption>
      <tbody>{rows.map((r) => <tr key={r.label}><th scope="row">{r.full || r.label}</th><td>{r.value === null ? 'No data' : format(r.value)}</td></tr>)}</tbody>
    </table>
  );
}

/** Vertical bars, one per period. `data`: [{ label, full?, value, note? }]. */
export function BarChart({ data, format = String, axisFormat = format, height = 200, caption }) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState(null);
  const max = Math.max(0, ...data.map((d) => d.value || 0));
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1] || 1;
  const w = Math.max(0, width - PAD.left - PAD.right);
  const h = height - PAD.top - PAD.bottom;
  const band = data.length ? w / data.length : 0;
  const barW = Math.min(24, Math.max(6, band * 0.5));
  const every = Math.max(1, Math.ceil(34 / (band || 34)));
  const y = (v) => PAD.top + h - (v / top) * h;

  return (
    <div className="chart" ref={ref} onMouseLeave={() => setHover(null)}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={caption}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} className={t === 0 ? 'chart__base' : 'chart__grid'} />
              <text x={PAD.left - 8} y={y(t)} className="chart__axis" textAnchor="end" dominantBaseline="middle">{axisFormat(t)}</text>
            </g>
          ))}
          {data.map((d, i) => {
            const cx = PAD.left + band * i + band / 2;
            const v = d.value || 0;
            const bh = Math.max(v > 0 ? 2 : 0, (v / top) * h);
            const x0 = cx - barW / 2; const yTop = PAD.top + h - bh; const r = Math.min(4, bh, barW / 2);
            const path = `M${x0},${PAD.top + h} V${yTop + r} Q${x0},${yTop} ${x0 + r},${yTop} H${x0 + barW - r} Q${x0 + barW},${yTop} ${x0 + barW},${yTop + r} V${PAD.top + h} Z`;
            const show = () => setHover({ i, x: cx, y: yTop, value: format(v), label: `${d.full || d.label}${d.note ? ` (${d.note})` : ''}` });
            return (
              <g key={d.label}>
                {bh > 0 && <path d={path} className={`chart__bar ${hover && hover.i !== i ? 'is-dim' : ''}`} />}
                {(data.length - 1 - i) % every === 0 && <text x={cx} y={height - 8} className="chart__axis" textAnchor="middle">{d.label}</text>}
                {/* The hit area is the whole column, wider and taller than the bar */}
                <rect x={cx - band / 2} y={PAD.top} width={band} height={h} fill="transparent" onMouseEnter={show} onClick={show} />
              </g>
            );
          })}
        </svg>
      )}
      <Tooltip tip={hover} />
      <DataTable caption={caption} rows={data} format={format} />
    </div>
  );
}

/**
 * A line over time with a dot on each point. `data`: [{ label, full?, value | null }] (null leaves a gap).
 * `target` draws a labelled reference line (for example the 75% attendance minimum).
 */
export function LineChart({ data, format = String, height = 200, caption, min = null, max = null, target = null, targetLabel = '' }) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState(null);
  const vals = data.map((d) => d.value).filter((v) => v !== null && v !== undefined);
  const lo = min ?? Math.min(...vals, target ?? Infinity);
  const hi = max ?? Math.max(...vals, target ?? -Infinity);
  const span = hi - lo || 1;
  const w = Math.max(0, width - PAD.left - PAD.right);
  const h = height - PAD.top - PAD.bottom;
  const step = data.length > 1 ? w / (data.length - 1) : 0;
  const x = (i) => PAD.left + (data.length > 1 ? step * i : w / 2);
  const y = (v) => PAD.top + h - ((v - lo) / span) * h;
  const ticks = [0, 1, 2, 3, 4].map((k) => lo + (span * k) / 4);
  // On a narrow screen label every second (or third) point, counting back from the latest
  const every = Math.max(1, Math.ceil(62 / (step || 62)));

  // Split into runs so a week with no data leaves a gap instead of a misleading straight line
  const runs = [];
  let cur = [];
  data.forEach((d, i) => {
    if (d.value === null || d.value === undefined) { if (cur.length) runs.push(cur); cur = []; } else cur.push([x(i), y(d.value)]);
  });
  if (cur.length) runs.push(cur);

  const nearest = (evt) => {
    const rect = evt.currentTarget.getBoundingClientRect();
    const px = (evt.touches?.[0]?.clientX ?? evt.clientX) - rect.left;
    const i = Math.max(0, Math.min(data.length - 1, Math.round((px - PAD.left) / (step || 1))));
    const d = data[i];
    setHover({ i, x: x(i), y: d.value === null ? PAD.top + h / 2 : y(d.value), value: d.value === null ? 'Nothing marked' : format(d.value), label: d.full || d.label });
  };

  return (
    <div className="chart" ref={ref} onMouseLeave={() => setHover(null)}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={caption}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} className={t === lo ? 'chart__base' : 'chart__grid'} />
              <text x={PAD.left - 8} y={y(t)} className="chart__axis" textAnchor="end" dominantBaseline="middle">{format(Math.round(t))}</text>
            </g>
          ))}
          {target !== null && (
            <g>
              <line x1={PAD.left} x2={width - PAD.right} y1={y(target)} y2={y(target)} className="chart__target" />
              <text x={width - PAD.right} y={y(target) - 5} className="chart__axis chart__axis--strong" textAnchor="end">{targetLabel}</text>
            </g>
          )}
          {data.map((d, i) => ((data.length - 1 - i) % every === 0 ? <text key={d.label} x={x(i)} y={height - 8} className="chart__axis" textAnchor={i === 0 ? 'start' : i === data.length - 1 ? 'end' : 'middle'}>{d.label}</text> : null))}
          {hover && <line x1={hover.x} x2={hover.x} y1={PAD.top} y2={PAD.top + h} className="chart__cross" />}
          {runs.map((r) => <polyline key={r[0].join()} points={r.map((p) => p.join(',')).join(' ')} className="chart__line" />)}
          {data.map((d, i) => (d.value === null || d.value === undefined ? null : (
            <circle key={d.label} cx={x(i)} cy={y(d.value)} r={hover?.i === i ? 5.5 : 4} className="chart__dot" />
          )))}
          <rect x={PAD.left - step / 2} y={PAD.top} width={w + step} height={h} fill="transparent" onMouseMove={nearest} onClick={nearest} onTouchStart={nearest} />
        </svg>
      )}
      <Tooltip tip={hover} />
      <DataTable caption={caption} rows={data} format={format} />
    </div>
  );
}

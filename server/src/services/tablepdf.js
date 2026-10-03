/**
 * Renders any report (columns + rows) as an A4 PDF table: letterhead, title, filters, summary figures,
 * a header row repeated on every page, zebra rows, right-aligned numbers, and "Page x of y" footers.
 * Landscape is chosen automatically for wide reports. Same pdfkit approach as receipts, ID cards and report cards.
 */
import PDFDocument from 'pdfkit';
import { fmtDate } from '../utils/pdfDate.js';
import { fit } from '../utils/pdfText.js';

const BRAND = '#4338ca';
const INK = '#111827';
const MUTED = '#6b7280';
const LINE = '#d1d5db';
const M = 32;
const ROW = 18;

export const PDF_MAX_ROWS = 4000;

const NUMERIC = new Set(['int', 'number', 'money', 'percent']);

export function formatCell(value, type) {
  if (value === null || value === undefined || value === '') return '-';
  if (type === 'date') return /^\d{4}-\d{2}-\d{2}/.test(value) ? fmtDate(String(value).slice(0, 10)) : String(value);
  if (typeof value === 'number') {
    if (type === 'money') return value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (type === 'number' || type === 'percent') return String(+value.toFixed(2));
    return value.toLocaleString('en-IN');
  }
  return String(value);
}

const cellValue = (r, c, i) => (Array.isArray(r) ? r[i] : r[c.key]);
const PAD = 10; // 4pt left + 6pt right inside every cell
const MIN_KEEP = 44; // a column is never squeezed below this (or its natural width, if smaller)

/**
 * Column widths from the real text: each column needs its widest value (or, for the header, its longest word,
 * since headers wrap onto two lines). If everything fits, the spare space is shared out; if not, the widest
 * columns give way first, so short ones like IDs and numbers stay fully readable.
 */
function layout(doc, columns, rows, usable) {
  const sample = rows.slice(0, 300);
  const need = columns.map((c, i) => {
    doc.font('Helvetica').fontSize(8.5);
    let w = 0;
    for (const r of sample) w = Math.max(w, doc.widthOfString(formatCell(cellValue(r, c, i), c.type)));
    doc.font('Helvetica-Bold').fontSize(8.5);
    const words = String(c.header).split(/\s+/);
    const head = Math.max(...words.map((x) => doc.widthOfString(x)), doc.widthOfString(String(c.header)) / 2);
    return Math.max(w, head) + PAD;
  });
  const total = need.reduce((a, b) => a + b, 0);
  if (total <= usable) {
    const extra = (usable - total) / columns.length;
    return need.map((w) => w + extra);
  }
  const floor = need.map((w) => Math.min(w, MIN_KEEP));
  const room = usable - floor.reduce((a, b) => a + b, 0);
  if (room <= 0) return columns.map(() => usable / columns.length);
  const give = need.map((w, i) => w - floor[i]);
  const k = Math.min(1, room / give.reduce((a, b) => a + b, 0));
  return floor.map((f, i) => f + give[i] * k);
}

/** Greedy word wrap into at most `max` lines; the last line is shortened with an ellipsis if it still overflows. */
function wrap(doc, text, width, max = 3) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = []; let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (doc.widthOfString(next) <= width || !cur) cur = next;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  if (lines.length > max) { const rest = lines.slice(max - 1).join(' '); lines.length = max - 1; lines.push(rest); }
  return lines.map((l, i) => (i === lines.length - 1 ? fit(doc, l, width) : l));
}

export function streamTablePdf(res, { institute, title, subtitle, note, filters = [], summary = [], columns, rows, generatedBy, filename }) {
  res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${filename}"`, 'Cache-Control': 'private, no-store' });
  const landscape = columns.length > 6 || columns.reduce((a, c) => a + (c.width || 14), 0) > 90;
  const doc = new PDFDocument({ size: 'A4', layout: landscape ? 'landscape' : 'portrait', margin: M, bufferPages: true, info: { Title: title, Author: institute.name } });
  doc.pipe(res);

  const pageW = doc.page.width; const pageH = doc.page.height;
  const usable = pageW - M * 2;
  const widths = layout(doc, columns, rows, usable);
  const bottom = pageH - M - 18; // keep clear of the footer
  const generated = fmtDate(new Date());

  // Headers wrap onto up to three lines; the band is as tall as the tallest header needs
  doc.font('Helvetica-Bold').fontSize(8.5);
  const headLines = columns.map((c, i) => wrap(doc, c.header, widths[i] - PAD, 3));
  const maxLines = Math.max(...headLines.map((l) => l.length), 1);
  const HEAD = 14 + maxLines * 10.5;

  const header = (y) => {
    doc.rect(M, y, usable, HEAD).fill(BRAND);
    let x = M;
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#ffffff');
    columns.forEach((c, i) => {
      const right = NUMERIC.has(c.type);
      const lines = headLines[i];
      const top = y + (HEAD - lines.length * 10.5) / 2; // vertically centred
      lines.forEach((l, li) => doc.text(l, x + 4, top + li * 10.5, { width: widths[i] - PAD + 2, align: right ? 'right' : 'left', lineBreak: false }));
      x += widths[i];
    });
    return y + HEAD;
  };

  /* ---- first page: letterhead, title, filters, summary ---- */
  doc.rect(M, M - 6, usable, 3).fill(BRAND);
  doc.font('Helvetica-Bold').fontSize(15).fillColor(BRAND).text(institute.name, M, M + 4, { width: usable });
  if (institute.address) doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text(institute.address, M, doc.y, { width: usable });
  doc.moveDown(0.6);
  doc.font('Helvetica-Bold').fontSize(13).fillColor(INK).text(title, M, doc.y, { width: usable });
  const meta = [subtitle, ...filters.filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k, v]) => `${k}: ${v}`)].filter(Boolean);
  if (meta.length) doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(meta.join('   |   '), M, doc.y + 1, { width: usable });
  doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text(`Generated ${generated}${generatedBy ? ` by ${generatedBy}` : ''}`, M, doc.y + 1, { width: usable });
  if (note) doc.font('Helvetica-Oblique').fontSize(8.5).fillColor(MUTED).text(note, M, doc.y + 1, { width: usable });

  let y = doc.y + 10;
  if (summary.length) {
    const per = Math.min(summary.length, landscape ? 5 : 4);
    const bw = (usable - (per - 1) * 8) / per;
    summary.forEach(([k, v], i) => {
      const col = i % per; const rowIdx = Math.floor(i / per);
      const bx = M + col * (bw + 8); const by = y + rowIdx * 40;
      doc.roundedRect(bx, by, bw, 34, 5).fillAndStroke('#f5f6ff', LINE);
      doc.font('Helvetica').fontSize(7.5).fillColor(MUTED).text(fit(doc, k, bw - 10), bx + 6, by + 6, { width: bw - 8, lineBreak: false });
      doc.font('Helvetica-Bold').fontSize(11).fillColor(BRAND).text(fit(doc, String(v), bw - 10), bx + 6, by + 18, { width: bw - 8, lineBreak: false });
    });
    y += Math.ceil(summary.length / per) * 40 + 4;
  }

  /* ---- table ---- */
  y = header(y);
  if (!rows.length) {
    doc.font('Helvetica').fontSize(10).fillColor(MUTED).text('No records match these filters.', M, y + 12, { width: usable, align: 'center' });
  }
  rows.forEach((row, ri) => {
    if (y + ROW > bottom) { doc.addPage(); y = header(M); }
    if (ri % 2) doc.rect(M, y, usable, ROW).fill('#f8f9ff');
    let x = M;
    columns.forEach((c, i) => {
      doc.font('Helvetica').fontSize(8.5).fillColor(INK);
      doc.text(fit(doc, formatCell(cellValue(row, c, i), c.type), widths[i] - PAD), x + 4, y + 5, { width: widths[i] - PAD + 2, align: NUMERIC.has(c.type) ? 'right' : 'left', lineBreak: false });
      x += widths[i];
    });
    y += ROW;
  });
  doc.moveTo(M, y).lineTo(M + usable, y).strokeColor(LINE).lineWidth(0.5).stroke();

  /* ---- footers (needs every page to exist, hence bufferPages) ---- */
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i += 1) {
    doc.switchToPage(range.start + i);
    doc.page.margins.bottom = 0; // otherwise writing near the bottom edge would add a blank page
    doc.font('Helvetica').fontSize(8).fillColor('#9ca3af');
    doc.text(`${institute.name}  |  ${title}`, M, pageH - M + 2, { width: usable - 90, align: 'left', lineBreak: false });
    doc.text(`Page ${i + 1} of ${range.count}`, pageW - M - 90, pageH - M + 2, { width: 90, align: 'right', lineBreak: false });
  }
  doc.end();
}

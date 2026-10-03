/**
 * Writes real .xlsx workbooks (Office Open XML) with no third-party library.
 *
 *   buildXlsx([{ name, columns: [{ header, key, type, width }], rows: [{ key: value }] }]) -> Buffer
 *
 * Column types set the number format and alignment: text | int | number | money | percent | date.
 * Strings are always written as literal text (never as formulas), so a cell like "=SUM(A1)" stays text.
 * The header row is bold on a coloured fill, frozen, and has an auto-filter. Columns get sensible widths.
 */
import { createZip } from './zip.js';

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

// Characters XML 1.0 forbids would make Excel call the file corrupt, so drop them
// eslint-disable-next-line no-control-regex
const ILLEGAL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g;
export const esc = (s) => String(s).replace(ILLEGAL, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** 0 -> A, 25 -> Z, 26 -> AA */
export function colName(i) {
  let n = i + 1; let s = '';
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

/** Excel stores dates as days since 1899-12-30. */
export function excelSerial(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso));
  if (!m) return null;
  return Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000 + 25569;
}

// cellXfs indexes in styles.xml below
const STYLE = { default: 0, header: 1, date: 2, money: 3, number: 4, int: 5, label: 6, wrap: 7 };
const TYPE_STYLE = { text: STYLE.default, int: STYLE.int, number: STYLE.number, money: STYLE.money, percent: STYLE.number, date: STYLE.date };
const DEFAULT_WIDTH = { text: 20, int: 10, number: 12, money: 14, percent: 11, date: 13 };

const STYLES_XML = `${XML_HEAD}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd"/></numFmts>
<fonts count="3">
<font><sz val="11"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font>
</fonts>
<fills count="3">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF4338CA"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="8">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="left"/></xf>
<xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="2" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

/** Worksheet names: 1-31 chars, none of  [ ] : * ? / \  , and unique within the workbook. */
function sheetNames(sheets) {
  const used = new Set();
  return sheets.map((s, i) => {
    let n = String(s.name || `Sheet${i + 1}`).replace(/[[\]:*?/\\]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^'+|'+$/g, '').slice(0, 31) || `Sheet${i + 1}`;
    let k = 2;
    while (used.has(n.toLowerCase())) n = `${n.slice(0, 28)} ${k++}`;
    used.add(n.toLowerCase());
    return n;
  });
}

function cell(ref, value, type, style) {
  if (value === null || value === undefined || value === '') return '';
  if (type === 'date') {
    const serial = excelSerial(value);
    if (serial !== null) return `<c r="${ref}" s="${STYLE.date}"><v>${serial}</v></c>`;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return `<c r="${ref}"${style ? ` s="${style}"` : ''}><v>${value}</v></c>`;
  if (typeof value === 'boolean') return `<c r="${ref}" t="b"><v>${value ? 1 : 0}</v></c>`;
  const text = esc(value instanceof Date ? value.toISOString() : value);
  return `<c r="${ref}" t="inlineStr"${style && type === 'text' ? '' : ''}><is><t xml:space="preserve">${text}</t></is></c>`;
}

function sheetXml(sheet) {
  const cols = sheet.columns;
  const lastCol = colName(Math.max(cols.length - 1, 0));
  const rows = sheet.rows || [];
  const lastRow = rows.length + 1;
  const out = [`${XML_HEAD}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`];
  out.push(`<dimension ref="A1:${lastCol}${lastRow}"/>`);
  out.push(`<sheetViews><sheetView workbookViewId="0"${sheet.first ? ' tabSelected="1"' : ''}>${
    sheet.freeze === false ? '' : '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/>'}</sheetView></sheetViews>`);
  out.push('<sheetFormatPr defaultRowHeight="15"/>');
  out.push(`<cols>${cols.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width || DEFAULT_WIDTH[c.type || 'text']}" customWidth="1"/>`).join('')}</cols>`);

  out.push('<sheetData>');
  out.push(`<row r="1" ht="22" customHeight="1">${cols.map((c, i) => `<c r="${colName(i)}1" s="${STYLE.header}" t="inlineStr"><is><t xml:space="preserve">${esc(c.header)}</t></is></c>`).join('')}</row>`);
  rows.forEach((row, ri) => {
    const r = ri + 2;
    const cells = cols.map((c, ci) => {
      const v = Array.isArray(row) ? row[ci] : row[c.key];
      return cell(`${colName(ci)}${r}`, v, c.type || 'text', TYPE_STYLE[c.type || 'text']);
    }).join('');
    out.push(`<row r="${r}">${cells}</row>`);
  });
  out.push('</sheetData>');
  if (sheet.autoFilter !== false && cols.length) out.push(`<autoFilter ref="A1:${lastCol}${lastRow}"/>`);
  out.push('<pageMargins left="0.5" right="0.5" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>');
  out.push('<pageSetup orientation="landscape" fitToHeight="0"/>');
  out.push('</worksheet>');
  return out.join('');
}

export function buildXlsx(sheets) {
  if (!sheets.length) throw new Error('A workbook needs at least one sheet.');
  const names = sheetNames(sheets);
  const withIdx = sheets.map((s, i) => ({ ...s, first: i === 0 }));

  const entries = [
    { name: '[Content_Types].xml', data: `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${
      withIdx.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')
    }<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>` },
    { name: '_rels/.rels', data: `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: 'xl/workbook.xml', data: `${XML_HEAD}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>${
      names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')
    }</sheets>${
      withIdx.some((s) => s.autoFilter !== false && s.columns.length)
        ? `<definedNames>${withIdx.map((s, i) => (s.autoFilter !== false && s.columns.length
          ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${esc(names[i]).replace(/'/g, "''")}'!$A$1:$${colName(s.columns.length - 1)}$${(s.rows || []).length + 1}</definedName>` : '')).join('')}</definedNames>`
        : ''
    }</workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', data: `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${
      withIdx.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')
    }<Relationship Id="rId${withIdx.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: 'xl/styles.xml', data: STYLES_XML },
    ...withIdx.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s) })),
  ];
  return createZip(entries);
}

export const _internals = { STYLE };

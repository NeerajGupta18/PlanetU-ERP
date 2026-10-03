import { HttpError } from '../middleware/error.js';
import { getInstitute } from '../db/repo.js';
import { audit } from '../db/audit.js';
import * as svc from '../services/reports.service.js';
import { PDF_MAX_ROWS, streamTablePdf } from '../services/tablepdf.js';

const FORMATS = ['json', 'csv', 'xlsx', 'pdf'];

export const catalogue = async (req, res) => res.json({ reports: svc.catalogue(req.tenant.modules) });

export async function run(req, res) {
  const format = String(req.query.format || 'json').toLowerCase();
  if (!FORMATS.includes(format)) throw new HttpError(400, `Format must be one of: ${FORMATS.join(', ')}.`);
  const def = svc.findReport(req.params.key, req.tenant.modules);
  const params = svc.readParams(def, req.query);
  const result = await svc.runReport(def, params);

  if (format === 'json') {
    const { rows, ...rest } = result;
    return res.json({
      report: { key: def.key, title: def.title }, ...rest, total: rows.length, truncated: rows.length > svc.PREVIEW_ROWS, rows: rows.slice(0, svc.PREVIEW_ROWS),
    });
  }

  if (format === 'pdf' && result.rows.length > PDF_MAX_ROWS) {
    throw new HttpError(413, `This report has ${result.rows.length} rows, too many for a PDF (${PDF_MAX_ROWS} at most). Export it to Excel, or narrow the filters.`);
  }
  // Data leaving the system is worth a trail: who exported what, in which format, with which filters
  await audit(req.user, 'report.export', 'report', def.key, {
    format, rows: result.rows.length, filters: Object.fromEntries(result.filters.filter(([, v]) => v !== null && v !== undefined && v !== '')),
  });
  const institute = await getInstitute();
  const generatedBy = req.user.name;
  await req.tx.commit(); // release the database transaction before building and sending the file

  if (format === 'csv') {
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${svc.fileName(def, 'csv')}"` });
    return res.send(svc.toCsv(result));
  }
  if (format === 'xlsx') {
    res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="${svc.fileName(def, 'xlsx')}"` });
    return res.send(svc.toXlsx(def, result, { institute, generatedBy }));
  }
  // A page is narrower than a spreadsheet: columns marked pdf:false stay Excel/CSV-only, and the PDF says so
  const columns = result.columns.filter((c) => c.pdf !== false);
  const note = columns.length < result.columns.length ? `Showing ${columns.length} of ${result.columns.length} columns. The Excel export has all of them.` : null;
  return streamTablePdf(res, {
    institute, title: def.title, note, filters: result.filters, summary: result.summary, columns, rows: result.rows,
    generatedBy, filename: svc.fileName(def, 'pdf'),
  });
}

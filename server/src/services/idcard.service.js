/**
 * Renders a simple, print-ready student ID card as a PDF (CR80 card size, 3.375" x 2.125", both
 * sides). Built with PDFKit so it needs no headless browser. Photo bytes come from the files
 * service - never trust a path from the client.
 */
import PDFDocument from 'pdfkit';
import { HttpError } from '../middleware/error.js';
import { readBytes } from './files.service.js';
import { fmtDate } from '../utils/pdfDate.js';

const W = 242.6; // 3.375in at 72dpi
const H = 153;   // 2.125in
const BRAND = '#4338ca';

function front(doc, { institute, student, term }) {
  doc.addPage({ size: [W, H], margin: 0 });
  doc.rect(0, 0, W, H).fill('#ffffff');
  doc.rect(0, 0, W, 34).fill(BRAND);
  doc.fillColor('#ffffff').fontSize(9).font('Helvetica-Bold').text(institute.name.toUpperCase(), 10, 8, { width: W - 20, height: 20, ellipsis: true });
  doc.fontSize(6.5).font('Helvetica').text(institute.tagline || `${term.student} ID Card`, 10, 22, { width: W - 20 });

  const photoW = 62; const photoH = 74; const photoX = 12; const photoY = 44;
  doc.rect(photoX, photoY, photoW, photoH).lineWidth(0.75).stroke('#d1d5db');
  if (student.photo) doc.image(student.photo, photoX, photoY, { width: photoW, height: photoH, fit: [photoW, photoH] });
  else { doc.fontSize(7).fillColor('#9ca3af').text('No photo', photoX, photoY + photoH / 2 - 4, { width: photoW, align: 'center' }); doc.fillColor('#000'); }

  const tx = photoX + photoW + 10; const tw = W - tx - 10;
  doc.fillColor('#111827').fontSize(10).font('Helvetica-Bold').text(student.name, tx, photoY, { width: tw });
  doc.fontSize(7).font('Helvetica').fillColor('#374151');
  const line = (label, val, y) => doc.text(`${label}: ${val || '-'}`, tx, y, { width: tw });
  line(term.course, student.course, photoY + 16);
  line('Section', student.section, photoY + 28);
  line(term.student === 'Trainee' ? 'Batch' : 'Batch / Year', student.batch, photoY + 40);
  line('Blood group', student.bloodGroup, photoY + 52);

  doc.fontSize(9).font('Helvetica-Bold').fillColor(BRAND).text(student.studentCode, photoX, photoY + photoH + 8, { width: W - 24 });
  doc.fontSize(6).font('Helvetica').fillColor('#6b7280').text(term.students === 'Trainees' ? 'Trainee ID' : 'Enrollment / PRN', photoX, photoY + photoH + 20);

  if (student.cardValidTill) {
    doc.fontSize(6).fillColor('#6b7280').text(`Valid till ${fmtDate(student.cardValidTill)}`, W - 90, H - 12, { width: 80, align: 'right' });
  }
}

function back(doc, { institute, student }) {
  doc.addPage({ size: [W, H], margin: 0 });
  doc.rect(0, 0, W, H).fill('#ffffff');
  doc.fontSize(7).font('Helvetica-Bold').fillColor('#111827').text('If found, please return to:', 10, 10, { width: W - 20 });
  doc.font('Helvetica').fontSize(6.5).fillColor('#374151')
    .text(institute.name, 10, 22, { width: W - 20 })
    .text(institute.address || '-', 10, 32, { width: W - 20 })
    .text([institute.phone, institute.email].filter(Boolean).join('  ·  '), 10, 44, { width: W - 20 });

  doc.font('Helvetica').fontSize(6.5).fillColor('#111827');
  doc.text(`Email: ${student.email}`, 10, 66, { width: W - 20 });
  doc.text(`Phone: ${student.phone || '-'}`, 10, 76, { width: W - 20 });
  doc.text(`DOB: ${student.dob ? fmtDate(student.dob) : '-'}`, 10, 86, { width: W - 20 });
  if (student.guardian?.name) doc.text(`Guardian: ${student.guardian.name} (${student.guardian.phone || '-'})`, 10, 96, { width: W - 20 });

  doc.moveTo(10, H - 30).lineTo(W - 10, H - 30).lineWidth(0.5).stroke('#d1d5db');
  doc.fontSize(6).fillColor('#6b7280').text('This card remains the property of the institute and must be surrendered on request.', 10, H - 24, { width: W - 20 });
}

/**
 * Streams a two-page (front/back) PDF for one student directly to res. Call AFTER the request's
 * database transaction has been committed - `photoStorageKey` (if any) must already be resolved,
 * since reading file bytes happens outside any transaction (same pattern as file downloads).
 */
export async function streamIdCard(res, { institute, student, term, photoStorageKey }) {
  if (!['Active', 'Alumni'].includes(student.status)) throw new HttpError(409, 'An ID card can only be issued for an active or alumni record.');
  let photo = null;
  if (photoStorageKey) {
    try { photo = await readBytes({ storage_key: photoStorageKey }); } catch { photo = null; }
  }
  res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${student.studentCode}-id-card.pdf"`, 'Cache-Control': 'private, no-store' });
  const doc = new PDFDocument({ autoFirstPage: false });
  doc.pipe(res);
  front(doc, { institute, student: { ...student, photo }, term });
  back(doc, { institute, student });
  doc.end();
}

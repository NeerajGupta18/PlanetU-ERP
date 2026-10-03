/** Renders a fee payment receipt as an A5 PDF. */
import PDFDocument from 'pdfkit';
import { fmtDate } from '../utils/pdfDate.js';

const BRAND = '#4338ca';
const inr = (n) => `Rs. ${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export async function streamReceipt(res, { institute, payment, student }) {
  res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${payment.receiptNo}.pdf"`, 'Cache-Control': 'private, no-store' });
  const doc = new PDFDocument({ size: 'A5', margin: 36 });
  doc.pipe(res);

  doc.fillColor(BRAND).fontSize(16).font('Helvetica-Bold').text(institute.name, { align: 'center' });
  doc.fillColor('#6b7280').fontSize(9).font('Helvetica').text(institute.address || '', { align: 'center' });
  doc.moveDown(0.5).fillColor('#111827').fontSize(13).font('Helvetica-Bold').text('Fee Payment Receipt', { align: 'center' });
  doc.moveDown(1);

  const row = (label, val) => { doc.font('Helvetica').fontSize(10).fillColor('#374151').text(label, { continued: true, width: 160 }); doc.font('Helvetica-Bold').fillColor('#111827').text(val); };
  row('Receipt No.', payment.receiptNo);
  row('Date', fmtDate(payment.paidAt));
  row('Student', `${student.name} (${student.studentCode})`);
  row('Course', student.course || '-');
  row('Payment method', payment.method.replace('_', ' ').replace(/^./, (c) => c.toUpperCase()));
  if (payment.reference) row('Reference', payment.reference);
  doc.moveDown(1);

  doc.font('Helvetica-Bold').fontSize(10).fillColor('#111827').text('Applied to');
  doc.moveTo(doc.x, doc.y + 2).lineTo(doc.page.width - 36, doc.y + 2).strokeColor('#d1d5db').lineWidth(0.5).stroke();
  doc.moveDown(0.5);
  for (const a of payment.allocations) {
    doc.font('Helvetica').fontSize(9.5).fillColor('#374151').text(a.label, { continued: true, width: 260 });
    doc.text(inr(a.amount), { align: 'right' });
  }
  doc.moveDown(0.5);
  doc.moveTo(doc.x, doc.y).lineTo(doc.page.width - 36, doc.y).strokeColor('#d1d5db').lineWidth(0.5).stroke();
  doc.moveDown(0.5);
  doc.font('Helvetica-Bold').fontSize(11).fillColor(BRAND).text('Total paid', { continued: true, width: 260 });
  doc.text(inr(payment.amount), { align: 'right' });

  if (payment.note) { doc.moveDown(1); doc.font('Helvetica').fontSize(9).fillColor('#6b7280').text(`Note: ${payment.note}`); }
  doc.moveDown(2);
  doc.fontSize(8).fillColor('#9ca3af').text('This is a system-generated receipt.', { align: 'center' });
  doc.end();
}

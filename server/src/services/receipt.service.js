/** Renders a fee payment receipt as an A5 PDF, with the institute's own logo and colour at the top. */
import PDFDocument from 'pdfkit';
import { fmtDate } from '../utils/pdfDate.js';
import { DEFAULT_BRAND, drawLogo } from './pdfBrand.js';

const inr = (n) => `Rs. ${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const M = 36;

/** `brand` = { color, logo } from loadBrand(); without it the receipt is plain navy with no logo. */
export async function streamReceipt(res, { institute, payment, student, brand = {} }) {
  const BRAND = brand.color || DEFAULT_BRAND;
  res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${payment.receiptNo}.pdf"`, 'Cache-Control': 'private, no-store' });
  const doc = new PDFDocument({ size: 'A5', margin: M, info: { Title: `Receipt ${payment.receiptNo}`, Author: institute.name } });
  doc.pipe(res);
  const W = doc.page.width - M * 2;

  // Letterhead: logo on the left, the institute's name and address beside it, a thin band in its colour
  const LOGO = 46;
  const hasLogo = drawLogo(doc, brand.logo, M, M, LOGO);
  const tx = hasLogo ? M + LOGO + 10 : M;
  const tw = W - (tx - M);
  doc.fillColor(BRAND).fontSize(15).font('Helvetica-Bold').text(institute.name, tx, M + (hasLogo ? 4 : 0), { width: tw, align: hasLogo ? 'left' : 'center' });
  const contact = [institute.address, [institute.phone, institute.email].filter(Boolean).join('  ·  ')].filter(Boolean).join('\n');
  if (contact) doc.fillColor('#6b7280').fontSize(8.5).font('Helvetica').text(contact, tx, doc.y + 1, { width: tw, align: hasLogo ? 'left' : 'center' });
  const bandY = Math.max(doc.y, hasLogo ? M + LOGO : 0) + 8;
  doc.rect(M, bandY, W, 3).fill(BRAND);

  doc.fillColor('#111827').fontSize(13).font('Helvetica-Bold').text('Fee Payment Receipt', M, bandY + 14, { width: W, align: 'center' });
  doc.moveDown(1);

  const row = (label, val) => {
    const y = doc.y;
    doc.font('Helvetica').fontSize(10).fillColor('#374151').text(label, M, y, { width: 130 });
    doc.font('Helvetica-Bold').fillColor('#111827').text(val, M + 130, y, { width: W - 130 });
    doc.moveDown(0.25);
  };
  row('Receipt No.', payment.receiptNo);
  row('Date', fmtDate(payment.paidAt));
  row('Student', `${student.name} (${student.studentCode})`);
  row('Course', student.course || '-');
  row('Payment method', payment.method.replace('_', ' ').replace(/^./, (c) => c.toUpperCase()));
  if (payment.reference) row('Reference', payment.reference);
  doc.moveDown(0.8);

  doc.font('Helvetica-Bold').fontSize(10).fillColor('#111827').text('Applied to', M, doc.y, { width: W });
  doc.moveTo(M, doc.y + 2).lineTo(M + W, doc.y + 2).strokeColor('#d1d5db').lineWidth(0.5).stroke();
  doc.moveDown(0.5);
  for (const a of payment.allocations) {
    const y = doc.y;
    doc.font('Helvetica').fontSize(9.5).fillColor('#374151').text(a.label, M, y, { width: W - 110 });
    const after = doc.y;
    doc.text(inr(a.amount), M + W - 110, y, { width: 110, align: 'right' });
    doc.y = Math.max(after, doc.y);
  }
  doc.moveDown(0.5);
  doc.moveTo(M, doc.y).lineTo(M + W, doc.y).strokeColor('#d1d5db').lineWidth(0.5).stroke();
  doc.moveDown(0.5);
  const ty = doc.y;
  doc.font('Helvetica-Bold').fontSize(11).fillColor(BRAND).text('Total paid', M, ty, { width: W - 140 });
  doc.text(inr(payment.amount), M + W - 140, ty, { width: 140, align: 'right' });

  if (payment.note) { doc.moveDown(1); doc.font('Helvetica').fontSize(9).fillColor('#6b7280').text(`Note: ${payment.note}`, M, doc.y, { width: W }); }
  doc.moveDown(2);
  doc.fontSize(8).fillColor('#9ca3af').text('This is a system-generated receipt and needs no signature.', M, doc.y, { width: W, align: 'center' });
  doc.end();
}

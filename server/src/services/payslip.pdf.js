/** Draws a payslip as an A4 page: letterhead, employee details, earnings and deductions side by side, and net pay. */
import PDFDocument from 'pdfkit';
import { monthLabel } from './payroll.service.js';

const INK = '#111827';
const MUTED = '#6b7280';
const BRAND = '#4338ca';
const inr = (n) => `Rs. ${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function streamPayslip(res, { institute, slip }) {
  const label = monthLabel(slip.month);
  res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="payslip-${slip.empCode}-${slip.month}.pdf"`, 'Cache-Control': 'private, no-store' });
  const doc = new PDFDocument({ size: 'A4', margin: 56, info: { Title: `Payslip ${label}`, Author: institute.name } });
  doc.pipe(res);
  const W = doc.page.width; const left = 56; const width = W - 112;

  doc.fillColor(BRAND).font('Helvetica-Bold').fontSize(18).text(institute.name, left, 56, { width, align: 'center' });
  const place = [institute.address, institute.city, institute.state, institute.pincode].filter(Boolean).join(', ');
  if (place) doc.fillColor(MUTED).font('Helvetica').fontSize(9.5).text(place, { width, align: 'center' });
  doc.moveTo(left, doc.y + 8).lineTo(W - left, doc.y + 8).lineWidth(0.5).strokeColor('#d1d5db').stroke();
  doc.moveDown(1.5).fillColor(INK).font('Helvetica-Bold').fontSize(14).text(`Payslip for ${label}`, left, doc.y, { width, align: 'center' });

  doc.moveDown(1.2).fontSize(10);
  const info = [['Employee', slip.name], ['Employee ID', slip.empCode], ['Department', slip.department], ['Designation', slip.designation],
    ['Days in month', String(slip.monthDays)], ['Unpaid leave days', String(slip.unpaidDays)]];
  info.forEach(([k, v], i) => {
    const x = i % 2 === 0 ? left : left + width / 2; const y = i % 2 === 0 ? doc.y : doc.y;
    doc.font('Helvetica').fillColor(MUTED).text(k, x, y, { width: 100, continued: false });
    doc.font('Helvetica-Bold').fillColor(INK).text(v, x + 100, y, { width: width / 2 - 110 });
    if (i % 2 === 1 || i === info.length - 1) doc.moveDown(0.4);
    else doc.y = y;
  });

  doc.moveDown(0.8);
  const col = (x, title, rows) => {
    let y = doc.y;
    doc.rect(x, y, width / 2 - 8, 22).fill('#eef2ff');
    doc.fillColor(BRAND).font('Helvetica-Bold').fontSize(10).text(title, x + 8, y + 6);
    y += 30;
    for (const [k, v] of rows) {
      doc.fillColor(INK).font('Helvetica').fontSize(10).text(k, x + 8, y, { width: 120 });
      doc.text(inr(v), x + 120, y, { width: width / 2 - 136, align: 'right' });
      y += 20;
    }
    return y;
  };
  const top = doc.y;
  const e = col(left, 'Earnings', [['Basic pay', slip.basic], ['HRA', slip.hra], ['Allowances', slip.allowances]]);
  doc.y = top;
  const d = col(left + width / 2 + 8, 'Deductions', [['Provident fund', slip.pf], ['Other deductions', slip.otherDeductions], ['Unpaid leave', slip.unpaidAmount]]);
  const y = Math.max(e, d) + 4;
  doc.moveTo(left, y).lineTo(W - left, y).lineWidth(0.5).strokeColor('#d1d5db').stroke();
  doc.font('Helvetica-Bold').fontSize(10.5).fillColor(INK).text('Gross earnings', left + 8, y + 8, { width: 130 }).text(inr(slip.gross), left + 120, y + 8, { width: width / 2 - 136, align: 'right' });
  doc.text('Total deductions', left + width / 2 + 16, y + 8, { width: 130 }).text(inr(slip.totalDeductions), left + width / 2 + 128, y + 8, { width: width / 2 - 136, align: 'right' });

  doc.rect(left, y + 40, width, 34).fill(BRAND);
  doc.fillColor('#fff').font('Helvetica-Bold').fontSize(13).text('Net pay', left + 14, y + 50).text(inr(slip.net), left, y + 50, { width: width - 14, align: 'right' });
  doc.font('Helvetica').fontSize(8).fillColor('#9ca3af').text('This is a computer-generated payslip and needs no signature.', left, doc.page.height - 70, { width, align: 'center' });
  doc.end();
}

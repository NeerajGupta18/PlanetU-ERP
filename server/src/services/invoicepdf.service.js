/**
 * The GST tax invoice, as an A4 PDF. Everything printed comes from the invoice's own snapshot (customer and
 * vendor details as they were when it was issued), so an old invoice never changes if either side later
 * edits their details. Same pdfkit approach as receipts, ID cards, report cards and reports.
 */
import PDFDocument from 'pdfkit';
import { env } from '../config/env.js';
import { fmtDate } from '../utils/pdfDate.js';
import { fit } from '../utils/pdfText.js';
import { amountInWords, inr } from './billingCalc.js';

const BRAND = '#4338ca';
const INK = '#111827';
const MUTED = '#6b7280';
const LINE = '#d1d5db';
const M = 40;
const W = 595.28 - M * 2;

const rs = (n) => `Rs. ${inr(n)}`;

/** A timestamp (Date or ISO text) as the calendar day it was in India, 'YYYY-MM-DD'. */
export const istDay = (v) => new Date(v).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

/** The sentence under "Paid in full". Kept separate so it can be tested without rendering a PDF. */
export function describePayment(p) {
  if (!p) return 'Payment received.';
  const method = { razorpay: 'online payment (Razorpay)', bank_transfer: 'bank transfer', upi: 'UPI', cheque: 'cheque', cash: 'cash', other: 'other means' }[p.method] || String(p.method).replace('_', ' ');
  return `Received ${fmtDate(istDay(p.paidAt))} by ${method}${p.reference ? `, reference ${p.reference}` : ''}.`;
}

/** Where to send money. Taken from the CURRENT settings, not the invoice's frozen copy: bank details can change after an invoice is issued. */
export const payDetails = (vendorSnapshot) => ({ bank: env.BILLING_BANK_DETAILS || vendorSnapshot?.bank || '', upi: env.BILLING_UPI_ID || vendorSnapshot?.upi || '' });

export function streamInvoicePdf(res, invoice, { filename }) {
  res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${filename}"`, 'Cache-Control': 'private, no-store' });
  const doc = new PDFDocument({ size: 'A4', margin: M, info: { Title: `Tax invoice ${invoice.number}`, Author: invoice.vendor.name } });
  doc.pipe(res);
  const v = invoice.vendor; const c = invoice.customer;

  if (invoice.status === 'void') {
    doc.save(); doc.rotate(-32, { origin: [297, 421] });
    doc.font('Helvetica-Bold').fontSize(90).fillColor('#f1f2f6').text('VOID', 70, 360, { width: 460, align: 'center', lineBreak: false });
    doc.restore();
  }

  /* letterhead */
  doc.rect(M, 34, W, 3).fill(BRAND);
  doc.font('Helvetica-Bold').fontSize(17).fillColor(BRAND).text(v.name, M, 46, { width: 330 });
  doc.font('Helvetica').fontSize(8.5).fillColor(MUTED);
  const idLines = [v.address, v.state ? `State: ${v.state}` : '', v.gstin ? `GSTIN: ${v.gstin}` : '', v.pan ? `PAN: ${v.pan}` : '', v.email].filter(Boolean);
  idLines.forEach((l) => doc.text(l, M, doc.y + 1, { width: 330 }));
  const leftEnd = doc.y;

  doc.font('Helvetica-Bold').fontSize(16).fillColor(INK).text('TAX INVOICE', M + 330, 46, { width: W - 330, align: 'right' });
  const stamp = invoice.status === 'paid' ? ['PAID', '#15803d'] : invoice.status === 'void' ? ['VOID', '#6b7280'] : ['UNPAID', '#b45309'];
  doc.font('Helvetica-Bold').fontSize(10).fillColor(stamp[1]).text(stamp[0], M + 330, 68, { width: W - 330, align: 'right' });
  doc.font('Helvetica').fontSize(9).fillColor(INK);
  [['Invoice no.', invoice.number], ['Date', fmtDate(invoice.issueDate)], ['Due date', fmtDate(invoice.dueDate)]].forEach(([k, val], i) => {
    doc.fillColor(MUTED).text(k, M + 340, 84 + i * 13, { width: 70, lineBreak: false });
    doc.font('Helvetica-Bold').fillColor(INK).text(val, M + 410, 84 + i * 13, { width: W - 410, align: 'right', lineBreak: false });
    doc.font('Helvetica');
  });

  /* bill to */
  let y = Math.max(leftEnd, 130) + 14;
  doc.moveTo(M, y).lineTo(M + W, y).strokeColor(LINE).lineWidth(0.7).stroke();
  y += 10;
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor(MUTED).text('BILL TO', M, y);
  doc.font('Helvetica-Bold').fontSize(11).fillColor(INK).text(c.name, M, y + 12, { width: 300 });
  doc.font('Helvetica').fontSize(9).fillColor(INK);
  [c.address, c.gstin ? `GSTIN: ${c.gstin}` : 'GSTIN: not provided', c.state ? `State: ${c.state}` : ''].filter(Boolean).forEach((l) => doc.text(l, M, doc.y + 1, { width: 300 }));
  const billEnd = doc.y;
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor(MUTED).text('SERVICE PERIOD', M + 340, y);
  doc.font('Helvetica').fontSize(9.5).fillColor(INK).text(`${fmtDate(invoice.periodStart)} to ${fmtDate(invoice.periodEnd)}`, M + 340, y + 12, { width: W - 340 });
  doc.fontSize(8.5).fillColor(MUTED).text(`Place of supply: ${invoice.placeOfSupply}`, M + 340, doc.y + 4, { width: W - 340 });
  doc.text('Reverse charge: No', M + 340, doc.y + 1, { width: W - 340 });

  /* lines */
  y = Math.max(billEnd, doc.y) + 18;
  const cols = [['#', 22, 'center'], ['Description', 245, 'left'], ['SAC', 52, 'center'], ['Qty', 38, 'right'], ['Rate', 70, 'right'], ['Amount', 88, 'right']];
  doc.rect(M, y, W, 22).fill(BRAND);
  let x = M;
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#ffffff');
  cols.forEach(([h, w, a]) => { doc.text(h, x + 5, y + 7, { width: w - 10, align: a, lineBreak: false }); x += w; });
  y += 22;
  invoice.lines.forEach((l, i) => {
    doc.font('Helvetica').fontSize(9.5);
    const h = Math.max(24, doc.heightOfString(l.description, { width: cols[1][1] - 10 }) + 12);
    if (i % 2) doc.rect(M, y, W, h).fill('#f8f9ff');
    const cells = [String(i + 1), l.description, v.sac || '', String(l.quantity % 1 ? l.quantity.toFixed(2) : l.quantity), inr(l.unitPrice), inr(l.amount)];
    let cx = M;
    cols.forEach(([, w, a], ci) => {
      doc.font('Helvetica').fontSize(9.5).fillColor(INK).text(cells[ci], cx + 5, y + 7, { width: w - 10, align: a, ...(ci === 1 ? {} : { lineBreak: false }) });
      cx += w;
    });
    doc.moveTo(M, y + h).lineTo(M + W, y + h).strokeColor(LINE).lineWidth(0.4).stroke();
    y += h;
  });

  /* totals */
  y += 10;
  const totalsTop = y;
  const tx = M + W - 230;
  const row = (label, value, { bold = false, rule = false } = {}) => {
    if (rule) doc.moveTo(tx, y - 2).lineTo(M + W, y - 2).strokeColor(INK).lineWidth(0.7).stroke();
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 11 : 9.5).fillColor(INK);
    doc.text(label, tx, y + 2, { width: 130, lineBreak: false });
    doc.text(value, tx + 100, y + 2, { width: 130, align: 'right', lineBreak: false });
    y += bold ? 20 : 16;
  };
  row('Subtotal', rs(invoice.subtotal));
  if (invoice.discount > 0) row('Discount', `- ${rs(invoice.discount)}`);
  row('Taxable value', rs(invoice.taxable));
  const half = invoice.taxRate / 2;
  if (invoice.igst > 0 || (invoice.cgst === 0 && invoice.sgst === 0 && invoice.taxRate > 0)) row(`IGST @ ${invoice.taxRate}%`, rs(invoice.igst));
  else { row(`CGST @ ${half}%`, rs(invoice.cgst)); row(`SGST @ ${half}%`, rs(invoice.sgst)); }
  row('Total', rs(invoice.total), { bold: true, rule: true });

  doc.font('Helvetica-Oblique').fontSize(9).fillColor(MUTED).text(amountInWords(invoice.total), M, totalsTop + 4, { width: W - 250 });

  /* payment */
  y = Math.max(y, doc.y) + 18;
  doc.rect(M, y, W, 1).fill(LINE);
  y += 10;
  if (invoice.status === 'paid') {
    const p = invoice.payments[invoice.payments.length - 1];
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#15803d').text('Paid in full', M, y);
    doc.font('Helvetica').fontSize(9).fillColor(INK).text(describePayment(p), M, doc.y + 2, { width: W });
  } else if (invoice.status === 'open') {
    doc.font('Helvetica-Bold').fontSize(10).fillColor(INK).text('How to pay', M, y);
    doc.font('Helvetica').fontSize(9).fillColor(INK).text('Pay online (UPI, card, net banking) from Billing in your PlanetU ERP account.', M, doc.y + 2, { width: W });
    const pay = payDetails(v);
    if (pay.bank) doc.text(`Bank transfer: ${pay.bank}`, M, doc.y + 2, { width: W });
    if (pay.upi) doc.text(`UPI: ${pay.upi}`, M, doc.y + 2, { width: W });
    doc.fillColor(MUTED).text('Please quote the invoice number as the payment reference.', M, doc.y + 2, { width: W });
  } else if (invoice.voidReason) {
    doc.font('Helvetica-Bold').fontSize(10).fillColor(MUTED).text(`Voided: ${invoice.voidReason}`, M, y, { width: W });
  }

  doc.font('Helvetica').fontSize(8).fillColor('#9ca3af').text('This is a computer-generated invoice and does not need a signature.', M, 842 - 60, { width: W, align: 'center', lineBreak: false });
  doc.end();
}

/** Draws an issued certificate as an A4 page: letterhead, number and date, the wording for its type, and a signature block. */
import PDFDocument from 'pdfkit';
import { fmtDate } from '../utils/pdfDate.js';
import { TYPES } from './certificates.service.js';

const INK = '#111827';
const MUTED = '#6b7280';
const BRAND = '#4338ca';

const cap = (s) => String(s || '').replace(/^./, (c) => c.toUpperCase());

/** The sentences of each certificate. Kept neutral about gender so one wording suits every student. */
function wording(c, institute) {
  const who = `${c.name} (${c.code})`;
  const guardian = c.guardian?.fatherName || c.guardian?.name;
  const course = c.courseFull || c.course || 'the institute';
  const session = c.batch ? `, batch ${c.batch}` : '';
  const dob = c.dob ? fmtDate(c.dob) : null;
  if (c.cert_type === 'bonafide') {
    return [
      `This is to certify that ${who}${guardian ? `, ward of ${guardian},` : ''} is a bonafide student of ${institute.name}, enrolled in ${course}, semester / term ${c.semester}${session}.`,
      ...(dob ? [`As per the records of the institute, the date of birth of the student is ${dob}.`] : []),
      `This certificate is issued on the request of the student for the purpose of: ${c.purpose}.`,
    ];
  }
  if (c.cert_type === 'character') {
    return [
      `This is to certify that ${who}${guardian ? `, ward of ${guardian},` : ''} has been a student of ${institute.name} in ${course}${c.admissionDate ? ` since ${fmtDate(c.admissionDate)}` : ''}${session}.`,
      `During this period the conduct and character of the student have been found to be ${String(c.details?.conduct || 'Good').toLowerCase()}.`,
      `This certificate is issued on the request of the student for: ${c.purpose}.`,
    ];
  }
  if (c.cert_type === 'noc') {
    return [
      `This is to certify that ${who} is a student of ${institute.name}, enrolled in ${course}, semester / term ${c.semester}${session}.`,
      `The institute has no objection to the student for the following: ${c.purpose}.`,
      'This certificate is issued on the request of the student and is valid only for the purpose stated above.',
    ];
  }
  return [
    `Certified that ${who}${guardian ? `, ward of ${guardian},` : ''} was a student of ${institute.name}, enrolled in ${course}${session}.`,
    `The details below are correct as per the records of the institute, and the student is permitted to leave.`,
  ];
}

export function streamCertificate(res, { institute, cert }) {
  const number = cert.certificate_no;
  res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${number}.pdf"`, 'Cache-Control': 'private, no-store' });
  const doc = new PDFDocument({ size: 'A4', margin: 56, info: { Title: `${TYPES[cert.cert_type]} ${number}`, Author: institute.name } });
  doc.pipe(res);
  const W = doc.page.width; const H = doc.page.height;
  const left = 56; const width = W - 112;

  doc.lineWidth(1.5).strokeColor(BRAND).rect(28, 28, W - 56, H - 56).stroke();
  doc.lineWidth(0.5).rect(34, 34, W - 68, H - 68).stroke();

  doc.fillColor(BRAND).font('Helvetica-Bold').fontSize(20).text(institute.name, left, 70, { width, align: 'center' });
  const place = [institute.address, institute.city, institute.state, institute.pincode].filter(Boolean).join(', ');
  doc.fillColor(MUTED).font('Helvetica').fontSize(9.5);
  if (place) doc.text(place, { width, align: 'center' });
  const contact = [institute.phone && `Phone: ${institute.phone}`, institute.email && `Email: ${institute.email}`].filter(Boolean).join('   |   ');
  if (contact) doc.text(contact, { width, align: 'center' });
  doc.moveTo(left, doc.y + 10).lineTo(W - left, doc.y + 10).lineWidth(0.5).strokeColor('#d1d5db').stroke();

  doc.moveDown(2).fillColor(INK).font('Helvetica-Bold').fontSize(16).text(TYPES[cert.cert_type].replace(/ \(.*\)$/, '').toUpperCase(), left, doc.y, { width, align: 'center', underline: true });
  doc.moveDown(1.5).font('Helvetica').fontSize(10).fillColor(MUTED);
  const y = doc.y;
  doc.text(`Certificate No.: ${number}`, left, y, { width: width / 2 });
  doc.text(`Date: ${fmtDate(cert.issued_at)}`, left + width / 2, y, { width: width / 2, align: 'right' });

  doc.moveDown(2).fillColor(INK).font('Helvetica').fontSize(12);
  for (const para of wording(cert, institute)) doc.text(para, left, doc.y, { width, align: 'justify', lineGap: 5 }).moveDown(0.9);

  if (cert.cert_type === 'transfer') {
    doc.moveDown(0.3);
    const rows = [
      ['Name of student', cert.name], ['Student ID / PRN', cert.code], ['Date of birth', cert.dob ? fmtDate(cert.dob) : '-'],
      ["Parent / guardian", cert.guardian?.fatherName || cert.guardian?.name || '-'], ['Course', cert.courseFull || cert.course || '-'],
      ['Date of admission', cert.admissionDate ? fmtDate(cert.admissionDate) : '-'],
      ['Date of leaving', cert.details?.leavingDate ? fmtDate(cert.details.leavingDate) : '-'],
      ['Reason for leaving', cert.details?.reason || cert.purpose || '-'], ['Conduct', cert.details?.conduct || 'Good'],
    ];
    for (const [k, v] of rows) {
      const ry = doc.y;
      doc.font('Helvetica').fontSize(11).fillColor(MUTED).text(k, left + 10, ry, { width: 170 });
      doc.font('Helvetica-Bold').fillColor(INK).text(String(v), left + 190, ry, { width: width - 200 });
      doc.moveTo(left, doc.y + 3).lineTo(W - left, doc.y + 3).lineWidth(0.3).strokeColor('#e5e7eb').stroke();
      doc.moveDown(0.5);
    }
  }

  // Signature block, kept clear of the border whatever the length of the text
  const sy = Math.max(doc.y + 70, H - 190);
  const signatory = institute.stamp?.signatory || '';
  const title = institute.stamp?.signatoryTitle || 'Authorised Signatory';
  doc.moveTo(W - left - 190, sy).lineTo(W - left, sy).lineWidth(0.7).strokeColor(INK).stroke();
  doc.font('Helvetica-Bold').fontSize(11).fillColor(INK).text(signatory || title, W - left - 190, sy + 6, { width: 190, align: 'center' });
  if (signatory) doc.font('Helvetica').fontSize(10).fillColor(MUTED).text(cap(title), W - left - 190, doc.y, { width: 190, align: 'center' });
  doc.font('Helvetica').fontSize(8).fillColor('#9ca3af').text('This is a computer-generated certificate. Quote the certificate number to verify it with the institute.', left, H - 70, { width, align: 'center' });
  doc.end();
}

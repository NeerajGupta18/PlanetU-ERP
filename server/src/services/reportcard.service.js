/**
 * Renders report cards as A4 PDFs - one page per student (more only if a card has a very long subject list).
 * Same approach as the fee receipts and ID cards: pdfkit, streamed straight to the response.
 */
import PDFDocument from 'pdfkit';
import { fmtDate } from '../utils/pdfDate.js';
import { fit } from '../utils/pdfText.js';

const BRAND = '#4338ca';
const INK = '#111827';
const MUTED = '#6b7280';
const LINE = '#d1d5db';
const M = 40;                       // page margin
const W = 595.28 - M * 2;           // usable width on A4

// Table columns: [key, heading, width, align]
const COLS = [
  ['sr', 'Sr', 24, 'center'], ['subject', 'Subject', 150, 'left'], ['credits', 'Credits', 40, 'center'],
  ['max', 'Max', 40, 'center'], ['pass', 'Pass', 40, 'center'], ['marks', 'Marks', 55, 'center'],
  ['pct', '%', 45, 'center'], ['grade', 'Grade', 40, 'center'], ['gp', 'GP', 35, 'center'], ['result', 'Result', 46, 'center'],
];
const num = (n) => (Number.isInteger(n) ? String(n) : String(+n.toFixed(2)));
const ROW = 22;


function cells(s, i) {
  const marks = s.absent ? 'AB' : num(s.marks);
  return {
    sr: String(i + 1), subject: s.subject, credits: num(s.credits), max: num(s.maxMarks), pass: num(s.passMarks), marks,
    pct: s.absent ? '-' : num(s.pct), grade: s.grade, gp: num(s.points),
    result: s.passed ? 'Pass' : s.absent ? 'Absent' : 'Fail',
  };
}

function tableHeader(doc, y) {
  doc.rect(M, y, W, ROW).fill(BRAND);
  let x = M;
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#ffffff');
  for (const [, head, w, align] of COLS) {
    doc.text(head, x + 4, y + 7, { width: w - 8, align, lineBreak: false });
    x += w;
  }
  return y + ROW;
}

function drawCard(doc, { institute, card }) {
  const { exam, student, outcome, bands, provisional } = card;
  doc.addPage();

  if (provisional) {
    doc.save();
    doc.rotate(-32, { origin: [297, 421] });
    doc.font('Helvetica-Bold').fontSize(64).fillColor('#eef0f5').text('PROVISIONAL', 70, 380, { width: 460, align: 'center', lineBreak: false });
    doc.restore();
  }

  // Letterhead
  doc.rect(M, 36, W, 3).fill(BRAND);
  doc.font('Helvetica-Bold').fontSize(18).fillColor(BRAND).text(institute.name, M, 50, { width: W, align: 'center' });
  if (institute.address) doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(institute.address, M, doc.y + 1, { width: W, align: 'center' });
  doc.moveDown(0.8);
  doc.font('Helvetica-Bold').fontSize(14).fillColor(INK).text('STATEMENT OF MARKS / REPORT CARD', M, doc.y, { width: W, align: 'center' });
  doc.font('Helvetica').fontSize(11).fillColor(MUTED)
    .text(`${exam.name} | ${exam.course}, Semester ${exam.semester}`, M, doc.y + 2, { width: W, align: 'center' });
  if (provisional) doc.font('Helvetica-Bold').fontSize(9).fillColor('#b45309').text('PROVISIONAL - results not yet published', M, doc.y + 3, { width: W, align: 'center' });

  // Student details (two columns)
  let y = doc.y + 16;
  const left = [['Student', student.name], ['Student ID', student.code], ['Roll no.', student.rollNo || '-'], ['Enrolment no.', student.enrollmentNo || '-']];
  const right = [['Programme', student.courseFullName || student.course || '-'], ['Semester', String(exam.semester)], ['Batch', student.batch || '-'],
    ['Date of birth', student.dob ? fmtDate(student.dob) : '-']];
  doc.roundedRect(M, y - 6, W, left.length * 16 + 10, 6).strokeColor(LINE).lineWidth(0.7).stroke();
  left.forEach(([k, v], i) => {
    doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(k, M + 12, y + i * 16, { width: 80, lineBreak: false });
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor(INK).text(fit(doc, v, 165), M + 92, y + i * 16, { width: 170, lineBreak: false });
  });
  right.forEach(([k, v], i) => {
    doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(k, M + 262, y + i * 16, { width: 80, lineBreak: false });
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor(INK).text(fit(doc, v, 172), M + 340, y + i * 16, { width: 178, lineBreak: false });
  });
  y += left.length * 16 + 22;

  // Marks table
  y = tableHeader(doc, y);
  outcome.subjects.forEach((s, i) => {
    // Leave room below the table for the summary, grading key and signature
    if (y + ROW > 842 - 262) { doc.addPage(); y = tableHeader(doc, 50); }
    if (i % 2) doc.rect(M, y, W, ROW).fill('#f8f9ff');
    const row = cells(s, i);
    let x = M;
    for (const [key, , w, align] of COLS) {
      const failed = !s.passed && (key === 'result' || key === 'grade' || key === 'marks');
      doc.font(key === 'subject' || failed ? 'Helvetica-Bold' : 'Helvetica').fontSize(9.5).fillColor(failed ? '#b91c1c' : INK);
      doc.text(fit(doc, row[key], w - 8), x + 4, y + 6.5, { width: w - 6, align, lineBreak: false });
      x += w;
    }
    doc.moveTo(M, y + ROW).lineTo(M + W, y + ROW).strokeColor(LINE).lineWidth(0.4).stroke();
    y += ROW;
  });

  // Summary
  y += 14;
  const boxes = [
    ['Total marks', `${num(outcome.total)} / ${num(outcome.maxTotal)}`],
    ['Percentage', `${num(outcome.pct)}%`],
    ['GPA', outcome.gpa === null ? '-' : outcome.gpa.toFixed(2)],
    ['Credits earned', `${num(outcome.creditsEarned)} / ${num(outcome.totalCredits)}`],
  ];
  const bw = (W - 3 * 10) / 4;
  boxes.forEach(([k, v], i) => {
    const x = M + i * (bw + 10);
    doc.roundedRect(x, y, bw, 46, 6).fillAndStroke('#f5f6ff', LINE);
    doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text(k, x, y + 8, { width: bw, align: 'center', lineBreak: false });
    doc.font('Helvetica-Bold').fontSize(14).fillColor(BRAND).text(v, x, y + 22, { width: bw, align: 'center', lineBreak: false });
  });
  y += 62;
  const pass = outcome.result === 'pass';
  doc.font('Helvetica-Bold').fontSize(13).fillColor(pass ? '#15803d' : '#b91c1c')
    .text(`RESULT: ${pass ? 'PASS' : 'FAIL'}`, M, y, { width: W, align: 'center', lineBreak: false });
  if (!pass) {
    doc.font('Helvetica').fontSize(9).fillColor(MUTED)
      .text(`Not cleared: ${outcome.failedSubjects.join(', ')}`, M, y + 18, { width: W, align: 'center' });
  }

  // Grading key + signature, pinned to the foot of the page
  const foot = 842 - 112;
  const key = bands.map((b) => `${b.grade} >= ${num(b.min)}% (${num(b.points)})`).join('   |   ');
  doc.font('Helvetica-Bold').fontSize(8).fillColor(MUTED).text('Grading scale (grade, minimum %, grade points)', M, foot - 28, { width: W });
  doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(key, M, foot - 16, { width: W });
  doc.text('AB = absent. GP = grade points. GPA = credit-weighted average of grade points.', M, foot - 3, { width: W });

  const sig = institute.stamp || {};
  doc.moveTo(M + W - 190, foot + 44).lineTo(M + W, foot + 44).strokeColor(INK).lineWidth(0.6).stroke();
  doc.font('Helvetica-Bold').fontSize(9).fillColor(INK).text(sig.signatory || 'Controller of Examinations', M + W - 190, foot + 48, { width: 190, align: 'center' });
  doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text(sig.signatoryTitle || '', M + W - 190, foot + 60, { width: 190, align: 'center' });
  doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text(`Date of issue: ${fmtDate(new Date())}`, M, foot + 48, { width: 220 });
  doc.fontSize(7.5).fillColor('#9ca3af').text('This is a computer-generated report card.', M, foot + 62, { width: 220 });
}

/** Streams one or many report cards. `cards` come from exams.service (reportCardData / allReportCards). */
export function streamReportCards(res, { institute, cards, filename }) {
  res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${filename}"`, 'Cache-Control': 'private, no-store' });
  const doc = new PDFDocument({ size: 'A4', margin: M, autoFirstPage: false, info: { Title: 'Report card', Author: institute.name } });
  doc.pipe(res);
  for (const card of cards) drawCard(doc, { institute, card });
  doc.end();
}

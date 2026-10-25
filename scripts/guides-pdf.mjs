// Turns the plain-text guides in docs/guides into simple PDFs in docs/guides/pdf.
//   node scripts/guides-pdf.mjs
// The first line of a file is the product name, the second its title; a line with no indent that is followed
// by text is a heading. Everything else prints as it is written.
import { createWriteStream, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'guides');
const OUT = join(DIR, 'pdf');
mkdirSync(OUT, { recursive: true });

const isHeading = (line, next) => line && !/^[\s\-\d"]/.test(line) && line.length < 60 && !/[.:,]$/.test(line) && next !== undefined && next !== '';

for (const file of readdirSync(DIR).filter((f) => f.endsWith('.txt')).sort()) {
  const lines = readFileSync(join(DIR, file), 'utf8').replace(/\r/g, '').split('\n');
  const doc = new PDFDocument({ size: 'A4', margin: 56, info: { Title: lines[1], Author: 'PlanetU Technovision' } });
  const done = new Promise((resolve) => doc.pipe(createWriteStream(join(OUT, `${basename(file, '.txt')}.pdf`))).on('finish', resolve));
  doc.font('Helvetica').fontSize(10).fillColor('#555').text(lines[0]);
  doc.moveDown(0.3).font('Helvetica-Bold').fontSize(18).fillColor('#111').text(lines[1]);
  doc.moveDown(0.6);
  for (let i = 2; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) { doc.moveDown(0.5); continue; }
    if (isHeading(line, lines[i + 1])) {
      doc.moveDown(0.3).font('Helvetica-Bold').fontSize(12.5).fillColor('#111').text(line, 56).moveDown(0.2);
      continue;
    }
    const indent = line.match(/^\s*/)[0].length;
    doc.font('Helvetica').fontSize(10.5).fillColor('#222').text(line.trim(), 56 + indent * 5, undefined, { lineGap: 2 });
  }
  doc.end();
  await done;
  console.log(`docs/guides/pdf/${basename(file, '.txt')}.pdf`);
}

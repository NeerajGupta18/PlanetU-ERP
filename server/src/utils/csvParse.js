/**
 * A small RFC 4180 CSV reader: quoted fields, "" escapes, commas / semicolons / tabs as the delimiter
 * (Excel in some regions saves with semicolons), CRLF / LF / CR line ends, embedded newlines inside quotes,
 * and a leading UTF-8 byte-order mark. Returns rows as arrays of strings with the 1-based physical line
 * each record started on, so error messages can point at the exact line in the user's file.
 */
export function detectDelimiter(text) {
  const firstLine = text.split(/\r\n|\n|\r/, 1)[0] || '';
  let best = ','; let bestN = 0; let inQuotes = false;
  const counts = { ',': 0, ';': 0, '\t': 0 };
  for (const ch of firstLine) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && ch in counts) counts[ch] += 1;
  }
  for (const [d, n] of Object.entries(counts)) if (n > bestN) { best = d; bestN = n; }
  return best;
}

export function parseCsv(input, delimiter) {
  const text = String(input).replace(/^\uFEFF/, '');
  const delim = delimiter || detectDelimiter(text);
  const rows = [];
  let row = []; let field = ''; let inQuotes = false; let line = 1; let startLine = 1; let fieldWasQuoted = false;

  const endField = () => { row.push(field); field = ''; fieldWasQuoted = false; };
  const endRow = () => {
    endField();
    // Ignore blank lines, but keep a row of only empty quoted cells the user clearly typed
    if (row.some((c) => c.trim() !== '') || row.length > 1) rows.push({ line: startLine, cells: row });
    row = [];
  };

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1; } else inQuotes = false;
      } else {
        if (ch === '\n') line += 1;
        field += ch;
      }
    } else if (ch === '"' && field === '' && !fieldWasQuoted) {
      inQuotes = true; fieldWasQuoted = true;
    } else if (ch === delim) {
      endField();
    } else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      endRow(); line += 1; startLine = line;
    } else {
      field += ch;
    }
  }
  if (inQuotes) throw new Error('A quoted value is never closed (a " is missing).');
  if (field !== '' || row.length) endRow();
  return { rows, delimiter: delim };
}

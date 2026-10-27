/**
 * Setup fixer (admin): cleans a messy student or staff sheet and explains every fix, then waits for approval.
 *
 * The cleaning itself is plain code (column names, spaces, name casing, phone formats, emails, dates, gender,
 * duplicate rows). The model is only asked about column headings our own list does not know, and it sees the
 * heading text only - never a row of data. Its answer must be a JSON map onto our field names, checked here.
 * The cleaned sheet is checked by the same import check as the Students page, and it is imported - by the
 * existing importer - only when someone approves the proposal.
 */
import { HttpError } from '../src/middleware/error.js';
import { csvCell } from '../src/utils/csv.js';
import { parseCsv } from '../src/utils/csvParse.js';
import { COLUMNS, IMPORT_LIMITS, analyse as analyseStudents, decode, importStudents, parseDate, previewRow as studentRow } from '../src/services/studentImport.service.js';
import { STAFF_COLUMNS, analyse as analyseStaff, importStaff, previewRow as staffRow } from '../src/services/staffImport.service.js';
import { ask, guardedRun, playbook, untrusted } from './runner.js';
import { createProposal } from './proposals.js';

const KINDS = {
  students: { columns: COLUMNS, analyse: (b) => analyseStudents(b), row: studentRow, proposal: 'student_import', noun: 'student' },
  staff: { columns: STAFF_COLUMNS, analyse: (b) => analyseStaff(b), row: staffRow, proposal: 'staff_import', noun: 'staff member' },
};
const NAME_FIELDS = ['name', 'guardianName'];
const PHONE_FIELDS = ['phone', 'guardianPhone'];
const EMAIL_FIELDS = ['email', 'guardianEmail'];
const DATE_FIELDS = ['dob', 'admissionDate', 'joinDate'];
const MAX_LISTED = 300;

const squash = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
const tidy = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();

/** Known headings: our own field names, template labels and accepted spellings. */
export function matchHeader(cells, columns) {
  const lookup = new Map();
  for (const c of columns) for (const k of [c.key, c.label, ...c.aliases]) lookup.set(squash(k), c.key);
  const map = []; const unknown = [];
  const used = new Set();
  cells.forEach((h, i) => {
    const key = lookup.get(squash(h));
    if (key && !used.has(key)) { map[i] = key; used.add(key); } else if (tidy(h)) unknown.push({ index: i, heading: tidy(h).slice(0, 60) });
  });
  return { map, unknown, used };
}

/**
 * "RAHUL SHARMA" / "rahul DESAI" -> "Rahul Sharma" / "Rahul Desai", word by word. A word already in mixed case
 * ("McKenzie") and short initials ("A.K.") are left alone.
 */
export function nameCase(v) {
  return v.split(' ').map((w) => {
    if (!/[a-z]/i.test(w) || (w !== w.toUpperCase() && w !== w.toLowerCase())) return w;
    if (w === w.toUpperCase() && /^([A-Z]\.)+$/.test(w)) return w;
    return w.toLowerCase().replace(/(^|['.-])([a-z])/g, (m, a, b) => a + b.toUpperCase());
  }).join(' ');
}

/** "+91 98123-45600", "098123 45600", "91 9812345600" -> "9812345600". Anything else is left as typed. */
export function phoneFix(v) {
  const d = v.replace(/[\s().\-+]/g, '');
  if (!/^\d+$/.test(d)) return v;
  if (d.length === 12 && d.startsWith('91')) return d.slice(2);
  if (d.length === 11 && d.startsWith('0')) return d.slice(1);
  return d;
}

const GENDER = { m: 'Male', male: 'Male', boy: 'Male', f: 'Female', female: 'Female', girl: 'Female', o: 'Other', other: 'Other' };

/** Cleans the rows. Returns the cleaned rows (field -> value), each fix explained, and the removed duplicates. */
export function cleanRows(body, map) {
  const fixes = []; const counts = {};
  const note = (line, field, from, to, why) => {
    counts[why] = (counts[why] || 0) + 1;
    if (fixes.length < MAX_LISTED) fixes.push({ line, field, from, to, why });
  };
  const out = []; const seenEmail = new Map(); const seenNamePhone = new Map(); const removed = [];
  for (const r of body) {
    const v = {};
    map.forEach((field, i) => {
      if (!field) return;
      const raw = String(r.cells[i] ?? '');
      let val = tidy(raw);
      if (val !== raw) note(r.line, field, raw, val, 'Extra spaces removed');
      if (NAME_FIELDS.includes(field) && val) { const n = nameCase(val); if (n !== val) { note(r.line, field, val, n, 'Name put in normal capital letters'); val = n; } }
      if (PHONE_FIELDS.includes(field) && val) { const p = phoneFix(val); if (p !== val) { note(r.line, field, val, p, 'Phone number written as 10 digits'); val = p; } }
      if (EMAIL_FIELDS.includes(field) && val) { const e = val.replace(/^mailto:/i, '').replace(/\s+/g, '').toLowerCase(); if (e !== val) { note(r.line, field, val, e, 'Email made lower case without spaces'); val = e; } }
      if (DATE_FIELDS.includes(field) && val && !/^\d{4}-\d{2}-\d{2}$/.test(val)) { const d = parseDate(val); if (d) { note(r.line, field, val, d, 'Date written as year-month-day'); val = d; } }
      if (field === 'gender' && val) { const g = GENDER[val.toLowerCase()]; if (g && g !== val) { note(r.line, field, val, g, 'Gender written in full'); val = g; } }
      v[field] = val;
    });
    if (!Object.values(v).some(Boolean)) continue;
    const email = (v.email || '').toLowerCase();
    const np = v.name && v.phone ? `${v.name.toLowerCase()}|${v.phone}` : '';
    const dupOf = (email && seenEmail.get(email)) || (np && seenNamePhone.get(np));
    if (dupOf) {
      removed.push({ line: r.line, sameAs: dupOf, name: v.name || '' });
      counts['Duplicate row removed'] = (counts['Duplicate row removed'] || 0) + 1;
      continue;
    }
    if (email) seenEmail.set(email, r.line);
    if (np) seenNamePhone.set(np, r.line);
    out.push({ line: r.line, values: v });
  }
  return { rows: out, fixes, counts, removed };
}

/** Asks the model about unknown headings only. The answer is checked: our field names, each used once. */
async function matchUnknown(trace, kind, unknown, used) {
  const fields = KINDS[kind].columns.map((c) => c.key).filter((k) => !used.has(k));
  if (!unknown.length || !fields.length) return {};
  const list = unknown.map((u, n) => `${n + 1}. ${u.heading}`).join('\n');
  const msg = await ask(trace, {
    messages: [
      { role: 'system', content: playbook('setup') },
      { role: 'user', content: `Sheet of: ${kind}.\nERP fields still free: ${fields.join(', ')}, ignore.\nUnknown headings:\n${untrusted('column headings from an uploaded file', list)}` },
    ],
    maxTokens: 300,
  });
  let parsed;
  try { parsed = JSON.parse(String(msg.content || '').replace(/^```(?:json)?|```$/g, '').trim()); } catch { return {}; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const out = {}; const taken = new Set();
  for (const [k, f] of Object.entries(parsed)) {
    const n = Number(k);
    if (!Number.isInteger(n) || n < 1 || n > unknown.length || typeof f !== 'string') continue;
    if (f === 'ignore' || !fields.includes(f) || taken.has(f)) continue;
    taken.add(f);
    out[unknown[n - 1].index] = f;
  }
  return out;
}

const toCsv = (columns, rows) => {
  const present = columns.filter((c) => rows.some((r) => r.values[c.key] !== undefined));
  return [present.map((c) => c.label).join(','), ...rows.map((r) => present.map((c) => csvCell(r.values[c.key] ?? '')).join(','))].join('\r\n');
};

/** Cleans an uploaded sheet and creates the import proposal. Nothing is imported here. */
export async function fixSheet(ctx, { buffer, kind, fileName = '' }) {
  const K = KINDS[kind];
  if (!K) throw new HttpError(400, 'Choose whether the sheet lists students or staff.');
  if (!buffer?.length) throw new HttpError(400, 'Choose a CSV file to clean.');
  if (buffer.length > IMPORT_LIMITS.maxBytes) throw new HttpError(413, 'That file is too large (2 MB at most).');
  const { text } = decode(buffer);
  let parsed;
  try { parsed = parseCsv(text); } catch (err) { throw new HttpError(400, err.message); }
  const [head, ...body] = parsed.rows;
  if (!head || !body.length) throw new HttpError(400, 'The sheet needs a heading row and at least one row of people.');
  if (body.length > IMPORT_LIMITS.maxRows) throw new HttpError(400, `That sheet has ${body.length} rows. Clean at most ${IMPORT_LIMITS.maxRows} at a time.`);
  const name = String(fileName).replace(/[^\w .()-]/g, '').slice(0, 100) || 'sheet.csv';

  return guardedRun(ctx, { agent: 'setup', input: `${kind} sheet: ${name}` }, async (trace) => {
    const { map, unknown, used } = matchHeader(head.cells, K.columns);
    const columnFixes = [];
    const ai = await matchUnknown(trace, kind, unknown, used);
    for (const u of unknown) {
      const f = ai[u.index];
      if (f) { map[u.index] = f; columnFixes.push({ heading: u.heading, field: K.columns.find((c) => c.key === f).label, by: 'assistant' }); } else columnFixes.push({ heading: u.heading, field: null, by: 'assistant' });
    }
    head.cells.forEach((h, i) => {
      const key = map[i];
      if (key && !unknown.some((u) => u.index === i) && squash(h) !== squash(K.columns.find((c) => c.key === key).label)) {
        columnFixes.push({ heading: tidy(h).slice(0, 60), field: K.columns.find((c) => c.key === key).label, by: 'rule' });
      }
    });
    const cleaned = cleanRows(body, map);
    if (!cleaned.rows.length) throw new HttpError(400, 'No rows with data were found under the headings.');
    const csv = toCsv(K.columns, cleaned.rows);
    // The same check the Students and Setup pages run before an import (missing columns come back as a clear 400)
    const check = await K.analyse(Buffer.from(csv, 'utf8'));
    const s = check.summary;
    return {
      outcome: 'proposed',
      columns: columnFixes,
      fixes: cleaned.fixes,
      fixCounts: cleaned.counts,
      removed: cleaned.removed,
      check: { summary: s, rows: check.rows.slice(0, 200).map(K.row) },
      after: async (runId) => ({
        proposal: await createProposal(ctx, {
          runId, agent: 'setup', kind: K.proposal,
          title: `Import ${s.ready} ${K.noun}${s.ready === 1 ? '' : 's'} from ${name}`,
          summary: `The sheet was cleaned: ${Object.entries(cleaned.counts).map(([w, n]) => `${w.toLowerCase()} (${n})`).join(', ') || 'nothing needed fixing'}. ${s.withErrors ? `${s.withErrors} row${s.withErrors === 1 ? '' : 's'} still ${s.withErrors === 1 ? 'has' : 'have'} problems and will be skipped. ` : ''}Approving imports the ready rows with the normal import.`,
          payload: { kind, fileName: name, csv },
          figures: { rows: body.length, ready: s.ready, withProblems: s.withErrors, duplicatesRemoved: cleaned.removed.length, fixes: Object.values(cleaned.counts).reduce((a, n) => a + n, 0) },
        }),
      }),
    };
  });
}

/** After approval: the existing importers do the import, skipping rows that still have problems. */
export async function applyImport(p, user) {
  const buf = Buffer.from(p.payload.csv, 'utf8');
  const opts = { skipInvalid: true, fileName: p.payload.fileName };
  const r = p.kind === 'staff_import' ? await importStaff(buf, opts, user) : await importStudents(buf, opts, user);
  return { created: r.created, skipped: r.skipped, auditMeta: { created: r.created, skipped: r.skipped } };
}

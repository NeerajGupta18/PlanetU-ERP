/**
 * Bulk staff import from a CSV file, the same way as the student import (services/studentImport.service.js):
 *
 *   analyse(buffer)  reads and checks every row WITHOUT writing anything (the "check before import" screen)
 *   importStaff()    checks again on the server, then creates every accepted row in ONE transaction.
 *
 * A department or designation that does not exist yet is created (and the check screen says so), because a new
 * institute's first staff sheet is usually how those lists come in. Logins are sent later from "Invite people".
 */
import { q } from '../db/pool.js';
import { HttpError } from '../middleware/error.js';
import { audit } from '../db/audit.js';
import { nextNumber } from '../db/series.js';
import { parseCsv } from '../utils/csvParse.js';
import { csvCell } from '../utils/csv.js';
import { EMAIL_RE, IMPORT_LIMITS, clean, decode, parseDate } from './studentImport.service.js';

export const STAFF_COLUMNS = [
  { key: 'name', label: 'name', required: true, aliases: ['fullname', 'staffname', 'employeename', 'teachername'] },
  { key: 'email', label: 'email', required: true, aliases: ['emailid', 'emailaddress', 'mail'] },
  { key: 'department', label: 'department', required: true, aliases: ['dept', 'departmentname'] },
  { key: 'designation', label: 'designation', required: true, aliases: ['role', 'post', 'position', 'title', 'jobtitle'] },
  { key: 'empCode', label: 'staff_id', aliases: ['empcode', 'employeeid', 'employeecode', 'staffcode', 'id', 'empid'] },
  { key: 'joinDate', label: 'join_date', aliases: ['joiningdate', 'dateofjoining', 'doj', 'joined'] },
  { key: 'shift', label: 'shift', aliases: [] },
];

const squash = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
const HEADER_LOOKUP = (() => {
  const m = new Map();
  for (const c of STAFF_COLUMNS) for (const k of [c.key, c.label, ...c.aliases]) m.set(squash(k), c.key);
  return m;
})();
const CODE_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

function validateRow(raw) {
  const errors = []; const warnings = []; const v = {};
  v.name = clean(raw.name);
  if (!v.name) errors.push('Name is missing. Type the person\'s full name.');
  else if (v.name.length > 120) errors.push('Name is too long (120 characters at most).');
  v.email = clean(raw.email).toLowerCase();
  if (!v.email) errors.push('Email is missing. Each staff member needs their own email to sign in.');
  else if (!EMAIL_RE.test(v.email) || v.email.length > 200) errors.push(`"${v.email}" is not a valid email address. Check for spaces or a missing @.`);
  v.department = clean(raw.department);
  if (!v.department) errors.push('Department is missing, for example Science or Office.');
  else if (v.department.length > 80) errors.push('Department is too long (80 characters at most).');
  v.designation = clean(raw.designation);
  if (!v.designation) errors.push('Designation is missing, for example Teacher or Accountant.');
  else if (v.designation.length > 80) errors.push('Designation is too long (80 characters at most).');
  v.empCode = clean(raw.empCode);
  if (v.empCode && (v.empCode.length > 40 || !CODE_RE.test(v.empCode))) errors.push(`Staff ID "${v.empCode}" may only use letters, digits and . _ / - (40 characters at most). Or leave it empty and one is made.`);
  const jd = clean(raw.joinDate);
  v.joinDate = null;
  if (jd) {
    const iso = parseDate(jd);
    if (!iso) errors.push(`Join date "${jd}" is not a date we can read. Use YYYY-MM-DD or DD/MM/YYYY.`); else v.joinDate = iso;
  }
  v.shift = clean(raw.shift).slice(0, 60);
  return { values: v, errors, warnings };
}

export async function analyse(buffer) {
  if (!buffer?.length) throw new HttpError(400, 'The file is empty. Download the template, fill it in and upload it again.');
  if (buffer.length > IMPORT_LIMITS.maxBytes) throw new HttpError(413, `That file is too large (${IMPORT_LIMITS.maxBytes / 1024 / 1024} MB at most). Split it into parts.`);
  const { text, note } = decode(buffer);
  let parsed;
  try { parsed = parseCsv(text); } catch (err) { throw new HttpError(400, err.message); }
  if (!parsed.rows.length) throw new HttpError(400, 'The file has no rows.');
  const [head, ...body] = parsed.rows;
  const columns = new Map(); const unknown = [];
  head.cells.forEach((h, i) => {
    const key = HEADER_LOOKUP.get(squash(String(h).trim()));
    if (!String(h).trim()) return;
    if (!key) unknown.push(String(h).trim()); else if (!columns.has(key)) columns.set(key, i);
  });
  const missing = STAFF_COLUMNS.filter((c) => c.required && !columns.has(c.key)).map((c) => c.label);
  if (missing.length) throw new HttpError(400, `The first row must be a header containing: ${missing.join(', ')}. Download the template to see the expected columns.`);
  if (!body.length) throw new HttpError(400, 'The file has a header but no staff rows.');
  if (body.length > IMPORT_LIMITS.maxRows) throw new HttpError(400, `That file has ${body.length} rows. Import at most ${IMPORT_LIMITS.maxRows} at a time.`);

  const results = body.map((r) => {
    const raw = {};
    for (const [key, idx] of columns) raw[key] = r.cells[idx] ?? '';
    return { line: r.line, ...validateRow(raw) };
  });

  const { rows: depts } = await q('select id, lower(name) as k from departments');
  const { rows: desigs } = await q('select department_id as d, lower(name) as k from designations');
  const deptByName = new Map(depts.map((d) => [d.k, d.id]));
  const desigSet = new Set(desigs.map((g) => `${g.d}|${g.k}`));
  const emails = results.map((r) => r.values.email).filter(Boolean);
  const codes = results.map((r) => r.values.empCode.toLowerCase()).filter(Boolean);
  const { rows: haveEmp } = await q('select lower(email) as v from employees where lower(email) = any($1::text[])', [emails]);
  const { rows: haveUser } = await q('select lower(email) as v from users where lower(email) = any($1::text[])', [emails]);
  const { rows: haveCode } = await q('select lower(emp_code) as v from employees where lower(emp_code) = any($1::text[])', [codes]);
  const takenEmails = new Set([...haveEmp, ...haveUser].map((r) => r.v));
  const takenCodes = new Set(haveCode.map((r) => r.v));

  const firstEmail = new Map(); const firstCode = new Map(); const newDepts = new Set(); const newDesigs = new Set();
  for (const r of results) {
    const v = r.values;
    if (v.email) {
      if (firstEmail.has(v.email)) r.errors.push(`Email ${v.email} is also on line ${firstEmail.get(v.email)}. Each person needs their own email.`);
      else firstEmail.set(v.email, r.line);
      if (takenEmails.has(v.email)) r.errors.push(`Email ${v.email} already belongs to someone here. Remove this row, or use another email.`);
    }
    if (v.empCode) {
      const k = v.empCode.toLowerCase();
      if (firstCode.has(k)) r.errors.push(`Staff ID ${v.empCode} is also on line ${firstCode.get(k)}.`); else firstCode.set(k, r.line);
      if (takenCodes.has(k)) r.errors.push(`Staff ID ${v.empCode} is already used. Change it, or leave it empty and one is made.`);
    }
    if (v.department && v.designation) {
      const dk = v.department.toLowerCase();
      const did = deptByName.get(dk);
      if (!did) { newDepts.add(v.department); r.warnings.push(`Department "${v.department}" is new and will be created.`); }
      if (!did || !desigSet.has(`${did}|${v.designation.toLowerCase()}`)) {
        const key = `${dk}|${v.designation.toLowerCase()}`;
        if (!newDesigs.has(key)) r.warnings.push(`Designation "${v.designation}" in ${v.department} is new and will be created.`);
        newDesigs.add(key);
      }
    }
  }
  const bad = results.filter((r) => r.errors.length);
  return {
    rows: results, unknownColumns: unknown, notes: [note].filter(Boolean),
    summary: {
      rows: results.length, ready: results.length - bad.length, withErrors: bad.length,
      withWarnings: results.filter((r) => !r.errors.length && r.warnings.length).length,
      newDepartments: newDepts.size, newDesignations: newDesigs.size,
    },
  };
}

export const previewRow = (r) => ({
  line: r.line, name: r.values.name, email: r.values.email, department: r.values.department, designation: r.values.designation,
  staffCode: r.values.empCode || null, ok: r.errors.length === 0, errors: r.errors, warnings: r.warnings,
});

export async function importStaff(buffer, { skipInvalid = false, fileName = '' } = {}, admin) {
  const a = await analyse(buffer);
  const bad = a.rows.filter((r) => r.errors.length);
  if (bad.length && !skipInvalid) throw new HttpError(409, `${bad.length} row${bad.length === 1 ? ' has' : 's have'} problems, so nothing was imported. Fix them and upload again, or choose to skip the rows with problems.`);
  const good = a.rows.filter((r) => !r.errors.length);
  if (!good.length) throw new HttpError(400, 'There are no rows without problems to import. Fix the rows listed and upload again.');

  const deptIds = new Map(); const desigIds = new Map();
  const used = new Set(good.map((r) => r.values.empCode.toLowerCase()).filter(Boolean));
  const created = [];
  for (const r of good) {
    const v = r.values;
    const dk = v.department.toLowerCase();
    if (!deptIds.has(dk)) {
      const { rows: [d] } = await q('select id from departments where lower(name) = $1', [dk]);
      deptIds.set(dk, d?.id || (await q('insert into departments (name) values ($1) returning id', [v.department])).rows[0].id);
    }
    const did = deptIds.get(dk);
    const gk = `${did}|${v.designation.toLowerCase()}`;
    if (!desigIds.has(gk)) {
      const { rows: [g] } = await q('select id from designations where department_id = $1 and lower(name) = lower($2)', [did, v.designation]);
      desigIds.set(gk, g?.id || (await q('insert into designations (department_id, name) values ($1, $2) returning id', [did, v.designation])).rows[0].id);
    }
    let code = v.empCode;
    while (!code) {
      const c = await nextNumber('employee', { prefix: 'EMP', padding: 3 });
      if (!used.has(c.toLowerCase()) && !(await q('select 1 from employees where lower(emp_code) = lower($1)', [c])).rowCount) { code = c; used.add(c.toLowerCase()); }
    }
    try {
      await q(
        `insert into employees (emp_code, name, email, department_id, designation_id, shift, join_date)
         values ($1, $2, $3, $4, $5, $6, coalesce($7::date, current_date))`,
        [code, v.name, v.email, did, desigIds.get(gk), v.shift || 'Employee shift', v.joinDate],
      );
    } catch (err) {
      if (err.code === '23505') throw new HttpError(409, `Line ${r.line}: ${v.email} or staff ID ${code} was added by someone else just now. Nothing was imported; upload the file again.`);
      throw err;
    }
    created.push({ line: r.line, staffCode: code });
  }
  await audit(admin, 'staff.import', 'employee', null, { file: String(fileName).slice(0, 100), created: created.length, skipped: bad.length });
  const codeOf = new Map(created.map((c) => [c.line, c.staffCode]));
  return {
    created: created.length, skipped: bad.length,
    rows: a.rows.map((r) => ({ line: r.line, name: r.values.name, status: r.errors.length ? 'skipped' : 'created', staffCode: codeOf.get(r.line) || null, reason: r.errors.join(' ') })),
  };
}

export function templateCsv() {
  const header = STAFF_COLUMNS.map((c) => c.label);
  const samples = [
    { name: 'Priya Nair', email: 'priya.nair@example.com', department: 'Science', designation: 'Teacher', staff_id: '', join_date: '2025-06-01', shift: '' },
    { name: 'Rahul Mehta', email: 'rahul.mehta@example.com', department: 'Office', designation: 'Accountant', staff_id: '', join_date: '01/06/2025', shift: '' },
  ];
  const lines = [header.map(csvCell).join(','), ...samples.map((s) => header.map((h) => csvCell(s[h] ?? '')).join(','))];
  return `﻿${lines.join('\r\n')}\r\n`;
}

import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import {
  AlertTriangle, BadgeIndianRupee, Banknote, CalendarOff, ClipboardCheck, FileSpreadsheet, History, Inbox, MailQuestion, MessageSquareText,
  Send, Sparkles, UserCheck, Users2, Wand2,
} from 'lucide-react';
import { api } from '../../api/http.js';
import { useFetch } from '../../hooks/useFetch.js';
import { useTabParam } from '../../hooks/useTabParam.js';
import { Badge, Card, FormField, PageHeader, StatCard, Tabs, pending } from '../../components/ui/Ui.jsx';
import { DataBoundary, EmptyState } from '../../components/ui/Feedback.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import Modal from '../../components/ui/Modal.jsx';
import { useDialogs } from '../../components/ui/Dialogs.jsx';
import { inr0 } from '../../utils/billing.js';
import { inrShort } from '../../utils/kpi.js';
import { fmtDate } from '../../utils/dates.js';

const QUICK = [
  'Which classes had the lowest attendance this week?',
  'How much fee is overdue, and how many students?',
  'How many students are below 75% attendance?',
  'How much was collected this month?',
  'What is waiting for a decision?',
];
const STATUS = { pending: ['amber', 'Waiting'], approved: ['green', 'Approved'], rejected: ['gray', 'Rejected'], failed: ['red', 'Failed'] };
const AGENT = { ask: 'Ask PlanetU', brief: 'Morning brief', fees: 'Fee follow-up', setup: 'Setup fixer', attendance: 'Attendance watch', admissions: 'Admissions helper' };
const AGENT_ICON = { fees: BadgeIndianRupee, setup: FileSpreadsheet, attendance: UserCheck, admissions: MailQuestion };
const LANGUAGE_OPTIONS = <><option value="en">English</option><option value="hi">Hindi</option><option value="mr">Marathi</option></>;
const OUTCOME = { answered: 'Answered', proposed: 'Proposal made', refused: 'Nothing to do', busy: 'Busy', capped: 'Allowance used up', error: 'Failed' };
const words = (k) => k.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
const num = (v) => (typeof v === 'number' ? v.toLocaleString('en-IN') : v ?? '');

/**
 * The AI assistants: questions, morning brief, fee follow-up, sheet cleaning, attendance watch, admissions helper
 * and the approval inbox. Class teachers open the same page at /employee/assistants.
 */
export default function Assistants() {
  const { pathname } = useLocation();
  const { data: status, loading, error, reload } = useFetch('/assistants/status');
  const inbox = useFetch(status?.can.inbox ? '/assistants/proposals' : null);
  const can = status?.can || {};
  const tabs = [
    can.ask && { id: 'ask', label: 'Ask PlanetU', icon: MessageSquareText },
    can.attendance && { id: 'attendance', label: 'Attendance watch', icon: UserCheck },
    can.fees && { id: 'fees', label: 'Fee follow-up', icon: BadgeIndianRupee },
    can.admissions && { id: 'admissions', label: 'Admissions helper', icon: MailQuestion },
    (can.setupStudents || can.setupStaff) && { id: 'setup', label: 'Setup fixer', icon: Wand2 },
    can.inbox && { id: 'inbox', label: `Approvals${inbox.data?.pending ? ` (${inbox.data.pending})` : ''}`, icon: Inbox },
    can.log && { id: 'log', label: 'Activity', icon: History },
  ].filter(Boolean);
  const [tab, setTab] = useTabParam(tabs[0]?.id || 'ask', tabs.map((t) => t.id));
  const active = tabs.some((t) => t.id === tab) ? tab : tabs[0]?.id;
  const refresh = () => { reload(); inbox.reload(); };

  return (
    <>
      <PageHeader
        icon={Sparkles} title="Assistants"
        subtitle="AI helpers that read your institute's records and prepare work. Nothing changes until a person approves it."
        next={inbox.data?.pending ? { text: `${inbox.data.pending} proposal${inbox.data.pending === 1 ? '' : 's'} waiting for your decision`, to: `${pathname}?tab=inbox` } : undefined}
      />
      <DataBoundary loading={loading} error={error} data={status} reload={reload}>
        {status && (
          <>
            <div className={`wizard-note ${status.connected ? '' : 'wizard-note--warn'} ai-status`} role="status">
              {status.connected
                ? <><Badge tone="green">Connected</Badge> AI model: {status.model}. Used today: {num(status.tokensToday)} of {num(status.dailyTokens)} tokens.</>
                : <><Badge tone="amber">Not connected</Badge> The assistants need a model key, which your technical person adds on the server. Everything else in the ERP works as usual, and the morning brief figures still show.</>}
            </div>
            {!tabs.length ? <Card><EmptyState title="No assistant for your role" hint="The assistants are for the principal, the accountant, the admission office, class teachers and the institute admin." /></Card> : (
              <>
                <Tabs tabs={tabs} active={active} onChange={setTab} />
                {active === 'ask' && <AskTab connected={status.connected} />}
                {active === 'attendance' && <AttendanceTab connected={status.connected} onProposal={refresh} openInbox={() => setTab('inbox')} />}
                {active === 'admissions' && <AdmissionsTab connected={status.connected} onProposal={refresh} openInbox={() => setTab('inbox')} />}
                {active === 'fees' && <FeesTab connected={status.connected} onProposal={refresh} openInbox={() => setTab('inbox')} />}
                {active === 'setup' && <SetupTab connected={status.connected} can={can} onProposal={refresh} openInbox={() => setTab('inbox')} />}
                {active === 'inbox' && <InboxTab inbox={inbox} onDecided={refresh} />}
                {active === 'log' && <LogTab />}
              </>
            )}
          </>
        )}
      </DataBoundary>
    </>
  );
}

const AiLabel = ({ text = 'Written by AI' }) => <span className="ai-label"><Sparkles size={13} aria-hidden="true" /> {text}</span>;

/** The model's text as plain paragraphs; its **bold** marks become bold, nothing else is interpreted. */
const AiText = ({ text }) => String(text).split(/\n{2,}/).map((para, i) => (
  <p key={i}>{para.split(/\*\*(.+?)\*\*/g).map((part, j) => (j % 2 ? <strong key={j}>{part}</strong> : part))}</p>
));

/* ---------------- Ask PlanetU ---------------- */

function AskTab({ connected }) {
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState(null);
  const [err, setErr] = useState('');
  const ask = async (text) => {
    const qn = (text ?? question).trim();
    if (!qn) return;
    setQuestion(qn); setBusy(true); setErr(''); setAnswer(null);
    try { setAnswer(await api.post('/assistants/ask', { question: qn })); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <>
      <MorningBrief connected={connected} />
      <Card title="Ask a question" icon={MessageSquareText}>
        <form className="ask-form" onSubmit={(e) => { e.preventDefault(); ask(); }}>
          <FormField label="Your question" hint="Plain words are fine. The answer shows the figures it used.">
            <input className="input" value={question} maxLength={300} onChange={(e) => setQuestion(e.target.value)} placeholder="For example: Which classes had the lowest attendance this week?" disabled={!connected} />
          </FormField>
          <button type="submit" className="btn btn--primary" disabled={!connected || busy || question.trim().length < 3}>{busy ? 'Thinking...' : 'Ask'}</button>
        </form>
        <div className="chips ask-quick" aria-label="Quick questions">
          {QUICK.map((qn) => <button key={qn} type="button" className="chip" disabled={!connected || busy} onClick={() => ask(qn)}>{qn}</button>)}
        </div>
        <div role="status" aria-live="polite" aria-busy={busy}>
          {err && <p className="form-error" role="alert"><AlertTriangle size={14} aria-hidden="true" /> {err}</p>}
          {answer && (
            <div className="ai-answer">
              <AiLabel />
              <AiText text={answer.answer} />
              {!answer.grounded && <p className="note">The assistant's wording did not match the figures, so only the figures are shown.</p>}
            </div>
          )}
        </div>
        {answer?.figures?.length > 0 && <FiguresUsed figures={answer.figures} />}
      </Card>
    </>
  );
}

/** Every figure the answer used, exactly as the database gave it. */
function FiguresUsed({ figures }) {
  return (
    <div className="figures">
      <h3 className="figures__title">Figures used</h3>
      {figures.map((f, i) => {
        const { tool, args, label, ...rest } = f;
        const lists = Object.entries(rest).filter(([, v]) => Array.isArray(v));
        const values = Object.entries(rest).filter(([k, v]) => !Array.isArray(v) && (typeof v !== 'object' || v === null) && k !== 'from' && k !== 'to');
        return (
          <div key={`${tool}-${i}`} className="figures__block">
            <strong>{label}</strong>
            {values.length > 0 && (
              <dl className="figures__values">
                {values.map(([k, v]) => <div key={k}><dt>{words(k)}</dt><dd>{num(v)}</dd></div>)}
              </dl>
            )}
            {lists.map(([k, rows]) => (rows.length ? (
              <DataTable
                key={k} caption={words(k)} rows={rows.map((r, n) => ({ ...r, _k: n }))} rowKey="_k"
                columns={Object.keys(rows[0]).map((c) => ({ key: c, label: words(c), num: typeof rows[0][c] === 'number', render: (r) => num(r[c]) }))}
              />
            ) : <p key={k} className="muted">{words(k)}: none.</p>))}
          </div>
        );
      })}
    </div>
  );
}

function MorningBrief({ connected }) {
  const { data, loading, error, reload } = useFetch('/assistants/brief');
  const [summary, setSummary] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const f = data?.figures || {};
  const overall = (fig) => {
    if (!fig?.classes?.length) return null;
    const a = fig.classes.reduce((s, c) => s + c.attended, 0); const m = fig.classes.reduce((s, c) => s + c.marks, 0);
    return m ? `${Math.round((a / m) * 1000) / 10}%` : null;
  };
  const lowest = f.attendanceWeek?.classes?.[0];
  const explain = async () => {
    setBusy(true); setErr('');
    try { setSummary(await api.post('/assistants/brief/summary')); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <Card title="Morning brief" icon={Sparkles} action={connected && <button type="button" className="btn btn--outline btn--sm" onClick={explain} disabled={busy}>{busy ? 'Writing...' : 'Explain in plain words'}</button>}>
      <DataBoundary loading={loading} error={error} data={data} reload={reload}>
        {data && (
          <>
            <div className="stats">
              {f.attendanceYesterday && <StatCard value={overall(f.attendanceYesterday)} label="Attendance yesterday" icon={ClipboardCheck} to="/admin/attendance" />}
              {f.attendanceWeek && <StatCard value={lowest ? `${lowest.percent}%` : null} label={lowest ? `Lowest this week: ${lowest.class}` : 'Lowest class this week'} icon={ClipboardCheck} to="/admin/attendance" />}
              {f.below75 && <StatCard value={num(f.below75.count)} label="Students below 75% this term" icon={Users2} {...pending(f.below75.count, { act: 'Follow up' })} />}
              {f.dues && <StatCard value={inrShort(f.dues.overdue)} sub={inr0(f.dues.overdue)} label={`Overdue fees (${f.dues.students_overdue} students)`} icon={BadgeIndianRupee} to="/admin/fees" {...pending(f.dues.overdue, { level: 'bad', act: 'Past the due date', clear: 'Nothing overdue' })} />}
              {f.collectedYesterday && <StatCard value={inr0(f.collectedYesterday.total)} label={`Collected yesterday (${f.collectedYesterday.receipts} receipts)`} icon={Banknote} />}
              {f.waiting && <StatCard value={num(f.waiting.approvals + f.waiting.assistant_proposals)} label="Waiting for a decision" icon={Inbox} to="/admin/approvals" {...pending(f.waiting.approvals + f.waiting.assistant_proposals)} />}
              {f.onLeave && <StatCard value={num(f.onLeave.count)} label="Staff on leave today" icon={CalendarOff} sub={f.onLeave.staff.map((s) => `${s.first_name} (${s.code})`).join(', ')} />}
              {f.admissions && <StatCard value={num(f.admissions.by_stage.find((s) => s.status === 'submitted')?.applications ?? 0)} label="Applications to review" icon={ClipboardCheck} to="/admin/admissions" />}
            </div>
            {err && <p className="form-error" role="alert">{err}</p>}
            {summary && (
              <div className="ai-answer" role="status">
                <AiLabel />
                <AiText text={summary.summary || 'The assistant\'s wording did not match the figures, so only the figures are shown.'} />
              </div>
            )}
          </>
        )}
      </DataBoundary>
    </Card>
  );
}

/* ---------------- Fee follow-up ---------------- */

function FeesTab({ connected, onProposal, openInbox }) {
  const { data, loading, error, reload } = useFetch('/assistants/fees/overview');
  const [language, setLanguage] = useState('en');
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState(null);
  const [err, setErr] = useState('');
  const make = async () => {
    setBusy(true); setErr(''); setDraft(null);
    try { setDraft(await api.post('/assistants/fees/draft', { language })); onProposal(); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <>
      <Card title="Overdue fees, by guardian" icon={BadgeIndianRupee}>
        <DataBoundary loading={loading} error={error} data={data} reload={reload}>
          {data && (
            <>
              <div className="stats stats--3">
                <StatCard value={num(data.guardians)} label="Guardians to remind" icon={Users2} />
                <StatCard value={num(data.students)} label="Students with overdue fees" icon={Users2} />
                <StatCard value={inrShort(data.overdueTotal)} sub={inr0(data.overdueTotal)} label="Overdue in all" icon={BadgeIndianRupee} {...pending(data.overdueTotal, { level: 'bad', act: 'Past the due date', clear: 'Nothing overdue' })} />
              </div>
              <DataTable
                caption="Guardians with overdue fees" rows={data.groups} rowKey="key"
                empty={{ title: 'Nothing is overdue', hint: 'When a fee passes its due date unpaid, the guardian appears here.' }}
                columns={[
                  { key: 'guardian', label: 'Guardian', render: (g) => <strong>{g.guardian}</strong> },
                  { key: 'students', label: 'Children', render: (g) => g.students.map((s) => `${s.name} (${s.code})`).join(', ') },
                  { key: 'overdue', label: 'Overdue', num: true, render: (g) => inr0(g.overdue) },
                  { key: 'since', label: 'Oldest due', render: (g) => fmtDate(g.oldestDue) },
                  { key: 'phone', label: 'WhatsApp', render: (g) => (g.hasPhone ? <Badge tone="green">Mobile on file</Badge> : <Badge tone="gray">No mobile</Badge>) },
                ]}
              />
            </>
          )}
        </DataBoundary>
      </Card>
      {data?.guardians > 0 && (
        <Card title="Draft one reminder" icon={Send}>
          <p className="muted">The assistant writes one reminder in the language you choose, with blanks for the name and amount. The system fills those from the records when you approve, so the assistant never sees names, phone numbers or amounts.</p>
          <div className="ask-form">
            <FormField label="Language">
              <select className="input" value={language} onChange={(e) => setLanguage(e.target.value)}>{LANGUAGE_OPTIONS}</select>
            </FormField>
            <button type="button" className="btn btn--primary" onClick={make} disabled={!connected || busy}>{busy ? 'Drafting...' : 'Draft the reminder'}</button>
          </div>
          {err && <p className="form-error" role="alert">{err}</p>}
          {draft && (
            <div className="ai-answer" role="status">
              <AiLabel />
              <p className="ai-template">{draft.template}</p>
              {draft.usedStandard && <p className="note">{draft.standardReason}</p>}
              <p><strong>{draft.proposal.title}</strong> is ready and waiting for approval. Nothing has been sent.</p>
              <button type="button" className="btn btn--outline btn--sm" onClick={openInbox}>Open approvals</button>
            </div>
          )}
        </Card>
      )}
    </>
  );
}

/* ---------------- Setup fixer ---------------- */

function SetupTab({ connected, can, onProposal, openInbox }) {
  const [kind, setKind] = useState(can.setupStudents ? 'students' : 'staff');
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState(null);
  const [err, setErr] = useState('');
  const clean = async (e) => {
    e.preventDefault();
    if (!file) return;
    const fd = new FormData(); fd.append('kind', kind); fd.append('file', file);
    setBusy(true); setErr(''); setOut(null);
    try { setOut(await api.post('/assistants/setup/clean', fd)); onProposal(); } catch (e2) { setErr(e2.message); } finally { setBusy(false); }
  };
  const s = out?.check.summary;
  return (
    <>
      <Card title="Clean a messy sheet" icon={FileSpreadsheet}>
        <p className="muted">Upload a CSV of {kind === 'staff' ? 'staff' : 'students'} as it is. The fixer matches the columns, tidies names, phone numbers, emails and dates, and removes duplicate rows, explaining every change. It imports only after someone approves.</p>
        <form className="ask-form" onSubmit={clean}>
          {can.setupStudents && can.setupStaff && (
            <FormField label="The sheet lists">
              <select className="input" value={kind} onChange={(e) => setKind(e.target.value)}><option value="students">Students</option><option value="staff">Staff</option></select>
            </FormField>
          )}
          <FormField label="CSV file" hint="In Excel: File, Save As, CSV UTF-8.">
            <input type="file" accept=".csv,text/csv,text/plain" className="input" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          </FormField>
          <button type="submit" className="btn btn--primary" disabled={!connected || !file || busy}>{busy ? 'Cleaning...' : 'Clean the sheet'}</button>
        </form>
        {err && <p className="form-error" role="alert">{err}</p>}
      </Card>
      {out && (
        <>
          <Card title="What was fixed" icon={Wand2}>
            <div className="stats stats--3">
              <StatCard value={num(s.ready)} label="Rows ready to import" icon={ClipboardCheck} status="good" hint="Ready" />
              <StatCard value={num(s.withErrors)} label="Rows still with problems" icon={AlertTriangle} {...pending(s.withErrors, { level: 'bad', act: 'Will be skipped', clear: 'None' })} />
              <StatCard value={num(out.removed.length)} label="Duplicate rows removed" icon={Users2} />
            </div>
            {out.columns.length > 0 && (
              <DataTable
                caption="Column matches" rows={out.columns.map((c, i) => ({ ...c, i }))} rowKey="i"
                columns={[
                  { key: 'heading', label: 'Heading in your sheet' },
                  { key: 'field', label: 'Used as', render: (c) => c.field || <span className="muted">Not used</span> },
                  { key: 'by', label: 'Matched by', render: (c) => (c.by === 'assistant' ? <AiLabel text="Matched by AI" /> : 'Known spelling') },
                ]}
              />
            )}
            <ul className="fix-counts">
              {Object.entries(out.fixCounts).map(([why, n]) => <li key={why}>{why}: <strong>{n}</strong></li>)}
            </ul>
            <DataTable
              caption="Every change" rows={out.fixes.map((f, i) => ({ ...f, i }))} rowKey="i"
              empty={{ title: 'Nothing needed fixing', hint: 'The sheet was already clean.' }}
              columns={[
                { key: 'line', label: 'Line', num: true },
                { key: 'field', label: 'Column', render: (f) => words(f.field.replace(/([A-Z])/g, '_$1').toLowerCase()) },
                { key: 'from', label: 'Was', render: (f) => <code>{f.from}</code> },
                { key: 'to', label: 'Now', render: (f) => <code>{f.to}</code> },
                { key: 'why', label: 'Why' },
              ]}
            />
            {out.removed.length > 0 && <p className="note">Removed as duplicates: {out.removed.map((r) => `line ${r.line} (same as line ${r.sameAs})`).join(', ')}.</p>}
          </Card>
          <Card title="Check before import" icon={ClipboardCheck}>
            <ImportRows rows={out.check.rows} />
            <p><strong>{out.proposal.title}</strong> is waiting for approval. Nothing has been imported yet.</p>
            <button type="button" className="btn btn--outline btn--sm" onClick={openInbox}>Open approvals</button>
          </Card>
        </>
      )}
    </>
  );
}

function ImportRows({ rows }) {
  return (
    <DataTable
      caption="Rows after cleaning" rows={rows} rowKey="line"
      columns={[
        { key: 'line', label: 'Line', num: true },
        { key: 'name', label: 'Name', render: (r) => <strong>{r.name}</strong> },
        { key: 'email', label: 'Email' },
        { key: 'ok', label: 'Check', render: (r) => (r.ok ? <Badge tone="green">Ready</Badge> : <><Badge tone="red">Will be skipped</Badge> <small>{r.errors.join(' ')}</small></>) },
      ]}
    />
  );
}

/* ---------------- Attendance watch ---------------- */

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Why a student is on the list, always in words (never colour alone). */
function Reasons({ s, minimum }) {
  return (
    <span className="chips">
      {s.threeInARow && <Badge tone="red">Absent 3 days in a row</Badge>}
      {s.level === 'below' && <Badge tone="red">Below {minimum}%</Badge>}
      {s.level === 'near' && <Badge tone="amber">Close to {minimum}%</Badge>}
      {!s.flagged && s.flagged !== undefined && <Badge tone="green">Improved since</Badge>}
    </span>
  );
}

function AttendanceTab({ connected, onProposal, openInbox }) {
  const [courseId, setCourseId] = useState('');
  const { data, loading, error, reload } = useFetch(`/assistants/attendance/overview${courseId ? `?courseId=${courseId}` : ''}`);
  const [language, setLanguage] = useState('en');
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState(null);
  const [err, setErr] = useState('');
  const make = async () => {
    setBusy(true); setErr(''); setDraft(null);
    try { setDraft(await api.post('/assistants/attendance/draft', { language, courseId: courseId || undefined })); onProposal(); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <>
      <Card
        title="Students who need a word with home" icon={UserCheck}
        action={data?.classes?.length > 1 && (
          <select className="input input--sm" aria-label="Class" value={courseId} onChange={(e) => setCourseId(e.target.value)}>
            <option value="">All my classes</option>
            {data.classes.map((c) => <option key={c.id} value={c.id}>{c.code}</option>)}
          </select>
        )}
      >
        <DataBoundary loading={loading} error={error} data={data} reload={reload}>
          {data && (
            <>
              <p className="muted">Absent on each of their last three days of registers, or below or within {data.nearBy} points of the {data.minimum}% minimum this term. Worked out from submitted registers only.</p>
              <div className="stats">
                <StatCard value={num(data.counts.flagged)} label={`Flagged of ${num(data.watched)} students`} icon={Users2} {...pending(data.counts.flagged, { act: 'Draft a note', clear: 'Nobody flagged' })} />
                <StatCard value={num(data.counts.threeInARow)} label="Absent 3 days in a row" icon={CalendarOff} />
                <StatCard value={num(data.counts.below)} label={`Below ${data.minimum}%`} icon={AlertTriangle} />
                <StatCard value={num(data.counts.near)} label={`Close to ${data.minimum}%`} icon={ClipboardCheck} />
              </div>
              <DataTable
                caption="Flagged students" rows={data.students} rowKey="id"
                empty={{ title: 'Nobody needs a note', hint: 'When a student misses three days in a row or slips near the minimum, they appear here.' }}
                columns={[
                  { key: 'name', label: 'Student', render: (s) => <><strong>{s.name}</strong> <small className="muted">{s.code}</small></> },
                  { key: 'classCode', label: 'Class' },
                  { key: 'percent', label: 'This term', num: true, render: (s) => `${s.percent}%` },
                  { key: 'why', label: 'Why', render: (s) => <Reasons s={s} minimum={data.minimum} /> },
                  { key: 'parent', label: 'Parent', render: (s) => (s.parentLinked ? <Badge tone="green">In the app</Badge> : s.hasPhone ? <Badge tone="blue">Mobile on file</Badge> : <Badge tone="gray">No contact</Badge>) },
                ]}
              />
            </>
          )}
        </DataBoundary>
      </Card>
      {data?.counts.flagged > 0 && (
        <Card title="Draft one parent note" icon={Send}>
          <p className="muted">The assistant writes one caring note in the language you choose, with blanks for the name and attendance. The system fills those from the registers when you approve, so the assistant never sees names, phone numbers or figures.</p>
          <div className="ask-form">
            <FormField label="Language">
              <select className="input" value={language} onChange={(e) => setLanguage(e.target.value)}>{LANGUAGE_OPTIONS}</select>
            </FormField>
            <button type="button" className="btn btn--primary" onClick={make} disabled={!connected || busy}>{busy ? 'Drafting...' : `Draft a note for ${plural(data.counts.flagged, 'parent')}`}</button>
          </div>
          {err && <p className="form-error" role="alert">{err}</p>}
          {draft && <DraftReady draft={draft} text={draft.template} openInbox={openInbox} nothing="Nothing has been sent." />}
        </Card>
      )}
    </>
  );
}

/** The drafted text, labelled as AI, and the proposal now waiting. */
function DraftReady({ draft, text, openInbox, nothing }) {
  return (
    <div className="ai-answer" role="status">
      <AiLabel />
      <p className="ai-template">{text}</p>
      {draft.usedStandard && <p className="note">{draft.standardReason}</p>}
      <p><strong>{draft.proposal.title}</strong> is ready and waiting for approval. {nothing}</p>
      <button type="button" className="btn btn--outline btn--sm" onClick={openInbox}>Open approvals</button>
    </div>
  );
}

/* ---------------- Admissions helper ---------------- */

const DOC_TONE = { verified: ['green', 'Checked'], uploaded: ['blue', 'Uploaded, to check'], pending: ['blue', 'Uploaded, to check'], rejected: ['red', 'Rejected'], missing: ['amber', 'Missing'] };
const APP_STATUS = { draft: 'Enquiry', submitted: 'Submitted', documents_pending: 'Waiting for documents', waitlisted: 'Waitlisted', accepted: 'Accepted', rejected: 'Rejected', enrolled: 'Enrolled' };

/** Documents, possible duplicates and the suggested next step: all worked out from the records, no AI. */
function ApplicationCheck({ documents, duplicates, nextStep }) {
  return (
    <>
      <div className="wizard-note" role="status"><strong>Suggested next step:</strong> {nextStep} <span className="muted">A suggestion only: every decision stays with the admission office.</span></div>
      <DataTable
        caption="Required documents" rows={documents} rowKey="docType"
        columns={[
          { key: 'label', label: 'Document', render: (d) => d.label[0].toUpperCase() + d.label.slice(1) },
          { key: 'status', label: 'Status', render: (d) => <Badge tone={DOC_TONE[d.status]?.[0] || 'gray'}>{DOC_TONE[d.status]?.[1] || d.status}</Badge> },
        ]}
      />
      {duplicates.length > 0
        ? (
          <DataTable
            caption="Possible duplicates" rows={duplicates.map((d, i) => ({ ...d, i }))} rowKey="i"
            columns={[
              { key: 'ref', label: 'Record', render: (d) => <strong>{d.ref}</strong> },
              { key: 'kind', label: 'Kind', render: (d) => (d.kind === 'student' ? 'Student' : 'Application') },
              { key: 'status', label: 'Status', render: (d) => APP_STATUS[d.status] || d.status },
              { key: 'matched', label: 'Same', render: (d) => d.matched.join(', ') },
            ]}
          />
        )
        : <p className="muted">No possible duplicate found (same email, mobile, or name and date of birth).</p>}
    </>
  );
}

function AdmissionsTab({ connected, onProposal, openInbox }) {
  const list = useFetch('/assistants/admissions/applications');
  const [id, setId] = useState('');
  const check = useFetch(id ? `/assistants/admissions/check/${id}` : null);
  const [message, setMessage] = useState('');
  const [language, setLanguage] = useState('en');
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState(null);
  const [err, setErr] = useState('');
  const help = async (e) => {
    e.preventDefault();
    setBusy(true); setErr(''); setOut(null);
    try { setOut(await api.post('/assistants/admissions/help', { applicationId: id, message, language })); onProposal(); } catch (e2) { setErr(e2.message); } finally { setBusy(false); }
  };
  const apps = list.data?.applications || [];
  return (
    <>
      <Card title="Check an enquiry and draft the reply" icon={MailQuestion}>
        <DataBoundary loading={list.loading} error={list.error} data={list.data} reload={list.reload}>
          {list.data && (apps.length === 0
            ? <EmptyState compact title="No open applications" hint="Enquiries and submitted applications appear here. Add one from Admissions." action={{ label: 'Open Admissions', to: '/admin/admissions' }} />
            : (
              <form className="review-grid" onSubmit={help}>
                <FormField label="Application">
                  <select className="input" value={id} onChange={(e) => { setId(e.target.value); setOut(null); }}>
                    <option value="">Choose an application</option>
                    {apps.map((a) => <option key={a.id} value={a.id}>{a.applicationNo}: {a.name}, {a.course} ({APP_STATUS[a.status] || a.status})</option>)}
                  </select>
                </FormField>
                {id && (
                  <>
                    <DataBoundary loading={check.loading} error={check.error} data={check.data} reload={check.reload}>
                      {check.data && <ApplicationCheck {...check.data} />}
                    </DataBoundary>
                    <FormField label="Their message (optional)" hint="Paste the applicant's email or WhatsApp message. It is read as information only, never as instructions, and phone numbers and emails are removed before the assistant sees it.">
                      <textarea className="input" rows={4} maxLength={2000} value={message} onChange={(e) => setMessage(e.target.value)} />
                    </FormField>
                    <div className="ask-form">
                      <FormField label="Reply language">
                        <select className="input" value={language} onChange={(e) => setLanguage(e.target.value)}>{LANGUAGE_OPTIONS}</select>
                      </FormField>
                      <button type="submit" className="btn btn--primary" disabled={!connected || busy}>{busy ? 'Drafting...' : 'Draft the reply'}</button>
                    </div>
                  </>
                )}
              </form>
            ))}
        </DataBoundary>
        {err && <p className="form-error" role="alert">{err}</p>}
        {out && <DraftReady draft={out} text={out.reply} openInbox={openInbox} nothing="Nothing has been sent, and the application has not changed." />}
      </Card>
    </>
  );
}

/* ---------------- Approval inbox ---------------- */

function InboxTab({ inbox, onDecided }) {
  const [open, setOpen] = useState(null);
  const { data, loading, error, reload } = inbox;
  return (
    <Card title="Proposals from the assistants" icon={Inbox}>
      <DataBoundary loading={loading} error={error} data={data} reload={reload}>
        {data && (data.proposals.length === 0
          ? <EmptyState compact title="Nothing is waiting" hint="When an assistant prepares reminders, notes, a reply or an import, it waits here for your approval." />
          : data.proposals.map((p) => (
            <div key={p.id} className="approval">
              <span className="approval__icon" aria-hidden="true">{(() => { const Icon = AGENT_ICON[p.agent] || FileSpreadsheet; return <Icon size={18} />; })()}</span>
              <div className="approval__main">
                <div><Badge tone={STATUS[p.status][0]}>{STATUS[p.status][1]}</Badge> <strong>{p.title}</strong></div>
                <span>{p.summary}</span>
                <small>Prepared by {AGENT[p.agent]} for {p.createdBy || 'a former user'}, {fmtDate(String(p.createdAt).slice(0, 10))}{p.decidedBy ? `. ${STATUS[p.status][1]} by ${p.decidedBy}` : ''}</small>
              </div>
              <div className="approval__actions">
                <button type="button" className={`btn btn--sm ${p.status === 'pending' ? 'btn--primary' : 'btn--outline'}`} onClick={() => setOpen(p.id)}>{p.status === 'pending' ? 'Review' : 'View'}</button>
              </div>
            </div>
          )))}
      </DataBoundary>
      {open && <ProposalModal id={open} onClose={() => setOpen(null)} onDecided={() => { onDecided(); }} />}
    </Card>
  );
}

// What "Approve" says and does, per kind of proposal (imports fall back to "Import")
const APPROVE = {
  fee_reminders: (p) => ({ what: `Send ${plural(p.toSend, 'reminder')} now? Each guardian gets the message in the app, and WhatsApp links are prepared.`, label: `Send ${p.toSend}` }),
  parent_notes: (p) => ({ what: `Send ${plural(p.toSend, 'parent note')} now? Parents get the note in the app, and WhatsApp links are prepared.`, label: `Send ${p.toSend}` }),
  enquiry_reply: (p) => ({ what: `Send this reply to ${p.application?.applicationNo} by email now? The application itself does not change.`, label: 'Send reply' }),
};
const APPROVE_BUTTON = {
  fee_reminders: (p) => `Send ${plural(p.toSend, 'reminder')}`,
  parent_notes: (p) => `Send ${plural(p.toSend, 'note')}`,
  enquiry_reply: () => 'Send the reply',
};

function ProposalModal({ id, onClose, onDecided }) {
  const { data: p, loading, error, reload } = useFetch(`/assistants/proposals/${id}`);
  const { confirm, prompt, toast } = useDialogs();
  const [busy, setBusy] = useState(false);
  const decide = async (decision) => {
    let note = '';
    if (decision === 'approve') {
      const { what, label } = APPROVE[p.kind]?.(p) || { what: `${p.title}? The ready rows are imported now.`, label: 'Import' };
      if (!(await confirm(what, { title: 'Approve', confirmLabel: label }))) return;
    } else {
      note = await prompt('Why is this not approved? (optional)', { title: 'Reject', confirmLabel: 'Reject', danger: true });
      if (note === null) return;
    }
    setBusy(true);
    try {
      const r = await api.post(`/assistants/proposals/${id}/decide`, { decision, note });
      if (r.status === 'failed') toast.error(`Could not apply it: ${r.result.error}`);
      else toast.success(decision === 'approve' ? 'Approved and done.' : 'Rejected. Nothing was changed.');
      reload(); onDecided();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal open title={p?.title || 'Proposal'} onClose={onClose} width={760}>
      <DataBoundary loading={loading} error={error} data={p} reload={reload}>
        {p && (
          <div className="review-grid">
            <div><Badge tone={STATUS[p.status][0]}>{STATUS[p.status][1]}</Badge> <span className="muted">{p.summary}</span></div>
            {p.status === 'pending' && (
              <div className="form-actions proposal-actions">
                <button type="button" className="btn btn--outline" onClick={() => decide('reject')} disabled={busy}>Reject</button>
                <button type="button" className="btn btn--primary" onClick={() => decide('approve')} disabled={busy || ((p.kind === 'fee_reminders' || p.kind === 'parent_notes') && !p.toSend) || (p.kind === 'enquiry_reply' && !p.application)}>
                  {APPROVE_BUTTON[p.kind]?.(p) || 'Approve and import'}
                </button>
              </div>
            )}
            {p.kind === 'fee_reminders' && <FeeProposal p={p} />}
            {p.kind === 'parent_notes' && <NotesProposal p={p} />}
            {p.kind === 'enquiry_reply' && <ReplyProposal p={p} />}
            {(p.kind === 'student_import' || p.kind === 'staff_import') && (
              <>
                <p className="muted">From the file {p.fileName}: {p.check.summary.ready} ready, {p.check.summary.withErrors} will be skipped.</p>
                <ImportRows rows={p.check.rows} />
              </>
            )}
            {p.result?.error && <p className="form-error">Could not apply it: {p.result.error}</p>}
            {p.decisionNote && <p className="note">Note: {p.decisionNote}</p>}
          </div>
        )}
      </DataBoundary>
    </Modal>
  );
}

function FeeProposal({ p }) {
  const links = p.result?.links || [];
  return (
    <>
      {p.tracking && <div className="wizard-note wizard-note--ok"><strong>{p.tracking.paid} of {p.tracking.guardians}</strong> guardians have cleared their overdue fees since this was prepared.</div>}
      {p.status === 'pending' && p.preview && (
        <div className="ai-answer">
          <span className="muted">The first reminder, exactly as it will go out:</span>
          <p className="ai-template">{p.preview}</p>
        </div>
      )}
      {links.length > 0 && (
        <DataTable
          caption="Ready-to-send WhatsApp messages" rows={links.map((l, i) => ({ ...l, i }))} rowKey="i"
          columns={[
            { key: 'guardian', label: 'Guardian', render: (l) => <strong>{l.guardian}</strong> },
            { key: 'students', label: 'Children', render: (l) => l.students.join(', ') },
            { key: 'amount', label: 'Overdue', num: true, render: (l) => inr0(l.amount) },
            { key: 'wa', label: '', actions: true, render: (l) => (l.whatsapp ? <a className="btn btn--outline btn--sm" href={l.whatsapp} target="_blank" rel="noreferrer">Open WhatsApp</a> : <span className="muted">No mobile</span>) },
          ]}
        />
      )}
      {p.status === 'pending' && (
        <DataTable
          caption="Guardians in this round" rows={p.groups.map((g, i) => ({ ...g, i }))} rowKey="i"
          columns={[
            { key: 'guardian', label: 'Guardian', render: (g) => (g.paid ? <span className="muted">Paid since</span> : <strong>{g.guardian}</strong>) },
            { key: 'students', label: 'Children', render: (g) => g.students.map((s) => `${s.name} (${s.code})`).join(', ') },
            { key: 'overdue', label: 'Overdue now', num: true, render: (g) => (g.paid ? '-' : inr0(g.overdue)) },
          ]}
        />
      )}
    </>
  );
}

function NotesProposal({ p }) {
  const links = p.result?.links || [];
  return (
    <>
      {p.status === 'pending' && p.preview && (
        <div className="ai-answer">
          <span className="muted">The first note, exactly as it will go out:</span>
          <p className="ai-template">{p.preview}</p>
        </div>
      )}
      {p.result?.improved > 0 && <p className="note">{plural(p.result.improved, 'student')} had improved by the time this was approved, so no note went to them.</p>}
      {links.length > 0 && (
        <DataTable
          caption="Ready-to-send WhatsApp messages" rows={links.map((l, i) => ({ ...l, i }))} rowKey="i"
          columns={[
            { key: 'student', label: 'Student', render: (l) => <strong>{l.student}</strong> },
            { key: 'percent', label: 'This term', num: true, render: (l) => `${l.percent}%` },
            { key: 'wa', label: '', actions: true, render: (l) => (l.whatsapp ? <a className="btn btn--outline btn--sm" href={l.whatsapp} target="_blank" rel="noreferrer">Open WhatsApp</a> : <span className="muted">No mobile</span>) },
          ]}
        />
      )}
      {p.status === 'pending' && (
        <DataTable
          caption="Students in this round" rows={p.students.map((s, i) => ({ ...s, i }))} rowKey="i"
          columns={[
            { key: 'name', label: 'Student', render: (s) => <><strong>{s.name}</strong> <small className="muted">{s.code}</small></> },
            { key: 'percent', label: 'This term now', num: true, render: (s) => `${s.percent}%` },
            { key: 'why', label: 'Why', render: (s) => <Reasons s={s} minimum={p.minimum} /> },
          ]}
        />
      )}
    </>
  );
}

function ReplyProposal({ p }) {
  if (!p.application) return <p className="note">{p.nextStep}</p>;
  return (
    <>
      <p><strong>{p.application.applicationNo}</strong>: {p.application.name}, {p.application.course} ({APP_STATUS[p.application.status] || p.application.status})</p>
      <div className="ai-answer">
        <span className="muted">{p.status === 'pending' ? 'The reply, exactly as it will go out by email:' : 'The reply as sent:'}</span>
        <p className="ai-template">{p.preview}</p>
      </div>
      {p.result?.whatsapp && <a className="btn btn--outline btn--sm" href={p.result.whatsapp} target="_blank" rel="noreferrer">Also send on WhatsApp</a>}
      <ApplicationCheck documents={p.documents} duplicates={p.duplicates} nextStep={p.nextStep} />
    </>
  );
}

/* ---------------- Activity log ---------------- */

function LogTab() {
  const { data, loading, error, reload } = useFetch('/assistants/runs');
  return (
    <Card title="Every assistant run" icon={History}>
      <DataBoundary loading={loading} error={error} data={data} reload={reload}>
        {data && (
          <DataTable
            caption="Assistant runs" rows={data.runs}
            empty={{ title: 'No runs yet', hint: 'Each question, draft and cleaned sheet is recorded here.' }}
            columns={[
              { key: 'createdAt', label: 'When', render: (r) => new Date(r.createdAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) },
              { key: 'user', label: 'Who', render: (r) => `${r.user || 'Former user'}${r.role === 'staff' ? ' (staff)' : ''}` },
              { key: 'agent', label: 'Assistant', render: (r) => AGENT[r.agent] },
              { key: 'input', label: 'Asked', render: (r) => r.input },
              { key: 'tools', label: 'Tools', render: (r) => r.tools.map((t) => t.name).join(', ') || '-' },
              { key: 'outcome', label: 'Result', render: (r) => (r.proposal ? `${r.proposal.title} (${STATUS[r.proposal.status][1].toLowerCase()})` : OUTCOME[r.outcome]) },
              { key: 'tokens', label: 'Tokens', num: true, render: (r) => num(r.tokens) },
            ]}
          />
        )}
      </DataBoundary>
    </Card>
  );
}

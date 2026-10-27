import { useState } from 'react';
import {
  AlertTriangle, BadgeIndianRupee, Banknote, CalendarOff, ClipboardCheck, FileSpreadsheet, History, Inbox, MessageSquareText,
  Send, Sparkles, Users2, Wand2,
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
const AGENT = { ask: 'Ask PlanetU', brief: 'Morning brief', fees: 'Fee follow-up', setup: 'Setup fixer' };
const OUTCOME = { answered: 'Answered', proposed: 'Proposal made', refused: 'Nothing to do', busy: 'Busy', capped: 'Allowance used up', error: 'Failed' };
const words = (k) => k.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
const num = (v) => (typeof v === 'number' ? v.toLocaleString('en-IN') : v ?? '');

/** The AI assistants: questions, morning brief, fee follow-up, sheet cleaning, and the approval inbox. */
export default function Assistants() {
  const { data: status, loading, error, reload } = useFetch('/assistants/status');
  const inbox = useFetch(status?.can.inbox ? '/assistants/proposals' : null);
  const can = status?.can || {};
  const tabs = [
    can.ask && { id: 'ask', label: 'Ask PlanetU', icon: MessageSquareText },
    can.fees && { id: 'fees', label: 'Fee follow-up', icon: BadgeIndianRupee },
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
        next={inbox.data?.pending ? { text: `${inbox.data.pending} proposal${inbox.data.pending === 1 ? '' : 's'} waiting for your decision`, to: '/admin/assistants?tab=inbox' } : undefined}
      />
      <DataBoundary loading={loading} error={error} data={status} reload={reload}>
        {status && (
          <>
            <div className={`wizard-note ${status.connected ? '' : 'wizard-note--warn'} ai-status`} role="status">
              {status.connected
                ? <><Badge tone="green">Connected</Badge> AI model: {status.model}. Used today: {num(status.tokensToday)} of {num(status.dailyTokens)} tokens.</>
                : <><Badge tone="amber">Not connected</Badge> The assistants need a model key, which your technical person adds on the server. Everything else in the ERP works as usual, and the morning brief figures still show.</>}
            </div>
            {!tabs.length ? <Card><EmptyState title="No assistant for your role" hint="The assistants are for the principal, the accountant, the admission office and the institute admin." /></Card> : (
              <>
                <Tabs tabs={tabs} active={active} onChange={setTab} />
                {active === 'ask' && <AskTab connected={status.connected} />}
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
              <select className="input" value={language} onChange={(e) => setLanguage(e.target.value)}>
                <option value="en">English</option><option value="hi">Hindi</option><option value="mr">Marathi</option>
              </select>
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

/* ---------------- Approval inbox ---------------- */

function InboxTab({ inbox, onDecided }) {
  const [open, setOpen] = useState(null);
  const { data, loading, error, reload } = inbox;
  return (
    <Card title="Proposals from the assistants" icon={Inbox}>
      <DataBoundary loading={loading} error={error} data={data} reload={reload}>
        {data && (data.proposals.length === 0
          ? <EmptyState compact title="Nothing is waiting" hint="When an assistant prepares reminders or an import, it waits here for your approval." />
          : data.proposals.map((p) => (
            <div key={p.id} className="approval">
              <span className="approval__icon" aria-hidden="true">{p.agent === 'fees' ? <BadgeIndianRupee size={18} /> : <FileSpreadsheet size={18} />}</span>
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

function ProposalModal({ id, onClose, onDecided }) {
  const { data: p, loading, error, reload } = useFetch(`/assistants/proposals/${id}`);
  const { confirm, prompt, toast } = useDialogs();
  const [busy, setBusy] = useState(false);
  const decide = async (decision) => {
    let note = '';
    if (decision === 'approve') {
      const what = p.kind === 'fee_reminders' ? `Send ${p.toSend} reminder${p.toSend === 1 ? '' : 's'} now? Each guardian gets the message in the app, and WhatsApp links are prepared.` : `${p.title}? The ready rows are imported now.`;
      if (!(await confirm(what, { title: 'Approve', confirmLabel: p.kind === 'fee_reminders' ? `Send ${p.toSend}` : 'Import' }))) return;
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
                <button type="button" className="btn btn--primary" onClick={() => decide('approve')} disabled={busy || (p.kind === 'fee_reminders' && !p.toSend)}>
                  {p.kind === 'fee_reminders' ? `Send ${p.toSend} reminder${p.toSend === 1 ? '' : 's'}` : 'Approve and import'}
                </button>
              </div>
            )}
            {p.kind === 'fee_reminders' ? <FeeProposal p={p} /> : (
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

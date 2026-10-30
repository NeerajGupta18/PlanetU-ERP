import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  CalendarDays, ClipboardCheck, GraduationCap, Inbox, LayoutDashboard, LayoutGrid, ListTodo, Megaphone, MessageSquareText, Percent, Receipt, Upload, UserPlus, Users2, Wallet, Zap,
} from 'lucide-react';
import { useFetch } from '../../hooks/useFetch.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useTenantConfig } from '../../hooks/useTenantConfig.js';
import { Badge, Card, PageHeader, CollapsibleCards } from '../../components/ui/Ui.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import Modal from '../../components/ui/Modal.jsx';
import { EmptyState, ErrorState } from '../../components/ui/Feedback.jsx';
import { LineChart } from '../../components/ui/Charts.jsx';
import { Funnel, Heatmap, PairedBars, Ring, StackedBar } from '../../components/dash/Charts.jsx';
import { Freshness, KpiCard, KpiGrid, KpiLoading, useDashboard } from '../../components/dash/KpiCard.jsx';
import AttentionList from '../../components/campus/AttentionList.jsx';
import SetupChecklist from '../../components/campus/SetupChecklist.jsx';
import { EVENT_TYPES } from '../../utils/eventTypes.js';
import { fmtEventDates, fmtLong, todayISO } from '../../utils/dates.js';
import { changeOf, inr0, inrCompact, inrShort, numIn, plural } from '../../utils/kpi.js';

export default function Dashboard() {
  const { data, loading, error, reload, refresh } = useDashboard('/admin/dashboard/overview');
  if (error && !data) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <KpiLoading />;
  return <div className="dash-page"><DashboardView d={data} loading={loading} onRefresh={refresh} /></div>;
}

function QuickAction({ to, icon: Icon, label }) {
  return <Link to={to} className="quick"><span className="quick__icon"><Icon size={18} /></span><span>{label}</span></Link>;
}

/** Everything waiting for the office, most urgent first. Built from the same figures as the cards. */
function attentionItems(d, has, t) {
  const w = d.today; const k = d.kpis; const a = k.approvals || {};
  const items = [];
  if (has('attendance') && has('timetable') && w.lecturesNotMarked > 0) {
    items.push({ key: 'att', tone: 'warn', title: `${plural(w.lecturesNotMarked, 'lecture')} today without attendance`, detail: `${w.lecturesMarked} of ${w.lecturesToday} marked so far`, link: '/admin/attendance' });
  }
  if (k.fees?.studentsOverdue > 0) items.push({ key: 'fees', tone: 'bad', title: `${plural(k.fees.studentsOverdue, t('student', 'Student').toLowerCase())} with overdue fees`, detail: `${inr0(k.fees.overdue)} past the due date`, link: '/admin/fees' });
  if (a.leave > 0) items.push({ key: 'leave', tone: 'warn', title: `${plural(a.leave, 'leave request')} to decide`, detail: 'Approve or reject from Approvals', link: '/admin/approvals' });
  if (a.application > 0) items.push({ key: 'app', tone: 'warn', title: `${plural(a.application, 'application')} to review`, detail: t('admission', 'Admissions'), link: '/admin/admissions' });
  if (w.applicationsToEnrol > 0) items.push({ key: 'enrol', tone: 'info', title: `${plural(w.applicationsToEnrol, 'accepted applicant')} to enrol`, detail: t('admission', 'Admissions'), link: '/admin/admissions' });
  if (a.certificate > 0) items.push({ key: 'cert', tone: 'warn', title: `${plural(a.certificate, 'certificate request')} waiting`, detail: 'Issue or reject', link: '/admin/certificates' });
  if (a.grievance > 0) items.push({ key: 'griev', tone: 'warn', title: `${plural(a.grievance, 'new grievance')} to answer`, detail: 'Help desk', link: '/admin/grievances' });
  if (k.attendance?.below.count > 0) {
    const b = k.attendance.below;
    items.push({ key: 'below', tone: 'warn', title: `${plural(b.count, t('student', 'Student').toLowerCase())} below ${b.threshold}% attendance`, detail: b.students.slice(0, 3).map((s) => `${s.name} (${s.pct}%)`).join(', '), link: '/admin/reports' });
  }
  if (k.fees?.dueThisWeek > 0) items.push({ key: 'due', tone: 'info', title: `${inr0(k.fees.dueThisWeek)} in fees falls due this week`, detail: 'A reminder now saves a follow-up later', link: '/admin/fees' });
  if (has('leave') && w.onLeaveToday > 0) items.push({ key: 'away', tone: 'info', title: `${plural(w.onLeaveToday, t('employee', 'Employee').toLowerCase())} on leave today`, detail: 'Check lectures that need cover', link: '/admin/leave' });
  if (k.visitors?.inside > 0) items.push({ key: 'vis', tone: 'info', title: `${plural(k.visitors.inside, 'visitor')} inside now`, detail: k.visitors.expected ? `${k.visitors.expected} more expected today` : 'Check them out when they leave', link: '/admin/visitors' });
  return items;
}

function DashboardView({ d, loading, onRefresh }) {
  const { office } = useAuth();
  const { hasModule, t, tenant } = useTenantConfig();
  const o = d.overview;
  const items = attentionItems(d, hasModule, t);
  // The header's "Next:" line is the most urgent thing waiting (an overdue problem first), so the answer to "what next?" is always on top
  const top = items.find((i) => i.tone === 'bad') || items[0];
  // Until the institute is set up, "what next" is the next setup step (the admin only: staff cannot open Setup)
  const setup = useFetch(office ? null : '/admin/setup').data;
  const setupNext = setup && !setup.complete
    ? { text: `finish setting up your institute (${setup.done} of ${setup.total} steps done)`, to: `/admin/setup?tab=${setup.current}` } : null;

  return (
    <CollapsibleCards>
      <PageHeader
        icon={LayoutDashboard} title={office ? 'Institute overview' : 'Dashboard'} subtitle={`${d.institute.name}  |  ${fmtLong(todayISO())}`}
        next={top ? { text: top.title, to: top.link } : setupNext || 'nothing is waiting, all clear for today'}
      />
      <Freshness at={d.generatedAt} loading={loading} onRefresh={onRefresh} />
      {setup && <SetupChecklist wizard={setup} />}

      <YearJourney journey={o.journey} pulse={o.pulse} canSetYear={!office} />
      <AtAGlance g={o.glance} type={tenant?.type} t={t} />
      {o.money && <Money m={o.money} />}
      {o.attendance && <Attendance a={o.attendance} t={t} />}
      {o.academics && <Academics a={o.academics} />}
      <Decisions d={o.decisions} items={items} events={d.upcomingEvents} hasModule={hasModule} t={t} />
      <Departments rows={o.departments} type={tenant?.type} t={t} />

      <div className="grid-2">
        <AskBox />
        <Card title="Shortcuts" icon={Zap}>
          <div className="quicks">
            {hasModule('admissions') && <QuickAction to="/admin/admissions" icon={ClipboardCheck} label={`Review ${t('admission', 'Admissions').toLowerCase()}`} />}
            {hasModule('students') && !office && <QuickAction to="/admin/students/import" icon={Upload} label={`Import ${t('students', 'Students').toLowerCase()}`} />}
            {!office && <QuickAction to="/admin/employees" icon={UserPlus} label={`Add ${t('employee', 'Employee').toLowerCase()}`} />}
            {hasModule('fees') && <QuickAction to="/admin/fees?tab=students" icon={Receipt} label="Record a payment" />}
            <QuickAction to="/admin/calendar" icon={CalendarDays} label="Add an event" />
            {hasModule('notices') && <QuickAction to="/admin/notices" icon={Megaphone} label="Post a notice" />}
          </div>
        </Card>
      </div>
    </CollapsibleCards>
  );
}

const STAGE_WORD = { not_started: ['Not started', 'gray'], in_progress: ['In progress', 'amber'], done: ['Done', 'green'] };
const PART_WORD = { attendance: 'Attendance', fees: 'Fee collection', approvals: 'Pending approvals', exams: 'Exam completion' };
const PART_HOW = {
  attendance: 'Students present over the last 7 days',
  fees: 'Fees collected out of fees billed',
  approvals: '100, less 5 for each item waiting',
  exams: 'Exam papers with their marks in',
};

/** The flagship strip: the academic year with today marked, each stage's status and next action, and the Pulse score. */
function YearJourney({ journey, pulse, canSetYear }) {
  const [how, setHow] = useState(false);
  const b = pulse.biggest;
  return (
    <section className="journey" aria-label="The academic year and how the institute is doing">
      <div className="journey__main">
        <div className="journey__head">
          <h2>Year Journey {journey.year.name}</h2>
          <span className="muted" style={{ fontSize: 13 }}>
            {fmtLong(journey.year.start)} to {fmtLong(journey.year.end)}
            {journey.year.assumed && canSetYear && <> (usual dates. <Link to="/admin/setup?tab=year">Set yours</Link>)</>}
          </span>
        </div>
        <div className="journey__line" role="img" aria-label={`${journey.progress}% of the academic year has passed`}>
          <span className="journey__gone" style={{ width: `${journey.progress}%` }} />
          <span className="journey__today" style={{ left: `${journey.progress}%` }}><span>Today</span></span>
        </div>
        <ol className="journey__stages">
          {journey.stages.map((s) => (
            <li key={s.key} className="journey__stage">
              <strong>{s.label}</strong>
              <Badge tone={STAGE_WORD[s.status][1]} className="badge--wide">{STAGE_WORD[s.status][0]}</Badge>
              <span className="journey__num">{s.number}</span>
              <Link to={s.to}>{s.next}</Link>
            </li>
          ))}
        </ol>
      </div>
      <div className="pulse">
        <h2>Institute Pulse</h2>
        <Ring value={pulse.score} label="Institute Pulse out of 100" size={104} />
        <p className="pulse__change" style={{ margin: 0 }}>
          {pulse.score === null ? 'Appears once there is data to score.'
            : b ? `Biggest change since yesterday: ${PART_WORD[b.part].toLowerCase()} ${b.change > 0 ? 'up' : 'down'} ${Math.abs(b.change)} points`
              : 'No change since yesterday'}
        </p>
        <button type="button" className="pulse__link" onClick={() => setHow(true)}>How is this worked out?</button>
      </div>
      <Modal open={how} title="How Institute Pulse is worked out" onClose={() => setHow(false)} width={520}>
        <p style={{ marginTop: 0 }}>A score from 0 to 100, weighted as below. A part with no data yet is left out, and the others share its weight.</p>
        <DataTable
          caption="The parts of the Pulse score" rows={pulse.parts}
          columns={[
            { key: 'part', label: 'Part', render: (p) => <><strong>{PART_WORD[p.key]}</strong><div className="muted" style={{ fontSize: 12.5 }}>{PART_HOW[p.key]}</div></> },
            { key: 'weight', label: 'Weight', num: true, render: (p) => `${p.weight}%` },
            { key: 'value', label: 'Today', num: true, render: (p) => (p.value === null ? 'No data' : p.value) },
            { key: 'yesterday', label: 'Yesterday', num: true, render: (p) => (p.yesterday === null ? 'No data' : p.yesterday) },
          ]}
        />
        <p className="note">Score today: <strong>{pulse.score ?? 'no data'}</strong>. Yesterday: <strong>{pulse.yesterday ?? 'no data'}</strong>.</p>
      </Modal>
    </section>
  );
}

function AtAGlance({ g, type, t }) {
  const students = t('students', 'Students');
  const school = type === 'school';
  const university = type === 'university';
  return (
    <Card title="At a glance" icon={Users2}>
      <KpiGrid narrow>
        <KpiCard label={`Total ${students.toLowerCase()}`} value={numIn(g.students)} to="/admin/students" meaning={`Everyone on the ${students} page, active or not`}
          sub={`${numIn(g.active)} active, ${numIn(g.newThisMonth)} new this month`} change={changeOf(g.newThisMonth, g.newLastMonth, 'last month')} />
        <KpiCard label={`Total ${t('employees', 'Employees').toLowerCase()}`} value={numIn(g.employees)} to="/admin/employees" meaning="Everyone on the staff list"
          sub={`${numIn(g.faculty)} teaching, ${numIn(g.nonTeaching)} non-teaching`} />
        {!school && <KpiCard label={university ? 'Faculties and departments' : t('departments', 'Departments')} value={numIn(g.departments)} to="/admin/departments" meaning="Departments set up for your institute" />}
        <KpiCard label={school ? 'Classes' : 'Programmes'} value={numIn(g.programmes)} to="/admin/courses" meaning="Distinct classes or programmes, counting all divisions of one as one" />
        <KpiCard label="Divisions" value={numIn(g.divisions)} to="/admin/courses" meaning="Divisions or sections across all classes" />
      </KpiGrid>
    </Card>
  );
}

function Money({ m }) {
  const notDue = Math.max(0, m.outstanding - m.overdue);
  return (
    <Card title="Money" icon={Wallet} action={<Link to="/admin/fees" className="btn btn--outline btn--sm">Fees</Link>}>
      <KpiGrid three>
        <KpiCard label="Collected today" value={inrCompact(m.collectedToday)} full={inr0(m.collectedToday)} to="/admin/fees?tab=dayend" meaning="Receipts recorded today. Matches the day-end summary."
          change={m.collectedToday ? changeOf(m.collectedToday, m.sameDayLastWeek, 'this day last week') : null} sub={m.collectedToday ? undefined : 'Nothing yet today'} spark={m.last14.map((x) => x.amount)} sparkLabel="Fees collected each day for the last 14 days" />
        <KpiCard label="Collected this month" value={inrCompact(m.thisMonth)} full={inr0(m.thisMonth)} to="/admin/fees" meaning="Receipts recorded since the 1st of this month"
          change={changeOf(m.thisMonth, m.lastMonthToDate, 'last month')} spark={m.months.map((x) => x.collected)} sparkLabel="Fees collected each month for the last 6 months" />
        <KpiCard label="Collected this year" value={inrCompact(m.year)} full={inr0(m.year)} to="/admin/fees?tab=payments" meaning="Receipts recorded in this financial year" sub={`Since ${fmtLong(m.yearStart)}`} />
        <KpiCard label="Outstanding" value={inrCompact(m.outstanding)} full={inr0(m.outstanding)} to="/admin/fees" meaning="Everything billed and not yet paid, due or not" />
        <KpiCard label="Overdue" value={inrCompact(m.overdue)} full={inr0(m.overdue)} to="/admin/fees" meaning="Part of outstanding whose due date has passed"
          change={changeOf(m.overdue, m.overdueLastWeek, 'a week ago', { goodWhen: 'down' })} sub={`${numIn(m.studentsOverdue)} to follow up`} />
        <KpiCard label="Collection rate" value={m.collectionRate === null ? null : `${m.collectionRate}%`} to="/admin/fees" meaning="Fees collected divided by fees billed" emptyHint="Appears once fees are billed." sub={`of ${inrCompact(m.billed)} billed`} />
      </KpiGrid>
      <div className="grid-2" style={{ marginTop: 16 }}>
        <div>
          <h3 className="dash-h3">Collected against billed, 6 months</h3>
          <PairedBars
            data={m.months.map((x) => ({ label: x.label, full: monthName(x.month), collected: x.collected, billed: x.billed }))}
            series={[{ key: 'collected', label: 'Collected', tone: 'brand' }, { key: 'billed', label: 'Billed (by due date)', tone: 'pale' }]}
            format={inr0} axisFormat={inrShort} caption="Fees collected against fees billed in each of the last six months"
          />
        </div>
        <div>
          <h3 className="dash-h3">Where the billed money stands</h3>
          <StackedBar
            caption="Fees billed, split by where they stand" format={inr0}
            parts={[{ label: 'Collected', value: m.allocated, tone: 'brand' }, { label: 'Overdue', value: m.overdue, tone: 'bad' }, { label: 'Not due yet', value: notDue, tone: 'none' }]}
            empty={{ title: 'No fees billed yet', hint: 'This fills in once a fee plan is assigned to students.', action: { label: 'Set up fees', to: '/admin/fees' } }}
          />
        </div>
      </div>
    </Card>
  );
}

function Attendance({ a, t }) {
  const marked = a.days.filter((x) => x.pct !== null);
  const now = a.today ?? a.latest?.pct ?? null;
  const students = t('students', 'Students').toLowerCase();
  return (
    <Card title="Attendance" icon={Percent} action={<Link to="/admin/attendance" className="btn btn--outline btn--sm">Attendance</Link>}>
      <KpiGrid>
        <KpiCard label={a.today !== null ? 'Present today' : `Present on ${a.latest?.label || 'the last marked day'}`} value={now === null ? null : `${now}%`} to="/admin/attendance"
          meaning="Share of marked students who were present or late" emptyHint="Appears once lectures are marked."
          change={a.today !== null ? changeOf(a.today, a.lastWeek, 'this day last week', { points: true }) : null}
          sub={a.today === null && now !== null ? 'Nothing marked yet today' : undefined} spark={a.days.map((x) => x.pct)} sparkLabel="Attendance each day for the last 14 days" />
        <KpiCard label="Lectures not marked today" value={a.lecturesToday ? <>{a.lecturesNotMarked}<small>of {a.lecturesToday}</small></> : 0} to="/admin/attendance" meaning="Lectures on today's timetable with no register yet"
          sub={a.lecturesToday ? undefined : 'No lectures today'} />
        <KpiCard label={`${t('students', 'Students')} below ${a.below.threshold}%`} value={numIn(a.below.count)} to="/admin/reports" meaning={`Active ${students} under the ${a.below.threshold}% minimum over all marked classes`}
          sub={a.below.students[0] ? `Lowest: ${a.below.students[0].name}, ${a.below.students[0].pct}%` : 'Everyone is above'} />
      </KpiGrid>
      <h3 className="dash-h3" style={{ marginTop: 16 }}>Last 14 days</h3>
      {marked.length < 2 ? (
        <EmptyState compact title="Not enough marked days yet" hint="The trend appears after two days of marking." action={{ label: 'Open attendance', to: '/admin/attendance' }} />
      ) : (
        <LineChart data={a.days.map((x) => ({ label: x.label, value: x.pct }))} format={(v) => `${v}%`} min={Math.min(60, ...marked.map((x) => Math.floor(x.pct / 10) * 10))} max={100} target={a.below.threshold} targetLabel={`${a.below.threshold}% minimum`} caption="Share of students present each day for the last 14 days" height={180} />
      )}
    </Card>
  );
}

function Academics({ a }) {
  const l = a.latest; const p = a.previous;
  return (
    <Card title="Academics" icon={GraduationCap} action={<Link to="/admin/exams" className="btn btn--outline btn--sm">Exams</Link>}>
      <KpiGrid>
        <KpiCard label="Exams awaiting marks" value={numIn(a.examsAwaitingMarks)} to="/admin/exams" meaning="Draft exams with at least one paper whose marks are not in" sub={a.papersPending ? `${numIn(a.papersPending)} papers to finish` : 'All marks in'} />
        <KpiCard label="Ready to publish" value={numIn(a.readyToPublish)} to="/admin/exams" meaning="Draft exams with every paper's marks in" />
        <KpiCard label="Average, latest exam" value={l?.average === null || !l ? null : `${l.average}%`} to={l ? `/admin/exams/${l.id}` : '/admin/exams'} meaning="Average percentage in the most recently published exam"
          emptyHint="Appears once an exam is published." sub={l?.name} change={l && p ? changeOf(l.average, p.average, 'the exam before', { points: true }) : null} />
        <KpiCard label="Pass rate, latest exam" value={l?.passRate === null || !l ? null : `${l.passRate}%`} to={l ? `/admin/exams/${l.id}` : '/admin/exams'} meaning="Share of students who passed every paper in the most recently published exam"
          emptyHint="Appears once an exam is published." change={l && p ? changeOf(l.passRate, p.passRate, 'the exam before', { points: true }) : null} />
      </KpiGrid>
    </Card>
  );
}

const FUNNEL_WORD = { enquiry: 'Enquiry', application: 'Application', documents: 'Documents checked', decision: 'Decision', offer: 'Offer', fee: 'Fee', enrolled: 'Enrolled' };

function Decisions({ d, items, events, hasModule, t }) {
  const w = d.waiting;
  return (
    <>
      <Card title={`Decisions${w.approvals ? ` (${w.approvals} waiting)` : ''}`} icon={Inbox} action={<Link to="/admin/approvals" className="btn btn--outline btn--sm">Approvals</Link>}>
        <KpiGrid narrow>
          <KpiCard label="Waiting for approval" value={numIn(w.approvals)} to="/admin/approvals" meaning="Leave, certificates, applications and new tickets, all in one list" />
          {hasModule('leave') && <KpiCard label="Leave requests" value={numIn(w.leave ?? 0)} to="/admin/leave" meaning="Leave requests to approve or reject" />}
          {hasModule('admissions') && <KpiCard label="New enquiries" value={numIn(d.enquiries ?? 0)} to="/admin/admissions" meaning="Started and not yet submitted" />}
          {hasModule('admissions') && <KpiCard label="Applications to review" value={numIn(w.application ?? 0)} to="/admin/admissions" meaning="Submitted and waiting for a decision" />}
        </KpiGrid>
      </Card>
      <div className="grid-2">
        {hasModule('admissions') ? (
          <Card title={`${t('admission', 'Admissions')} by stage`} icon={ClipboardCheck}>
            <Funnel
              stages={d.funnel.map((s) => ({ ...s, label: FUNNEL_WORD[s.stage] }))} caption="Applications at each stage, in order" to="/admin/admissions"
              empty={{ title: 'No applications yet', hint: 'Add an enquiry or share your application link to start.', action: { label: 'Open admissions', to: '/admin/admissions' } }}
            />
          </Card>
        ) : <UpcomingEvents events={events} />}
        <Card title={`Needs your attention${items.length ? ` (${items.length})` : ''}`} icon={ListTodo}><AttentionList items={items} /></Card>
      </div>
      {hasModule('admissions') && <UpcomingEvents events={events} />}
    </>
  );
}

function Departments({ rows, type, t }) {
  const school = type === 'school';
  const groupWord = type === 'university' ? 'Faculty or department' : t('department', 'Department');
  const childWord = school ? 'Class' : t('course', 'Programme');
  const toRow = (c) => ({ key: c.id, name: c.name, attendance: c.attendance, fees: c.fees, results: c.results, to: `/admin/students?courseId=${c.id}` });
  return (
    <Card title={`${school ? 'Classes' : t('departments', 'Departments')} compared`} icon={LayoutGrid}>
      <p className="dash-section-note">Attendance over the last 30 days, fees collected out of billed, and the pass rate in the latest published exam. Open a row to go deeper.</p>
      <Heatmap
        title={groupWord} caption="Departments compared by attendance, fee collection and results"
        rows={rows.map((g) => ({ key: g.name, name: g.name, childTitle: childWord, attendance: g.attendance, fees: g.fees, results: g.results, rows: g.classes.map(toRow) }))}
        columns={[
          { key: 'attendance', label: 'Attendance', low: 75, meaning: 'Share of marked students present in the last 30 days' },
          { key: 'fees', label: 'Fees', meaning: 'Fees collected out of fees billed' },
          { key: 'results', label: 'Results', meaning: 'Share who passed the latest published exam' },
        ]}
        empty={{ title: 'Nothing to compare yet', hint: 'Add classes and link them to departments to see them side by side.', action: { label: 'Open classes', to: '/admin/courses' } }}
      />
    </Card>
  );
}

/** Opens the Assistants page with the question filled in. */
function AskBox() {
  const [text, setText] = useState('');
  const navigate = useNavigate();
  const go = (e) => { e.preventDefault(); if (text.trim()) navigate(`/admin/assistants?ask=${encodeURIComponent(text.trim())}`); };
  return (
    <Card title="Ask PlanetU" icon={MessageSquareText}>
      <form className="ask-box" onSubmit={go}>
        <input className="input" value={text} onChange={(e) => setText(e.target.value)} maxLength={300} aria-label="Your question" placeholder="Which classes had the lowest attendance this week?" />
        <button type="submit" className="btn btn--outline" disabled={!text.trim()}>Ask</button>
      </form>
    </Card>
  );
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthName = (ym) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;

function UpcomingEvents({ events }) {
  return (
    <Card title="Upcoming events" icon={CalendarDays} action={<Link to="/admin/calendar" className="btn btn--outline btn--sm">Calendar</Link>}>
      <DataTable
        caption="Upcoming events" rows={events}
        empty={{ title: 'Nothing scheduled', hint: 'Exams, events and deadlines you add to the calendar show up here.', action: { label: 'Add an event', to: '/admin/calendar' } }}
        columns={[
          { key: 'title', label: 'Event', render: (e) => <strong>{e.title}</strong> },
          { key: 'type', label: 'Type', render: (e) => { const type = EVENT_TYPES[e.type] || { label: e.type, tone: 'gray' }; return <Badge tone={type.tone}>{type.label}</Badge>; } },
          { key: 'dates', label: 'Dates', render: (e) => fmtEventDates(e.start, e.end) },
        ]}
      />
    </Card>
  );
}

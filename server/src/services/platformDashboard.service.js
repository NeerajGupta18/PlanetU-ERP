/**
 * The platform owner's dashboard. It runs in platform context and only ever reads counts from inside an institute,
 * never a student's or an employee's record. The Client health board gives each institute a flag and the reason.
 */
import { inTenant, q } from '../db/pool.js';
import { env } from '../config/env.js';
import { setupProgress } from './setup.service.js';

const QUIET_DAYS = 7;
const SILENT_DAYS = 14;
const STUCK_AFTER_DAYS = 7;
const CHECK_DAYS = [30, 60, 90];
const NEAR_CAP = 0.8;

const daysBetween = (from, to) => Math.floor((to.getTime() - new Date(from).getTime()) / 86400000);

/** The 30, 60 or 90-day check-in due this week, if any (the same rule as the Institutes page). */
export const checkDue = (age) => CHECK_DAYS.find((d) => age >= d && age < d + 7) ?? null;

/**
 * Green, amber or red, with the reason, most serious first. `i` holds what the board knows about one institute:
 * status, overdue amount, days since anyone was active, setup, its age, check-in due and share of the token cap.
 */
export function healthOf(i) {
  const red = [];
  const amber = [];
  if (i.status !== 'active') red.push('Suspended');
  if (i.overdue > 0) red.push('Invoice overdue');
  if (i.quietDays === null ? i.age >= SILENT_DAYS : i.quietDays >= SILENT_DAYS) red.push(i.quietDays === null ? 'Nobody has ever signed in' : `No activity for ${i.quietDays} days`);
  else if (i.quietDays === null ? i.age >= QUIET_DAYS : i.quietDays >= QUIET_DAYS) amber.push(i.quietDays === null ? 'Nobody has signed in yet' : `No activity for ${i.quietDays} days`);
  if (i.setup && i.setup.done < i.setup.total && i.age >= STUCK_AFTER_DAYS) amber.push(`Setup stuck at ${i.setup.done} of ${i.setup.total}`);
  if (i.check) amber.push(`${i.check}-day check due`);
  if (i.tokenShare >= NEAR_CAP) amber.push('Near its daily assistant limit');
  if (red.length) return { flag: 'red', reason: [...red, ...amber].join('. ') };
  if (amber.length) return { flag: 'amber', reason: amber.join('. ') };
  return { flag: 'green', reason: i.quietDays === null ? 'New, nobody has signed in yet' : 'Active this week, nothing waiting' };
}

export async function platformOverview(overdueByTenant = new Map()) {
  const now = new Date();
  const { rows: tenants } = await q(
    `select t.id, t.code, t.name, t.type, t.status, t.modules, t.created_at as "createdAt", coalesce(t.settings->>'demo', 'false') = 'true' as demo,
            (select max(a.at) from audit_log a where a.tenant_id = t.id) as "lastActive"
     from tenants t order by t.name`,
  );
  const institutes = [];
  for (const t of tenants) {
    const inside = await inTenant(t.id, async () => {
      const { rows: [r] } = await q(
        `select (select count(*) from students)::int as students, (select count(*) from employees)::int as employees,
                (select coalesce(sum(prompt_tokens + completion_tokens), 0) from agent_runs where created_at >= current_date)::int as tokens`,
      );
      const setup = (await q('select 1 from institute_profiles')).rowCount ? await setupProgress(t.modules) : null;
      return { ...r, setup: setup && { done: setup.done, total: setup.total, current: setup.current } };
    });
    const age = daysBetween(t.createdAt, now);
    const row = {
      id: t.id, code: t.code, name: t.name, type: t.type, status: t.status, demo: t.demo, createdAt: t.createdAt, lastActive: t.lastActive, age,
      quietDays: t.lastActive ? daysBetween(t.lastActive, now) : null, check: checkDue(age), overdue: overdueByTenant.get(t.id) || 0,
      tokenShare: inside.tokens / env.AGENT_DAILY_TOKENS, ...inside,
    };
    institutes.push({ ...row, ...healthOf(row) });
  }
  const count = (fn) => institutes.filter(fn).length;
  const withSetup = institutes.filter((i) => i.setup);
  const byKey = (key) => Object.entries(institutes.reduce((m, i) => ({ ...m, [i[key]]: (m[i[key]] || 0) + 1 }), {})).map(([k, n]) => ({ key: k, count: n }));

  const { rows: demo } = await q('select status, count(*)::int as n from demo_requests group by 1');
  const { rows: [m] } = await q("select count(*) filter (where status = 'new')::int as waiting from support_messages");
  const { rows: months } = await q(
    `select to_char(created_at, 'YYYY-MM') as month, count(*)::int as n from tenants where created_at >= date_trunc('month', now()) - interval '11 months' group by 1`,
  );
  const monthCount = new Map(months.map((r) => [r.month, r.n]));
  const newByMonth = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - 11 + i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    return { month: key, count: monthCount.get(key) || 0 };
  });
  const { rows: [pub] } = await q('select coalesce(sum(prompt_tokens + completion_tokens), 0)::int as n from support_chat_runs where created_at >= current_date');
  const demoBy = Object.fromEntries(demo.map((r) => [r.status, r.n]));

  return {
    institutes: institutes.sort((a, b) => ({ red: 0, amber: 1, green: 2 }[a.flag] - { red: 0, amber: 1, green: 2 }[b.flag]) || a.name.localeCompare(b.name)),
    totals: {
      institutes: institutes.length, demo: count((i) => i.demo), byType: byKey('type'), byStatus: byKey('status'),
      students: institutes.reduce((a, i) => a + i.students, 0), employees: institutes.reduce((a, i) => a + i.employees, 0),
      setupAverage: withSetup.length ? Math.round((withSetup.reduce((a, i) => a + i.setup.done / i.setup.total, 0) / withSetup.length) * 100) : null,
      stuck: count((i) => i.setup && i.setup.done < i.setup.total && i.age >= STUCK_AFTER_DAYS),
      quiet: count((i) => i.quietDays === null ? i.age >= QUIET_DAYS : i.quietDays >= QUIET_DAYS),
      checksDue: count((i) => i.check !== null),
    },
    demoRequests: { new: demoBy.new || 0, contacted: demoBy.contacted || 0, closed: demoBy.closed || 0 },
    messagesWaiting: m.waiting,
    newByMonth,
    assistants: {
      tokensToday: institutes.reduce((a, i) => a + i.tokens, 0), capPerInstitute: env.AGENT_DAILY_TOKENS, busiest: Math.max(0, ...institutes.map((i) => i.tokens)),
      publicToday: pub.n, publicCap: env.PUBLIC_DAILY_TOKENS,
    },
  };
}

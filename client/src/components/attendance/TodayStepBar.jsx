import StepBar from '../ui/StepBar.jsx';
import { useTenantConfig } from '../../hooks/useTenantConfig.js';
import { attendanceProcess, processSteps } from '../../config/processes.js';
import { fmtTime } from '../../utils/dates.js';

/** The lecture to mark next: the earliest of today's not yet submitted (an earlier one left unmarked comes first). */
export const nextToMark = (lectures = []) => lectures.find((l) => l.sessionStatus !== 'submitted') || null;

/**
 * The daily attendance step bar for a teacher's day: which lecture is next and one button that opens it.
 * `data` is /employee/attendance/today. Nothing is shown on a day with no lectures (the list says why).
 */
export default function TodayStepBar({ data }) {
  const { tenant } = useTenantConfig();
  const process = attendanceProcess(tenant?.type);
  if (!data || data.holiday || !data.lectures.length) return null;
  const keys = processSteps(process).map((s) => s.key);
  const next = nextToMark(data.lectures);
  if (!next) {
    return <StepBar process={process} current={keys.at(-1)} done={keys} next={{ hint: "All of today's attendance is submitted. Nothing left to mark." }} />;
  }
  const left = data.lectures.filter((l) => l.sessionStatus !== 'submitted').length;
  return (
    <StepBar
      process={process} current={keys[0]} waitingOn="You"
      next={{
        hint: `${next.subject}, ${next.course} at ${fmtTime(next.start)} (${next.roster} students)${left > 1 ? ` · ${left - 1} more after this` : ''}`,
        label: next.sessionStatus === 'draft' ? 'Continue marking' : 'Mark attendance',
        to: `/employee/attendance/${next.slotId}`,
      }}
    />
  );
}

import { ClipboardCheck } from 'lucide-react';
import { useFetch } from '../../hooks/useFetch.js';
import { Card, PageBanner } from '../../components/ui/Ui.jsx';
import { DataBoundary } from '../../components/ui/Feedback.jsx';
import LectureList from '../../components/attendance/LectureList.jsx';
import { fmtLong } from '../../utils/dates.js';

/** Faculty: today's lectures from the Timetable, each opening its marking sheet. */
export default function Attendance() {
  const { data, loading, error, reload } = useFetch('/employee/attendance/today');
  return (
    <>
      <PageBanner
        icon={ClipboardCheck} title="Mark attendance"
        subtitle={data ? `${fmtLong(data.date)} · attendance can only be marked on the day of the lecture` : 'Today\'s lectures'}
      />
      <Card title="Today's lectures">
        <DataBoundary loading={loading} error={error} data={data} reload={reload}>
          {data && <LectureList lectures={data.lectures} holiday={data.holiday} markTo={(l) => `/employee/attendance/${l.slotId}`} />}
        </DataBoundary>
      </Card>
    </>
  );
}

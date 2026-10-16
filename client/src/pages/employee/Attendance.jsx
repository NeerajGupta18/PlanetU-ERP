import { ClipboardCheck } from 'lucide-react';
import { useFetch } from '../../hooks/useFetch.js';
import { Card, PageBanner } from '../../components/ui/Ui.jsx';
import { DataBoundary } from '../../components/ui/Feedback.jsx';
import LectureList from '../../components/attendance/LectureList.jsx';
import { fmtLong } from '../../utils/dates.js';

/** Faculty: their lectures today (a school class teacher: the class register), each opening its marking sheet. */
export default function Attendance() {
  const { data, loading, error, reload } = useFetch('/employee/attendance/today');
  return (
    <>
      <PageBanner
        icon={ClipboardCheck} title="Mark attendance"
        subtitle={data ? `${fmtLong(data.date)} · ${data.daily ? 'the class teacher takes attendance once a day' : 'only the teacher of a lecture marks it, and only on the day'}` : 'Today\'s attendance'}
      />
      <Card title={data?.daily ? 'Class register for today' : 'Your lectures today'}>
        <DataBoundary loading={loading} error={error} data={data} reload={reload}>
          {data && <LectureList lectures={data.lectures} holiday={data.holiday} daily={data.daily} markTo={(l) => `/employee/attendance/${l.slotId}`} />}
        </DataBoundary>
      </Card>
    </>
  );
}

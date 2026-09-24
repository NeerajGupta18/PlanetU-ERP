import { BadgeCheck, GraduationCap, Mail, Phone, UserRound, Users } from 'lucide-react';
import { useFetch } from '../../hooks/useFetch.js';
import { Badge, Card, Field, PageBanner } from '../../components/ui/Ui.jsx';
import { DataBoundary } from '../../components/ui/Feedback.jsx';
import { fmtDate } from '../../utils/dates.js';

export default function Profile() {
  const { data, loading, error, reload } = useFetch('/student/profile');
  return (
    <>
      <PageBanner icon={UserRound} title="My Profile" subtitle="Your personal and academic details" />
      <DataBoundary loading={loading} error={error} data={data} reload={reload}>
        {data && <ProfileView s={data.student} />}
      </DataBoundary>
    </>
  );
}

function ProfileView({ s }) {
  const initials = s.name.split(' ').map((p) => p[0]).slice(0, 2).join('');
  return (
    <>
      <section className="idcard">
        <div className="idcard__avatar">{initials}</div>
        <div className="idcard__main">
          <h2>{s.name}</h2>
          <p>{s.courseFullName}</p>
          <div className="idcard__tags">
            <Badge tone="blue">Roll no. {s.rollNo}</Badge>
            <Badge tone="purple">Semester {s.semester}, Section {s.section}</Badge>
            <Badge tone="green"><BadgeCheck size={12} /> {s.status}</Badge>
          </div>
        </div>
        <div className="idcard__contact">
          <span><Mail size={14} /> {s.email}</span>
          <span><Phone size={14} /> {s.phone}</span>
        </div>
      </section>

      <div className="grid-2">
        <Card title="Personal information" icon={UserRound}>
          <dl className="fields">
            <Field label="Full name">{s.name}</Field>
            <Field label="Date of birth">{fmtDate(s.dob)}</Field>
            <Field label="Gender">{s.gender}</Field>
            <Field label="Blood group">{s.bloodGroup}</Field>
            <Field label="Nationality">{s.nationality}</Field>
            <Field label="Address">{s.address}</Field>
          </dl>
        </Card>

        <Card title="Academic information" icon={GraduationCap}>
          <dl className="fields">
            <Field label="Enrollment no.">{s.enrollmentNo}</Field>
            <Field label="Roll no.">{s.rollNo}</Field>
            <Field label="Course">{s.course}</Field>
            <Field label="Department">{s.department}</Field>
            <Field label="Semester">{s.semester}</Field>
            <Field label="Section">{s.section}</Field>
            <Field label="Batch">{s.batch}</Field>
            <Field label="Admission date">{fmtDate(s.admissionDate)}</Field>
          </dl>
        </Card>
      </div>

      <Card title="Guardian details" icon={Users}>
        <dl className="fields fields--4">
          <Field label="Name">{s.guardian.name}</Field>
          <Field label="Relation">{s.guardian.relation}</Field>
          <Field label="Phone">{s.guardian.phone}</Field>
          <Field label="Email">{s.guardian.email}</Field>
        </dl>
      </Card>

      <p className="note">To correct any detail, contact the administration office. Students cannot edit these records.</p>
    </>
  );
}

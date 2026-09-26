import { Building2, Mail, MapPin, Phone } from 'lucide-react';
import { useFetch } from '../../hooks/useFetch.js';
import { Card, Field, PageBanner } from '../../components/ui/Ui.jsx';
import { DataBoundary } from '../../components/ui/Feedback.jsx';

export default function Institute() {
  const { data, loading, error, reload } = useFetch('/student/institute');
  return (
    <>
      <PageBanner icon={Building2} title="Institute Details" subtitle="Official information about your institute" />
      <DataBoundary loading={loading} error={error} data={data} reload={reload}>
        {data && <InstituteView i={data.institute} />}
      </DataBoundary>
    </>
  );
}

function InstituteView({ i }) {
  return (
    <>
      <section className="cover">
        <div className="cover__art" aria-hidden="true" />
        <div className="cover__card">
          <Building2 size={22} />
          <div>
            <h2>{i.name}</h2>
            <p>{i.city || i.state ? <><MapPin size={13} /> {[i.city, i.state].filter(Boolean).join(', ')}</> : i.tagline}</p>
          </div>
        </div>
      </section>

      <div className="grid-2">
        <Card title="About the institute" icon={Building2}>
          <dl className="fields">
            {Object.entries(i.details).map(([k, v]) => <Field key={k} label={k}>{v}</Field>)}
          </dl>
          <p className="note note--quote">{i.tagline}</p>
        </Card>
        <Card title="Contact" icon={Phone}>
          <dl className="fields fields--1">
            {i.address && <Field label="Address">{i.address}</Field>}
            {i.phone && <Field label="Phone">{i.phone}</Field>}
            {i.email && <Field label="Email"><Mail size={13} /> {i.email}</Field>}
            {i.website && <Field label="Website">{i.website}</Field>}
          </dl>
        </Card>
      </div>
    </>
  );
}

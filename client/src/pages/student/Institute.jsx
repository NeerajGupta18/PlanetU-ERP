import { useState } from 'react';
import {
  Building2, FileText, Landmark, Mail, MapPin, PenLine, Phone, Stamp, UserCheck, Users,
} from 'lucide-react';
import { useFetch } from '../../hooks/useFetch.js';
import { Badge, Card, Field, PageBanner, Tabs } from '../../components/ui/Ui.jsx';
import { DataBoundary } from '../../components/ui/Feedback.jsx';
import { fmtDate } from '../../utils/dates.js';

const TABS = [
  { id: 'details', label: 'Institute Details', icon: Building2 },
  { id: 'stakeholders', label: 'Stakeholder Details', icon: Users },
  { id: 'authorized', label: 'Authorized Person Details', icon: UserCheck },
  { id: 'documents', label: 'Documents', icon: FileText },
  { id: 'beneficiary', label: 'Beneficiary Details', icon: Landmark },
  { id: 'stamp', label: 'Stamp & E-Sign', icon: PenLine },
];

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
  const [tab, setTab] = useState('details');
  const [person, setPerson] = useState(0);

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

      <Tabs tabs={TABS} active={tab} onChange={setTab} />

      {tab === 'details' && (
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
      )}

      {tab === 'stakeholders' && (
        <Card title="Stakeholders" icon={Users}>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Name</th><th>Role</th><th>Email</th><th>Phone</th></tr></thead>
              <tbody>
                {i.stakeholders.map((s) => (
                  <tr key={s.email}><td><strong>{s.name}</strong></td><td><Badge tone="purple">{s.role}</Badge></td><td>{s.email}</td><td>{s.phone}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {tab === 'authorized' && (
        <Card title="Authorized persons" icon={UserCheck}>
          <div className="pills">
            {i.authorizedPersons.map((p, idx) => (
              <button key={p.email} type="button" className={`pill ${person === idx ? 'is-active' : ''}`} onClick={() => setPerson(idx)}>
                <UserCheck size={14} /> {p.name}
              </button>
            ))}
          </div>
          {(() => {
            const p = i.authorizedPersons[person];
            return (
              <dl className="fields fields--3 panel">
                <Field label="Name">{p.name}</Field>
                <Field label="Email">{p.email}</Field>
                <Field label="Phone">{p.phone}</Field>
                <Field label="Designation">{p.designation}</Field>
                <Field label="PAN">{p.pan}</Field>
                <Field label="Aadhaar">{p.aadhaar}</Field>
              </dl>
            );
          })()}
        </Card>
      )}

      {tab === 'documents' && (
        <Card title="Institute documents" icon={FileText}>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Document</th><th>Issued by</th><th>Valid till</th><th>Status</th></tr></thead>
              <tbody>
                {i.documents.map((d) => (
                  <tr key={d.name}>
                    <td><strong>{d.name}</strong></td>
                    <td>{d.issuedBy}</td>
                    <td>{d.validTill ? fmtDate(d.validTill) : 'No expiry'}</td>
                    <td><Badge tone={d.status === 'Verified' ? 'green' : 'amber'}>{d.status}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {tab === 'beneficiary' && (
        <Card title="Bank accounts" icon={Landmark}>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Account name</th><th>Bank</th><th>Branch</th><th>Account no.</th><th>IFSC</th><th>Type</th></tr></thead>
              <tbody>
                {i.beneficiaries.map((b) => (
                  <tr key={b.ifsc}>
                    <td><strong>{b.accountName}</strong></td><td>{b.bank}</td><td>{b.branch}</td>
                    <td>{b.accountNumber}</td><td>{b.ifsc}</td><td><Badge tone="blue">{b.type}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {tab === 'stamp' && (
        <Card title="Stamp and e-signature" icon={Stamp}>
          <div className="seal-grid">
            <figure className="seal">
              <svg viewBox="0 0 200 200" width="170" height="170" role="img" aria-label="Institute stamp">
                <defs>
                  <path id="arc-top" d="M 30 100 A 70 70 0 0 1 170 100" />
                  <path id="arc-bottom" d="M 22 100 A 78 78 0 0 0 178 100" />
                </defs>
                <circle cx="100" cy="100" r="92" fill="none" stroke="currentColor" strokeWidth="4" />
                <circle cx="100" cy="100" r="84" fill="none" stroke="currentColor" strokeWidth="1.5" />
                <circle cx="100" cy="100" r="46" fill="none" stroke="currentColor" strokeWidth="1.5" />
                <text fontSize="12.5" fontWeight="700" letterSpacing="1" fill="currentColor"><textPath href="#arc-top" startOffset="50%" textAnchor="middle">{i.stamp.stampText}</textPath></text>
                <text fontSize="11.5" fontWeight="600" letterSpacing="2" fill="currentColor"><textPath href="#arc-bottom" startOffset="50%" textAnchor="middle">{i.stamp.stampSub}</textPath></text>
                <text x="100" y="106" textAnchor="middle" fontSize="15" fontWeight="700" fill="currentColor">OFFICIAL</text>
              </svg>
              <figcaption>Institute stamp</figcaption>
            </figure>
            <figure className="signature">
              <div className="signature__ink">{i.stamp.signatory}</div>
              <div className="signature__line" />
              <figcaption><strong>{i.stamp.signatory}</strong><br />{i.stamp.signatoryTitle}</figcaption>
            </figure>
          </div>
          <p className="note">Sample stamp and signature for demonstration. Real images will come from the Admin module in a later phase.</p>
        </Card>
      )}
    </>
  );
}

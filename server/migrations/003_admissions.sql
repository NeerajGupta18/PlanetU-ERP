-- Admissions: public application -> document verification -> decision -> enrolment (PRN + student account)
create table applications (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null default app_tenant() references tenants (id) on delete cascade,
  application_no     text not null,
  course_id          uuid not null,
  name               text not null,
  email              text not null,
  phone              text not null default '',
  dob                date not null,
  gender             text not null default '',
  address            text not null default '',
  guardian           jsonb not null default '{}',
  previous_education jsonb not null default '{}',
  status             text not null default 'draft'
                     check (status in ('draft', 'submitted', 'documents_pending', 'accepted', 'waitlisted', 'rejected', 'enrolled')),
  access_hash        text not null,            -- sha256 of the applicant's secret access code (never the code itself)
  submitted_at       timestamptz,
  decided_at         timestamptz,
  decided_by         uuid,
  decision_note      text not null default '',
  student_id         uuid,
  created_at         timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, application_no),
  foreign key (tenant_id, course_id) references courses (tenant_id, id),
  foreign key (tenant_id, student_id) references students (tenant_id, id) on delete set null (student_id),
  foreign key (tenant_id, decided_by) references users (tenant_id, id) on delete set null (decided_by)
);
-- One live application per person per course. Drafts don't count (checked when submitting).
create unique index applications_live_uq on applications (tenant_id, lower(email), course_id)
  where status not in ('draft', 'rejected');
create index applications_status_ix on applications (tenant_id, status, created_at desc);

create table application_documents (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null default app_tenant() references tenants (id) on delete cascade,
  application_id uuid not null,
  doc_type       text not null check (doc_type in ('photo', 'id_proof', 'marksheet', 'other')),
  file_id        uuid not null,
  status         text not null default 'pending' check (status in ('pending', 'verified', 'rejected')),
  remark         text not null default '',
  verified_by    uuid,
  verified_at    timestamptz,
  unique (tenant_id, id),
  foreign key (tenant_id, application_id) references applications (tenant_id, id) on delete cascade,
  foreign key (tenant_id, file_id) references files (tenant_id, id),
  foreign key (tenant_id, verified_by) references users (tenant_id, id) on delete set null (verified_by)
);
create unique index appdocs_type_uq on application_documents (tenant_id, application_id, doc_type) where doc_type <> 'other';

do $$
declare t text;
begin
  foreach t in array array['applications', 'application_documents'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format(
      'create policy tenant_isolation on %I using (tenant_id = (select app_tenant())) with check (tenant_id = (select app_tenant()))', t);
  end loop;
end $$;

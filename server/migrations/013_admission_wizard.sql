-- =====================================================================
-- Admission wizard (Phase 2)
--
-- The public application is now a six-step form that is saved after every step, so an applicant can
-- stop and carry on later with the same application number and access code.
--
--   applications.step         furthest step the applicant has reached (1..6)
--   applications.personal     nationality, category, blood group (step 2)
--   applications.entrance     entrance exam name / roll number / score (step 4)
--   applications.source       'online' (applicant filled it in) or 'walk_in' (the office typed it in)
--   applications.fee_*        the application fee: none / pending / paid / waived, and how it was paid
--   applications.merit_score  optional override for the merit list (otherwise the qualifying percentage is used)
--
-- A draft only needs a course, a name and an email, so date of birth can be empty until the applicant
-- reaches step 2. It is checked again when the application is submitted.
--
-- admission_settings          one row per institute: application fee, open/closed switch, instructions
-- application_fee_orders      one row per Razorpay order for an application fee (reconciled exactly like student fees)
-- =====================================================================
alter table applications alter column dob drop not null;

alter table applications
  add column step         int          not null default 1 check (step between 1 and 6),
  add column personal     jsonb        not null default '{}',
  add column entrance     jsonb        not null default '{}',
  add column source       text         not null default 'online' check (source in ('online', 'walk_in')),
  add column fee_amount   numeric(10, 2) not null default 0 check (fee_amount >= 0),
  add column fee_status   text         not null default 'none' check (fee_status in ('none', 'pending', 'paid', 'waived')),
  add column fee_paid_at  timestamptz,
  add column fee_reference text        not null default '',
  add column merit_score  numeric(6, 2) check (merit_score is null or (merit_score >= 0 and merit_score <= 1000));

create index applications_merit_ix on applications (tenant_id, course_id, status);

-- A passport-size signature joins the document types
alter table application_documents drop constraint application_documents_doc_type_check;
alter table application_documents add constraint application_documents_doc_type_check
  check (doc_type in ('photo', 'signature', 'id_proof', 'marksheet', 'other'));

create table admission_settings (
  tenant_id       uuid primary key default app_tenant() references tenants (id) on delete cascade,
  application_fee numeric(10, 2) not null default 0 check (application_fee >= 0),
  accepting       boolean not null default true,
  instructions    text not null default '',
  updated_at      timestamptz not null default now()
);

create table application_fee_orders (
  id                  uuid primary key,
  tenant_id           uuid not null default app_tenant() references tenants (id) on delete cascade,
  application_id      uuid not null,
  amount              numeric(10, 2) not null check (amount > 0),
  razorpay_order_id   text not null unique,
  razorpay_payment_id text unique,
  status              text not null default 'created' check (status in ('created', 'paid')),
  method              text,
  created_at          timestamptz not null default now(),
  paid_at             timestamptz,
  unique (tenant_id, id),
  foreign key (tenant_id, application_id) references applications (tenant_id, id) on delete cascade
);
create index application_fee_orders_app_ix on application_fee_orders (tenant_id, application_id);

do $$
declare t text;
begin
  foreach t in array array['admission_settings', 'application_fee_orders'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format(
      'create policy tenant_isolation on %I using (tenant_id = (select app_tenant())) with check (tenant_id = (select app_tenant()))', t);
  end loop;
end $$;

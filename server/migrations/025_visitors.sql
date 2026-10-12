-- =====================================================================
-- Visitor management (Phase 6)
--
-- The gate keeps a log of everyone who comes in: a visitor is either expected (pre-registered by the office or by the
-- staff member they are meeting) or arrives unannounced (a walk-in, checked in on the spot). Each visit gets a pass
-- number, a host and a purpose, and is checked in and out.
--
--   expected -> checked_in -> checked_out      (or expected -> cancelled)
--
-- The module key 'visitors' already exists on every institute, so no module update is needed here.
-- =====================================================================
create table visitor_visits (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null default app_tenant() references tenants (id) on delete cascade,
  pass_no         text not null,
  visitor_name    text not null check (length(visitor_name) between 1 and 120),
  phone           text not null default '' check (length(phone) <= 30),
  email           text not null default '' check (length(email) <= 120),
  organisation    text not null default '' check (length(organisation) <= 120),
  purpose         text not null check (purpose in ('Meeting', 'Admission enquiry', 'Parent visit', 'Interview', 'Delivery', 'Maintenance or vendor', 'Event', 'Other')),
  host_id         uuid,
  host_note       text not null default '' check (length(host_note) <= 120),
  people          int not null default 1 check (people between 1 and 50),
  vehicle_no      text not null default '' check (length(vehicle_no) <= 20),
  id_shown        text not null default '' check (id_shown in ('', 'Aadhaar', 'Driving licence', 'Voter ID', 'Passport', 'Company ID', 'Other')),
  notes           text not null default '' check (length(notes) <= 500),
  expected_on     date,
  status          text not null default 'expected' check (status in ('expected', 'checked_in', 'checked_out', 'cancelled')),
  check_in_at     timestamptz,
  check_out_at    timestamptz,
  created_by      uuid,
  created_at      timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, pass_no),
  check (check_out_at is null or check_in_at is not null),
  foreign key (tenant_id, host_id) references employees (tenant_id, id) on delete set null (host_id),
  foreign key (tenant_id, created_by) references users (tenant_id, id) on delete set null (created_by)
);
create index visitor_visits_status_ix on visitor_visits (tenant_id, status, expected_on);
create index visitor_visits_in_ix on visitor_visits (tenant_id, check_in_at desc);
create index visitor_visits_host_ix on visitor_visits (tenant_id, host_id, created_at desc);

alter table visitor_visits enable row level security;
alter table visitor_visits force row level security;
create policy tenant_isolation on visitor_visits
  using (tenant_id = (select app_tenant())) with check (tenant_id = (select app_tenant()));

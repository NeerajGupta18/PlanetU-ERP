-- =====================================================================
-- Placement (Phase 5)
--
-- The placement cell keeps the companies that visit and the drives they hold: the role, package, dates and who may
-- apply (courses, minimum semester, minimum attendance). Students apply to open drives they are eligible for; the
-- office moves each application through shortlisted, selected or rejected and records the offer.
--
--   drive        draft -> open -> closed
--   application  applied -> shortlisted -> selected | rejected, or withdrawn by the student
-- =====================================================================
create table placement_companies (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null default app_tenant() references tenants (id) on delete cascade,
  name          text not null check (length(name) between 1 and 120),
  industry      text not null default '' check (length(industry) <= 80),
  website       text not null default '' check (length(website) <= 200),
  contact_name  text not null default '' check (length(contact_name) <= 100),
  contact_email text not null default '' check (length(contact_email) <= 120),
  contact_phone text not null default '' check (length(contact_phone) <= 30),
  notes         text not null default '' check (length(notes) <= 1000),
  created_at    timestamptz not null default now(),
  unique (tenant_id, id)
);
create unique index placement_companies_name_uq on placement_companies (tenant_id, lower(name));

create table placement_drives (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null default app_tenant() references tenants (id) on delete cascade,
  company_id     uuid not null,
  title          text not null check (length(title) between 1 and 150),
  description    text not null default '' check (length(description) <= 3000),
  ctc_lpa        numeric(6,2) check (ctc_lpa is null or ctc_lpa >= 0),
  location       text not null default '' check (length(location) <= 100),
  drive_date     date,
  apply_by       date,
  status         text not null default 'draft' check (status in ('draft', 'open', 'closed')),
  course_ids     uuid[] not null default '{}',
  min_semester   int check (min_semester is null or min_semester between 1 and 20),
  min_attendance numeric(5,1) check (min_attendance is null or min_attendance between 0 and 100),
  created_at     timestamptz not null default now(),
  unique (tenant_id, id),
  check (apply_by is null or drive_date is null or apply_by <= drive_date),
  foreign key (tenant_id, company_id) references placement_companies (tenant_id, id) on delete cascade
);
create index placement_drives_status_ix on placement_drives (tenant_id, status, apply_by);

create table placement_applications (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null default app_tenant() references tenants (id) on delete cascade,
  drive_id       uuid not null,
  student_id     uuid not null,
  status         text not null default 'applied' check (status in ('applied', 'shortlisted', 'selected', 'rejected', 'withdrawn')),
  note           text not null default '' check (length(note) <= 500),
  offer_lpa      numeric(6,2) check (offer_lpa is null or offer_lpa >= 0),
  resume_file_id uuid,
  applied_at     timestamptz not null default now(),
  decided_at     timestamptz,
  unique (tenant_id, id),
  unique (tenant_id, drive_id, student_id),
  foreign key (tenant_id, drive_id) references placement_drives (tenant_id, id) on delete cascade,
  foreign key (tenant_id, student_id) references students (tenant_id, id) on delete cascade,
  foreign key (tenant_id, resume_file_id) references files (tenant_id, id) on delete set null (resume_file_id)
);
create index placement_applications_student_ix on placement_applications (tenant_id, student_id);

do $$
declare t text;
begin
  foreach t in array array['placement_companies', 'placement_drives', 'placement_applications'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy tenant_isolation on %I using (tenant_id = (select app_tenant())) with check (tenant_id = (select app_tenant()))', t);
  end loop;
end $$;

-- Colleges and universities that already exist get the module; new ones get it from their preset
select set_config('app.is_platform', 'on', true);
update tenants set modules = array_append(modules, 'placement')
  where type in ('college', 'university') and not ('placement' = any (modules));

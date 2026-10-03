-- =====================================================================
-- PlanetU ERP - multi-tenant core schema
--
-- Isolation model: ONE database, shared tables, a tenant_id on every row,
-- enforced by PostgreSQL Row Level Security. The application connects as a
-- restricted role (erp_app, no BYPASSRLS) and each request runs in a
-- transaction that sets `app.tenant_id` from the signed session. If that
-- setting is missing, every policy evaluates to "no rows" (fail closed).
--
-- Cross-tenant references are impossible even for a buggy query: child rows
-- point at parents with COMPOSITE foreign keys (tenant_id, parent_id).
-- =====================================================================

-- Session helpers ------------------------------------------------------
create function app_tenant() returns uuid
  language sql stable as $$ select nullif(current_setting('app.tenant_id', true), '')::uuid $$;

create function app_platform() returns boolean
  language sql stable as $$ select coalesce(current_setting('app.is_platform', true), 'off') = 'on' $$;

-- Tenants (= the vendor's clients) -------------------------------------
create table tenants (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique check (code ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
  name        text not null,
  type        text not null check (type in ('school', 'college', 'university', 'company')),
  status      text not null default 'active' check (status in ('active', 'suspended')),
  plan        text not null default 'trial',
  modules     text[] not null default '{}',
  terminology jsonb not null default '{}',
  settings    jsonb not null default '{}',
  created_at  timestamptz not null default now()
);

-- Institute profile (one per tenant) -----------------------------------
create table institute_profiles (
  tenant_id          uuid primary key default app_tenant() references tenants (id) on delete cascade,
  name               text not null,
  short_name         text not null default '',
  tagline            text not null default '',
  address            text not null default '',
  city               text not null default '',
  state              text not null default '',
  pincode            text not null default '',
  phone              text not null default '',
  email              text not null default '',
  website            text not null default '',
  details            jsonb not null default '{}',
  stakeholders       jsonb not null default '[]',
  authorized_persons jsonb not null default '[]',
  documents          jsonb not null default '[]',
  beneficiaries      jsonb not null default '[]',
  stamp              jsonb not null default '{}'
);

-- Organisation structure ------------------------------------------------
create table departments (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null default app_tenant() references tenants (id) on delete cascade,
  name         text not null,
  description  text not null default '',
  created_date date not null default current_date,
  unique (tenant_id, id)
);
create unique index departments_name_uq on departments (tenant_id, lower(name));

create table designations (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null default app_tenant() references tenants (id) on delete cascade,
  department_id uuid not null,
  name          text not null,
  unique (tenant_id, id),
  foreign key (tenant_id, department_id) references departments (tenant_id, id) on delete cascade
);
create unique index designations_name_uq on designations (tenant_id, department_id, lower(name));

create table employees (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null default app_tenant() references tenants (id) on delete cascade,
  emp_code       text not null,
  name           text not null,
  email          text not null,
  department_id  uuid not null,
  designation_id uuid not null,
  shift          text not null default 'Employee shift',
  join_date      date not null default current_date,
  unique (tenant_id, id),
  foreign key (tenant_id, department_id) references departments (tenant_id, id),
  foreign key (tenant_id, designation_id) references designations (tenant_id, id)
);
create unique index employees_code_uq on employees (tenant_id, lower(emp_code));
create unique index employees_email_uq on employees (tenant_id, lower(email));
create index employees_dept_ix on employees (tenant_id, department_id);

-- Academics -------------------------------------------------------------
create table courses (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null default app_tenant() references tenants (id) on delete cascade,
  code          text not null,
  name          text not null,
  full_name     text not null default '',
  department_id uuid,
  years         int not null default 1,
  unique (tenant_id, id),
  foreign key (tenant_id, department_id) references departments (tenant_id, id)
);
create unique index courses_code_uq on courses (tenant_id, lower(code));

create table students (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null default app_tenant() references tenants (id) on delete cascade,
  student_code   text not null,
  roll_no        text not null default '',
  enrollment_no  text not null default '',
  name           text not null,
  email          text not null,
  phone          text not null default '',
  dob            date,
  gender         text not null default '',
  blood_group    text not null default '',
  nationality    text not null default '',
  course_id      uuid,
  semester       int not null default 1,
  section        text not null default '',
  batch          text not null default '',
  admission_date date,
  status         text not null default 'Active',
  address        text not null default '',
  guardian       jsonb not null default '{}',
  attendance     jsonb not null default '[]',
  created_at     timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, course_id) references courses (tenant_id, id)
);
create unique index students_code_uq on students (tenant_id, lower(student_code));

create table timetable_slots (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null default app_tenant() references tenants (id) on delete cascade,
  course_id   uuid not null,
  weekday     smallint not null check (weekday between 0 and 6),
  start_time  time not null,
  end_time    time not null,
  subject     text not null,
  employee_id uuid not null,
  mode        text not null default 'Offline' check (mode in ('Online', 'Offline')),
  location    text not null default '',
  type        text not null default 'lecture',
  unique (tenant_id, id),
  foreign key (tenant_id, course_id) references courses (tenant_id, id) on delete cascade,
  foreign key (tenant_id, employee_id) references employees (tenant_id, id)
);
create index slots_course_ix on timetable_slots (tenant_id, course_id, weekday);

create table duties (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null default app_tenant() references tenants (id) on delete cascade,
  course_id   uuid not null,
  title       text not null,
  employee_id uuid not null,
  duty_date   date not null,
  start_time  time not null,
  end_time    time not null,
  priority    text not null default 'Medium' check (priority in ('High', 'Medium', 'Low')),
  location    text not null default '',
  seed_key    text,
  unique (tenant_id, id),
  foreign key (tenant_id, course_id) references courses (tenant_id, id) on delete cascade,
  foreign key (tenant_id, employee_id) references employees (tenant_id, id)
);
create unique index duties_seed_uq on duties (tenant_id, seed_key) where seed_key is not null;

create table reassignments (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null default app_tenant() references tenants (id) on delete cascade,
  slot_id        uuid not null,
  on_date        date not null,
  to_employee_id uuid not null,
  reason         text not null default '',
  seed_key       text,
  unique (tenant_id, id),
  unique (tenant_id, slot_id, on_date),
  foreign key (tenant_id, slot_id) references timetable_slots (tenant_id, id) on delete cascade,
  foreign key (tenant_id, to_employee_id) references employees (tenant_id, id)
);

-- Calendar & notices -----------------------------------------------------
create table events (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null default app_tenant() references tenants (id) on delete cascade,
  title       text not null,
  type        text not null check (type in ('holiday', 'exam', 'event', 'academic', 'deadline')),
  start_date  date not null,
  end_date    date not null,
  all_day     boolean not null default true,
  start_time  time,
  end_time    time,
  location    text,
  description text not null default '',
  audience    text not null default 'all' check (audience in ('all', 'student')),
  seed_key    text,
  unique (tenant_id, id),
  check (end_date >= start_date)
);
create index events_range_ix on events (tenant_id, start_date, end_date);
create unique index events_seed_uq on events (tenant_id, seed_key) where seed_key is not null;

create table notices (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null default app_tenant() references tenants (id) on delete cascade,
  title       text not null,
  body        text not null default '',
  category    text not null default 'General',
  notice_date date not null default current_date,
  seed_key    text,
  unique (tenant_id, id)
);
create unique index notices_seed_uq on notices (tenant_id, seed_key) where seed_key is not null;

-- Shared platform services ----------------------------------------------
-- Configurable number series (PRN, employee code, receipt no. ...)
create table number_series (
  tenant_id  uuid not null default app_tenant() references tenants (id) on delete cascade,
  key        text not null,
  prefix     text not null default '',
  padding    int not null default 4,
  next_value bigint not null default 1,
  primary key (tenant_id, key)
);

create table audit_log (
  id         bigint generated always as identity primary key,
  tenant_id  uuid default app_tenant() references tenants (id) on delete cascade,
  actor_id   uuid,
  actor_role text,
  action     text not null,
  entity     text,
  entity_id  text,
  meta       jsonb not null default '{}',
  at         timestamptz not null default now()
);
create index audit_tenant_ix on audit_log (tenant_id, at desc);

-- Users -------------------------------------------------------------------
-- tenant_id IS NULL  <=>  platform user (the vendor's Super Admin).
create table users (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid default app_tenant() references tenants (id) on delete cascade,
  role          text not null check (role in ('super_admin', 'admin', 'student', 'employee')),
  login_id      text not null,
  email         text not null,
  name          text not null,
  password_hash text not null,
  student_id    uuid,
  employee_id   uuid,
  status        text not null default 'active' check (status in ('active', 'disabled')),
  created_at    timestamptz not null default now(),
  check ((role = 'super_admin') = (tenant_id is null)),
  check ((role = 'student') = (student_id is not null)),
  check ((role = 'employee') = (employee_id is not null)),
  foreign key (tenant_id, student_id) references students (tenant_id, id) on delete cascade,
  foreign key (tenant_id, employee_id) references employees (tenant_id, id) on delete cascade
);
create unique index users_login_uq on users (coalesce(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(login_id));
create unique index users_email_uq on users (coalesce(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(email));

-- Row Level Security ------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'institute_profiles', 'departments', 'designations', 'employees', 'courses', 'students',
    'timetable_slots', 'duties', 'reassignments', 'events', 'notices', 'number_series'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format(
      'create policy tenant_isolation on %I using (tenant_id = (select app_tenant())) with check (tenant_id = (select app_tenant()))', t);
  end loop;
end $$;

-- tenants: a tenant can only see its own row; only platform context can write
alter table tenants enable row level security;
alter table tenants force row level security;
create policy tenants_read on tenants for select using (id = (select app_tenant()) or (select app_platform()));
create policy tenants_write on tenants for all using ((select app_platform())) with check ((select app_platform()));

-- users: own tenant's users, or everything in platform context (login lookup / vendor console)
alter table users enable row level security;
alter table users force row level security;
create policy users_scope on users
  using (tenant_id = (select app_tenant()) or (select app_platform()))
  with check (tenant_id = (select app_tenant()) or (select app_platform()));

-- audit log: own tenant's entries, or platform-level entries in platform context
alter table audit_log enable row level security;
alter table audit_log force row level security;
create policy audit_scope on audit_log
  using (tenant_id = (select app_tenant()) or (select app_platform()))
  with check (tenant_id = (select app_tenant()) or (select app_platform()));

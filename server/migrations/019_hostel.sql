-- =====================================================================
-- Hostel (Phase 4)
--
-- An institute lists its hostels, the rooms in each (with a bed count and a monthly charge) and which students
-- stay where. A student has at most one current stay. An ended stay is kept as history (status vacated).
-- =====================================================================
create table hostels (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null default app_tenant() references tenants (id) on delete cascade,
  name          text not null check (length(name) between 1 and 80),
  kind          text not null default 'mixed' check (kind in ('boys', 'girls', 'mixed')),
  warden_id     uuid,
  phone         text not null default '' check (length(phone) <= 30),
  notes         text not null default '' check (length(notes) <= 500),
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, warden_id) references employees (tenant_id, id) on delete set null (warden_id)
);
create unique index hostels_name_uq on hostels (tenant_id, lower(name));

create table hostel_rooms (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null default app_tenant() references tenants (id) on delete cascade,
  hostel_id     uuid not null,
  room_no       text not null check (length(room_no) between 1 and 20),
  floor         int not null default 0 check (floor between 0 and 50),
  beds          int not null check (beds between 1 and 20),
  monthly_fee   numeric(10,2) not null default 0 check (monthly_fee >= 0),
  active        boolean not null default true,
  unique (tenant_id, id),
  foreign key (tenant_id, hostel_id) references hostels (tenant_id, id) on delete cascade
);
create unique index hostel_rooms_no_uq on hostel_rooms (tenant_id, hostel_id, lower(room_no));

create table hostel_stays (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null default app_tenant() references tenants (id) on delete cascade,
  room_id       uuid not null,
  student_id    uuid not null,
  from_date     date not null default current_date,
  to_date       date,
  status        text not null default 'active' check (status in ('active', 'vacated')),
  remark        text not null default '' check (length(remark) <= 300),
  created_by    uuid,
  created_at    timestamptz not null default now(),
  unique (tenant_id, id),
  check (to_date is null or to_date >= from_date),
  check ((status = 'active') = (to_date is null)),
  foreign key (tenant_id, room_id) references hostel_rooms (tenant_id, id),
  foreign key (tenant_id, student_id) references students (tenant_id, id) on delete cascade,
  foreign key (tenant_id, created_by) references users (tenant_id, id) on delete set null (created_by)
);
create unique index hostel_stays_one_active_uq on hostel_stays (tenant_id, student_id) where status = 'active';
create index hostel_stays_room_ix on hostel_stays (tenant_id, room_id, status);

do $$
declare t text;
begin
  foreach t in array array['hostels', 'hostel_rooms', 'hostel_stays'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy tenant_isolation on %I using (tenant_id = (select app_tenant())) with check (tenant_id = (select app_tenant()))', t);
  end loop;
end $$;

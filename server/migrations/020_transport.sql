-- =====================================================================
-- Transport (Phase 4)
--
-- Bus routes with a vehicle, a driver, ordered stops and a monthly charge. A student rides from one stop of one
-- route; at most one current ride per student. An ended ride is kept as history (status ended).
-- =====================================================================
create table transport_routes (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null default app_tenant() references tenants (id) on delete cascade,
  name          text not null check (length(name) between 1 and 80),
  vehicle_no    text not null default '' check (length(vehicle_no) <= 30),
  driver_name   text not null default '' check (length(driver_name) <= 80),
  driver_phone  text not null default '' check (length(driver_phone) <= 30),
  seats         int not null default 40 check (seats between 1 and 200),
  monthly_fee   numeric(10,2) not null default 0 check (monthly_fee >= 0),
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  unique (tenant_id, id)
);
create unique index transport_routes_name_uq on transport_routes (tenant_id, lower(name));

create table transport_stops (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null default app_tenant() references tenants (id) on delete cascade,
  route_id      uuid not null,
  name          text not null check (length(name) between 1 and 80),
  position      int not null default 1 check (position between 1 and 200),
  pickup_time   text not null default '' check (pickup_time = '' or pickup_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  unique (tenant_id, id),
  foreign key (tenant_id, route_id) references transport_routes (tenant_id, id) on delete cascade
);
create index transport_stops_route_ix on transport_stops (tenant_id, route_id, position);

create table transport_rides (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null default app_tenant() references tenants (id) on delete cascade,
  route_id      uuid not null,
  stop_id       uuid not null,
  student_id    uuid not null,
  from_date     date not null default current_date,
  to_date       date,
  status        text not null default 'active' check (status in ('active', 'ended')),
  created_by    uuid,
  created_at    timestamptz not null default now(),
  unique (tenant_id, id),
  check (to_date is null or to_date >= from_date),
  check ((status = 'active') = (to_date is null)),
  foreign key (tenant_id, route_id) references transport_routes (tenant_id, id),
  foreign key (tenant_id, stop_id) references transport_stops (tenant_id, id),
  foreign key (tenant_id, student_id) references students (tenant_id, id) on delete cascade,
  foreign key (tenant_id, created_by) references users (tenant_id, id) on delete set null (created_by)
);
create unique index transport_rides_one_active_uq on transport_rides (tenant_id, student_id) where status = 'active';
create index transport_rides_route_ix on transport_rides (tenant_id, route_id, status);

do $$
declare t text;
begin
  foreach t in array array['transport_routes', 'transport_stops', 'transport_rides'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy tenant_isolation on %I using (tenant_id = (select app_tenant())) with check (tenant_id = (select app_tenant()))', t);
  end loop;
end $$;

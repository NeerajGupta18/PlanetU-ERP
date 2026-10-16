-- =====================================================================
-- QR check-in v2: the in-app scanner
--
-- The QR now carries a signed token that is replaced every 10 seconds; there is no typed code any more. Only the
-- scanner inside the app can use it, and only colleges and universities have it (a new module, 'qr_checkin').
-- Two optional safeguards are recorded here: the classroom location the teacher chose to require, and which phone
-- each scan came from, so one phone marking several students is shown to the teacher.
-- =====================================================================
alter table attendance_checkins
  add column geo_lat      double precision,
  add column geo_lng      double precision,
  add column geo_radius_m int check (geo_radius_m is null or geo_radius_m between 30 and 1000);

create table attendance_checkin_scans (
  tenant_id   uuid not null default app_tenant() references tenants (id) on delete cascade,
  checkin_id  uuid not null,
  student_id  uuid not null,
  device_id   text,
  distance_m  int,
  flag        text,
  scanned_at  timestamptz not null default now(),
  primary key (checkin_id, student_id),
  foreign key (tenant_id, checkin_id) references attendance_checkins (tenant_id, id) on delete cascade,
  foreign key (tenant_id, student_id) references students (tenant_id, id) on delete cascade
);
create index attendance_checkin_scans_device on attendance_checkin_scans (checkin_id, device_id);

alter table attendance_checkin_scans enable row level security;
alter table attendance_checkin_scans force row level security;
create policy tenant_isolation on attendance_checkin_scans
  using (tenant_id = (select app_tenant())) with check (tenant_id = (select app_tenant()));

update tenants set modules = array_append(modules, 'qr_checkin')
  where type in ('college', 'university') and not ('qr_checkin' = any (modules));

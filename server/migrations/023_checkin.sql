-- =====================================================================
-- QR check-in for attendance (Phase 5)
--
-- A teacher opens check-in for today's lecture. The screen shows a QR code and a 6-digit code that change every 30
-- seconds (derived from a secret kept here), so a photo or a message of it goes stale at once. A student scans it or
-- types it and is marked present (or late, after the first minutes). It writes into the same attendance records the
-- teacher's sheet uses, and the teacher still reviews and submits the sheet.
-- =====================================================================
create table attendance_checkins (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null default app_tenant() references tenants (id) on delete cascade,
  slot_id            uuid not null,
  on_date            date not null,
  secret             text not null,
  opened_by          uuid,
  opened_at          timestamptz not null default now(),
  closes_at          timestamptz not null,
  late_after_minutes int not null default 10 check (late_after_minutes between 1 and 120),
  status             text not null default 'open' check (status in ('open', 'closed')),
  unique (tenant_id, id),
  unique (tenant_id, slot_id, on_date),
  foreign key (tenant_id, slot_id) references timetable_slots (tenant_id, id) on delete cascade,
  foreign key (tenant_id, opened_by) references users (tenant_id, id) on delete set null (opened_by)
);

-- wrong codes per student, so a 6-digit code cannot be guessed
create table attendance_checkin_fails (
  tenant_id  uuid not null default app_tenant() references tenants (id) on delete cascade,
  checkin_id uuid not null,
  student_id uuid not null,
  fails      int not null default 0,
  primary key (checkin_id, student_id),
  foreign key (tenant_id, checkin_id) references attendance_checkins (tenant_id, id) on delete cascade,
  foreign key (tenant_id, student_id) references students (tenant_id, id) on delete cascade
);

alter table attendance_records add column marked_via text not null default 'faculty' check (marked_via in ('faculty', 'qr'));

do $$
declare t text;
begin
  foreach t in array array['attendance_checkins', 'attendance_checkin_fails'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy tenant_isolation on %I using (tenant_id = (select app_tenant())) with check (tenant_id = (select app_tenant()))', t);
  end loop;
end $$;

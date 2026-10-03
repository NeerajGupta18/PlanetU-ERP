-- =====================================================================
-- Attendance
--
-- A SESSION is one dated occurrence of a weekly timetable slot (slot_id + on_date) - exactly the
-- unit the Timetable and Lecture Reassignment modules already use. A RECORD is one student's mark
-- in that session.
--
--   draft      faculty saved part-way; NOT counted in anyone's percentage yet
--   submitted  every student marked; counted everywhere (student view, admin reports)
--
-- subject / course / times are copied onto the session so history survives a later timetable
-- edit. If a slot is deleted the session (and its marks) stay, only slot_id becomes null.
-- 'late' counts as attended; the application treats present + late as attended.
-- =====================================================================
create table attendance_sessions (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null default app_tenant() references tenants (id) on delete cascade,
  slot_id      uuid,
  on_date      date not null,
  course_id    uuid not null,
  subject      text not null,
  start_time   time not null,
  end_time     time not null,
  taken_by     uuid,                       -- the employee who was teaching it (after any reassignment)
  status       text not null default 'draft' check (status in ('draft', 'submitted')),
  submitted_at timestamptz,
  created_by   uuid,                       -- users.id of whoever first saved it
  updated_by   uuid,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, slot_id, on_date),
  foreign key (tenant_id, slot_id)   references timetable_slots (tenant_id, id) on delete set null (slot_id),
  foreign key (tenant_id, course_id) references courses (tenant_id, id) on delete cascade,
  foreign key (tenant_id, taken_by)  references employees (tenant_id, id) on delete set null (taken_by)
);
create index attendance_sessions_date_ix   on attendance_sessions (tenant_id, on_date);
create index attendance_sessions_course_ix on attendance_sessions (tenant_id, course_id, on_date);

create table attendance_records (
  tenant_id  uuid not null default app_tenant() references tenants (id) on delete cascade,
  session_id uuid not null,
  student_id uuid not null,
  status     text not null check (status in ('present', 'absent', 'late')),
  updated_at timestamptz not null default now(),
  primary key (session_id, student_id),
  foreign key (tenant_id, session_id) references attendance_sessions (tenant_id, id) on delete cascade,
  foreign key (tenant_id, student_id) references students (tenant_id, id) on delete cascade
);
create index attendance_records_student_ix on attendance_records (tenant_id, student_id);

do $$
declare t text;
begin
  foreach t in array array['attendance_sessions', 'attendance_records'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format(
      'create policy tenant_isolation on %I using (tenant_id = (select app_tenant())) with check (tenant_id = (select app_tenant()))', t);
  end loop;
end $$;

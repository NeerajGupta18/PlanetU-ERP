-- =====================================================================
-- Parent portal (Phase 3)
--
-- A parent signs in with their own account (role 'parent') and sees the students linked to them: attendance,
-- timetable, results, fees (and can pay them), notices and the calendar. One parent can be linked to several
-- children (brothers and sisters), and a student can have more than one parent or guardian linked.
-- A parent account is created by the office, from the student's record.
-- =====================================================================
alter table users drop constraint users_role_check;
alter table users add constraint users_role_check check (role in ('super_admin', 'admin', 'student', 'employee', 'parent'));

create table parent_links (
  tenant_id   uuid not null default app_tenant() references tenants (id) on delete cascade,
  user_id     uuid not null,
  student_id  uuid not null,
  relation    text not null default 'Guardian' check (length(relation) between 1 and 30),
  created_at  timestamptz not null default now(),
  primary key (tenant_id, user_id, student_id),
  foreign key (tenant_id, user_id) references users (tenant_id, id) on delete cascade,
  foreign key (tenant_id, student_id) references students (tenant_id, id) on delete cascade
);
create index parent_links_student_ix on parent_links (tenant_id, student_id);

alter table parent_links enable row level security;
alter table parent_links force row level security;
create policy tenant_isolation on parent_links
  using (tenant_id = (select app_tenant())) with check (tenant_id = (select app_tenant()));

-- Institutes with students already exist: switch the module on for schools, colleges and universities
select set_config('app.is_platform', 'on', true);
update tenants set modules = array_append(modules, 'parent_portal')
  where type in ('school', 'college', 'university') and not ('parent_portal' = any (modules));

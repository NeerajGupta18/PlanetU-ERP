-- =====================================================================
-- Assignments (Phase 5)
--
-- A teacher sets work for a class and subject (optionally one section) with a due date and maximum marks. Students
-- send an answer and/or a file. The teacher grades it with feedback, or sends it back to be done again.
--
--   assignment  draft -> published -> closed
--   submission  submitted -> graded | returned (the student may then submit again)
-- =====================================================================
create table assignments (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null default app_tenant() references tenants (id) on delete cascade,
  course_id          uuid not null,
  subject            text not null check (length(subject) between 1 and 100),
  section            text not null default '' check (length(section) <= 20),
  title              text not null check (length(title) between 1 and 150),
  description        text not null default '' check (length(description) <= 5000),
  due_at             timestamptz not null,
  max_marks          numeric(6,1) not null default 10 check (max_marks > 0),
  allow_late         boolean not null default true,
  status             text not null default 'draft' check (status in ('draft', 'published', 'closed')),
  attachment_file_id uuid,
  created_by_employee uuid,
  created_by         uuid,
  published_at       timestamptz,
  created_at         timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, course_id) references courses (tenant_id, id) on delete cascade,
  foreign key (tenant_id, created_by_employee) references employees (tenant_id, id) on delete set null (created_by_employee),
  foreign key (tenant_id, created_by) references users (tenant_id, id) on delete set null (created_by),
  foreign key (tenant_id, attachment_file_id) references files (tenant_id, id) on delete set null (attachment_file_id)
);
create index assignments_course_ix on assignments (tenant_id, course_id, status, due_at);

create table assignment_submissions (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null default app_tenant() references tenants (id) on delete cascade,
  assignment_id  uuid not null,
  student_id     uuid not null,
  answer         text not null default '' check (length(answer) <= 10000),
  file_id        uuid,
  late           boolean not null default false,
  status         text not null default 'submitted' check (status in ('submitted', 'graded', 'returned')),
  marks          numeric(6,1) check (marks is null or marks >= 0),
  feedback       text not null default '' check (length(feedback) <= 2000),
  submitted_at   timestamptz not null default now(),
  graded_by      uuid,
  graded_at      timestamptz,
  unique (tenant_id, id),
  unique (tenant_id, assignment_id, student_id),
  foreign key (tenant_id, assignment_id) references assignments (tenant_id, id) on delete cascade,
  foreign key (tenant_id, student_id) references students (tenant_id, id) on delete cascade,
  foreign key (tenant_id, file_id) references files (tenant_id, id) on delete set null (file_id),
  foreign key (tenant_id, graded_by) references users (tenant_id, id) on delete set null (graded_by)
);
create index assignment_submissions_student_ix on assignment_submissions (tenant_id, student_id);

do $$
declare t text;
begin
  foreach t in array array['assignments', 'assignment_submissions'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy tenant_isolation on %I using (tenant_id = (select app_tenant())) with check (tenant_id = (select app_tenant()))', t);
  end loop;
end $$;

-- Institutes that already exist get the module; new ones get it from their preset
select set_config('app.is_platform', 'on', true);
update tenants set modules = array_append(modules, 'assignments')
  where type in ('school', 'college', 'university') and not ('assignments' = any (modules));

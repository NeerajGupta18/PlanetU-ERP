-- =====================================================================
-- Exams & Results
--
--   exams          one examination for one course + semester ("Mid-Semester", "End-Semester")
--   exam_papers    one row per subject in that exam: max/pass marks, credits (the weight in the GPA),
--                  and which employee enters the marks
--   exam_marks     one row per student per paper. NO row = not entered yet. A row is either a mark
--                  or an "absent"; never both.
--   grading_scales an institute's own grade bands (optional - without a row, the built-in 10-point scale applies)
--
-- Grades, percentages and GPA are never stored: they are computed from marks + the grading scale
-- every time, so correcting a mark or changing a band can never leave a stale result behind.
--
-- exams.status:  draft -> published. Students see an exam only once it is published, and it can only be
-- published after every paper's marks were submitted.
-- exam_papers.marks_status:  draft (faculty still entering) -> submitted (complete; every student has a mark or absent).
-- =====================================================================
create table exams (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null default app_tenant() references tenants (id) on delete cascade,
  course_id    uuid not null,
  semester     int not null default 1 check (semester between 1 and 20),
  name         text not null,
  kind         text not null default 'term' check (kind in ('unit', 'mid_term', 'term', 'practical', 'other')),
  start_date   date,
  end_date     date,
  status       text not null default 'draft' check (status in ('draft', 'published')),
  published_at timestamptz,
  created_by   uuid,
  created_at   timestamptz not null default now(),
  unique (tenant_id, id),
  check (end_date is null or start_date is null or end_date >= start_date),
  foreign key (tenant_id, course_id) references courses (tenant_id, id) on delete cascade
);
create unique index exams_name_uq on exams (tenant_id, course_id, semester, lower(name));
create index exams_course_ix on exams (tenant_id, course_id, semester);

create table exam_papers (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null default app_tenant() references tenants (id) on delete cascade,
  exam_id      uuid not null,
  subject      text not null,
  max_marks    numeric(6, 2) not null check (max_marks > 0),
  pass_marks   numeric(6, 2) not null check (pass_marks >= 0),
  credits      numeric(4, 1) not null default 1 check (credits > 0),
  employee_id  uuid,
  marks_status text not null default 'draft' check (marks_status in ('draft', 'submitted')),
  submitted_at timestamptz,
  created_at   timestamptz not null default now(),
  unique (tenant_id, id),
  check (pass_marks <= max_marks),
  foreign key (tenant_id, exam_id)     references exams (tenant_id, id) on delete cascade,
  foreign key (tenant_id, employee_id) references employees (tenant_id, id) on delete set null (employee_id)
);
create unique index exam_papers_subject_uq on exam_papers (tenant_id, exam_id, lower(subject));
create index exam_papers_employee_ix on exam_papers (tenant_id, employee_id);

create table exam_marks (
  tenant_id  uuid not null default app_tenant() references tenants (id) on delete cascade,
  paper_id   uuid not null,
  student_id uuid not null,
  marks      numeric(6, 2) check (marks >= 0),
  absent     boolean not null default false,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  primary key (paper_id, student_id),
  check ((absent and marks is null) or (not absent and marks is not null)),
  foreign key (tenant_id, paper_id)   references exam_papers (tenant_id, id) on delete cascade,
  foreign key (tenant_id, student_id) references students (tenant_id, id) on delete cascade
);
create index exam_marks_student_ix on exam_marks (tenant_id, student_id);

create table grading_scales (
  tenant_id  uuid primary key default app_tenant() references tenants (id) on delete cascade,
  bands      jsonb not null,
  updated_at timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['exams', 'exam_papers', 'exam_marks', 'grading_scales'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format(
      'create policy tenant_isolation on %I using (tenant_id = (select app_tenant())) with check (tenant_id = (select app_tenant()))', t);
  end loop;
end $$;

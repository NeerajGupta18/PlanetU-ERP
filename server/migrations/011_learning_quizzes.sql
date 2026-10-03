-- =====================================================================
-- Learning platform (MOOC courses for compulsory credits) and Quizzes (for internal marks)
--
-- LEARNING
--   learning_courses       the catalogue: an external MOOC (NPTEL, SWAYAM, Coursera...) or an in-house course with lessons
--   learning_lessons       lessons of an in-house course (video link, reading text, or a link)
--   learning_assignments   "this course, for this class, for this subject, for N credits, due then, compulsory or not"
--   learning_enrollments   one row per student per assignment: status, evidence, credits awarded
--   learning_progress      which lessons a student has completed
--
-- QUIZZES
--   quizzes / quiz_questions   a timed, auto-graded quiz for a class and subject, worth `weightage` internal marks
--   quiz_attempts              one row per try; answers are saved as the student goes, and the SERVER enforces the clock
--   quiz_extra_attempts        a teacher letting one student have another go
--
-- "Class" in the targeting columns means the existing `courses` table (programme/class), as everywhere else.
-- =====================================================================
create table learning_courses (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null default app_tenant() references tenants (id) on delete cascade,
  title               text not null,
  description         text not null default '',
  provider            text not null default 'Internal' check (provider in ('NPTEL', 'SWAYAM', 'Coursera', 'edX', 'Udemy', 'Internal', 'Other')),
  url                 text not null default '',
  subject             text not null default '',
  credits             numeric(4, 1) not null default 1 check (credits >= 0),
  duration_hours      numeric(5, 1) not null default 0 check (duration_hours >= 0),
  level               text not null default 'beginner' check (level in ('beginner', 'intermediate', 'advanced')),
  completion          text not null default 'evidence' check (completion in ('lessons', 'evidence')),
  status              text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  created_by          uuid,
  created_by_employee uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, created_by_employee) references employees (tenant_id, id) on delete set null (created_by_employee)
);

create table learning_lessons (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null default app_tenant() references tenants (id) on delete cascade,
  course_id   uuid not null,
  position    int not null,
  title       text not null,
  kind        text not null default 'reading' check (kind in ('video', 'reading', 'link')),
  url         text not null default '',
  body        text not null default '',
  duration_min int not null default 0 check (duration_min >= 0),
  unique (tenant_id, id),
  foreign key (tenant_id, course_id) references learning_courses (tenant_id, id) on delete cascade
);
create index learning_lessons_ix on learning_lessons (tenant_id, course_id, position);

create table learning_assignments (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null default app_tenant() references tenants (id) on delete cascade,
  learning_course_id  uuid not null,
  target_course_id    uuid not null,
  target_semester     int not null check (target_semester between 1 and 20),
  target_section      text not null default '',
  subject             text not null,
  credits             numeric(4, 1) not null check (credits >= 0),
  mandatory           boolean not null default true,
  due_date            date,
  note                text not null default '',
  created_by          uuid,
  created_by_employee uuid,
  created_at          timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, learning_course_id) references learning_courses (tenant_id, id) on delete restrict,
  foreign key (tenant_id, target_course_id) references courses (tenant_id, id) on delete cascade,
  foreign key (tenant_id, created_by_employee) references employees (tenant_id, id) on delete set null (created_by_employee)
);
create index learning_assignments_ix on learning_assignments (tenant_id, target_course_id, target_semester);
-- A course is assigned to a class for a subject once
create unique index learning_assignments_uq on learning_assignments (tenant_id, learning_course_id, target_course_id, target_semester, target_section, lower(subject));

create table learning_enrollments (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null default app_tenant() references tenants (id) on delete cascade,
  assignment_id    uuid not null,
  student_id       uuid not null,
  status           text not null default 'assigned' check (status in ('assigned', 'in_progress', 'submitted', 'completed', 'rejected')),
  started_at       timestamptz,
  submitted_at     timestamptz,
  completed_at     timestamptz,
  credits_awarded  numeric(4, 1) not null default 0,
  evidence_url     text not null default '',
  evidence_file_id uuid,
  evidence_note    text not null default '',
  certificate_id   text not null default '',
  score            numeric(5, 2) check (score between 0 and 100),
  reviewed_by      uuid,
  reviewed_at      timestamptz,
  review_note      text not null default '',
  unique (tenant_id, id),
  unique (assignment_id, student_id),
  foreign key (tenant_id, assignment_id) references learning_assignments (tenant_id, id) on delete cascade,
  foreign key (tenant_id, student_id) references students (tenant_id, id) on delete cascade,
  foreign key (tenant_id, evidence_file_id) references files (tenant_id, id) on delete set null (evidence_file_id)
);
create index learning_enrollments_student_ix on learning_enrollments (tenant_id, student_id);
create index learning_enrollments_status_ix on learning_enrollments (tenant_id, status);

create table learning_progress (
  tenant_id     uuid not null default app_tenant() references tenants (id) on delete cascade,
  enrollment_id uuid not null,
  lesson_id     uuid not null,
  completed_at  timestamptz not null default now(),
  primary key (enrollment_id, lesson_id),
  foreign key (tenant_id, enrollment_id) references learning_enrollments (tenant_id, id) on delete cascade,
  foreign key (tenant_id, lesson_id) references learning_lessons (tenant_id, id) on delete cascade
);

create table quizzes (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null default app_tenant() references tenants (id) on delete cascade,
  title               text not null,
  subject             text not null,
  course_id           uuid not null,
  semester            int not null check (semester between 1 and 20),
  section             text not null default '',
  instructions        text not null default '',
  duration_minutes    int not null default 30 check (duration_minutes between 1 and 300),
  open_at             timestamptz,
  close_at            timestamptz,
  max_attempts        int not null default 1 check (max_attempts between 1 and 10),
  scoring             text not null default 'best' check (scoring in ('best', 'latest')),
  weightage           numeric(5, 2) not null default 10 check (weightage > 0 and weightage <= 1000),
  negative_marks      numeric(4, 2) not null default 0 check (negative_marks between 0 and 1),
  shuffle             boolean not null default true,
  show_results        text not null default 'after_submit' check (show_results in ('after_submit', 'after_close', 'never')),
  status              text not null default 'draft' check (status in ('draft', 'published', 'closed')),
  created_by          uuid,
  created_by_employee uuid,
  created_at          timestamptz not null default now(),
  published_at        timestamptz,
  unique (tenant_id, id),
  check (close_at is null or open_at is null or close_at > open_at),
  foreign key (tenant_id, course_id) references courses (tenant_id, id) on delete cascade,
  foreign key (tenant_id, created_by_employee) references employees (tenant_id, id) on delete set null (created_by_employee)
);
create index quizzes_class_ix on quizzes (tenant_id, course_id, semester);

create table quiz_questions (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null default app_tenant() references tenants (id) on delete cascade,
  quiz_id     uuid not null,
  position    int not null,
  kind        text not null check (kind in ('single', 'multiple', 'truefalse', 'short')),
  text        text not null,
  marks       numeric(5, 2) not null default 1 check (marks > 0 and marks <= 100),
  options     jsonb not null default '[]',      -- [{ "text": "...", "correct": true|false }]
  answers     jsonb not null default '[]',      -- accepted answers for a short-answer question
  explanation text not null default '',
  unique (tenant_id, id),
  foreign key (tenant_id, quiz_id) references quizzes (tenant_id, id) on delete cascade
);
create index quiz_questions_ix on quiz_questions (tenant_id, quiz_id, position);

create table quiz_attempts (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null default app_tenant() references tenants (id) on delete cascade,
  quiz_id          uuid not null,
  student_id       uuid not null,
  attempt_no       int not null,
  status           text not null default 'in_progress' check (status in ('in_progress', 'submitted')),
  started_at       timestamptz not null default now(),
  deadline_at      timestamptz not null,
  submitted_at     timestamptz,
  auto_submitted   boolean not null default false,
  question_order   jsonb not null default '[]',
  option_orders    jsonb not null default '{}',
  answers          jsonb not null default '{}',
  score            numeric(6, 2),
  max_score        numeric(6, 2),
  unique (tenant_id, id),
  unique (quiz_id, student_id, attempt_no),
  foreign key (tenant_id, quiz_id) references quizzes (tenant_id, id) on delete cascade,
  foreign key (tenant_id, student_id) references students (tenant_id, id) on delete cascade
);
create index quiz_attempts_student_ix on quiz_attempts (tenant_id, student_id);
-- A student can have only one attempt running per quiz, whatever happens at the same instant
create unique index quiz_attempts_one_open on quiz_attempts (tenant_id, quiz_id, student_id) where status = 'in_progress';

create table quiz_extra_attempts (
  tenant_id  uuid not null default app_tenant() references tenants (id) on delete cascade,
  quiz_id    uuid not null,
  student_id uuid not null,
  extra      int not null default 1 check (extra between 0 and 10),
  granted_by uuid,
  primary key (quiz_id, student_id),
  foreign key (tenant_id, quiz_id) references quizzes (tenant_id, id) on delete cascade,
  foreign key (tenant_id, student_id) references students (tenant_id, id) on delete cascade
);

do $$
declare t text;
begin
  foreach t in array array['learning_courses', 'learning_lessons', 'learning_assignments', 'learning_enrollments', 'learning_progress',
                           'quizzes', 'quiz_questions', 'quiz_attempts', 'quiz_extra_attempts'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format(
      'create policy tenant_isolation on %I using (tenant_id = (select app_tenant())) with check (tenant_id = (select app_tenant()))', t);
  end loop;
end $$;

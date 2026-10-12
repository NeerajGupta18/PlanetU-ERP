-- =====================================================================
-- Grievance and feedback (Phase 3)
--
-- Grievances: a student, parent or employee raises a ticket (optionally hiding their name from the office); the
-- office replies and moves it along: open -> in_progress -> resolved -> closed. A reply from the person who raised
-- it re-opens a resolved ticket.
--
-- Feedback: the office builds a form (rating and comment questions) for students or staff, optionally about one
-- faculty member or limited to one course. Answers are anonymous: `feedback_submissions` only remembers WHO has
-- answered (so nobody answers twice) and `feedback_answers` keeps the answers with no link to a person.
-- =====================================================================
create table grievances (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null default app_tenant() references tenants (id) on delete cascade,
  ticket_no    text not null,
  raised_by    uuid not null,
  raiser_role  text not null check (raiser_role in ('student', 'employee', 'parent')),
  student_id   uuid,
  category     text not null check (category in ('Academic', 'Fees', 'Hostel', 'Transport', 'Facilities', 'Staff conduct', 'Safety', 'Other')),
  subject      text not null check (length(subject) between 1 and 150),
  details      text not null check (length(details) between 1 and 3000),
  anonymous    boolean not null default false,
  status       text not null default 'open' check (status in ('open', 'in_progress', 'resolved', 'closed')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  resolved_at  timestamptz,
  unique (tenant_id, id),
  unique (tenant_id, ticket_no),
  foreign key (tenant_id, raised_by) references users (tenant_id, id) on delete cascade,
  foreign key (tenant_id, student_id) references students (tenant_id, id) on delete cascade
);
create index grievances_status_ix on grievances (tenant_id, status, updated_at desc);
create index grievances_raiser_ix on grievances (tenant_id, raised_by, created_at desc);

create table grievance_messages (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null default app_tenant() references tenants (id) on delete cascade,
  grievance_id  uuid not null,
  from_office   boolean not null,
  author_id     uuid,
  body          text not null check (length(body) between 1 and 3000),
  created_at    timestamptz not null default now(),
  foreign key (tenant_id, grievance_id) references grievances (tenant_id, id) on delete cascade,
  foreign key (tenant_id, author_id) references users (tenant_id, id) on delete set null (author_id)
);
create index grievance_messages_ix on grievance_messages (tenant_id, grievance_id, created_at);

create table feedback_forms (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null default app_tenant() references tenants (id) on delete cascade,
  title              text not null check (length(title) between 1 and 150),
  description        text not null default '' check (length(description) <= 1000),
  audience           text not null default 'students' check (audience in ('students', 'employees')),
  course_id          uuid,
  about_employee_id  uuid,
  status             text not null default 'draft' check (status in ('draft', 'open', 'closed')),
  closes_on          date,
  created_by         uuid,
  created_at         timestamptz not null default now(),
  unique (tenant_id, id),
  check (course_id is null or audience = 'students'),
  foreign key (tenant_id, course_id) references courses (tenant_id, id) on delete cascade,
  foreign key (tenant_id, about_employee_id) references employees (tenant_id, id) on delete set null (about_employee_id),
  foreign key (tenant_id, created_by) references users (tenant_id, id) on delete set null (created_by)
);

create table feedback_questions (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null default app_tenant() references tenants (id) on delete cascade,
  form_id    uuid not null,
  position   int not null,
  text       text not null check (length(text) between 1 and 300),
  kind       text not null check (kind in ('rating', 'text')),
  required   boolean not null default true,
  unique (tenant_id, id),
  foreign key (tenant_id, form_id) references feedback_forms (tenant_id, id) on delete cascade
);
create index feedback_questions_ix on feedback_questions (tenant_id, form_id, position);

create table feedback_submissions (
  tenant_id     uuid not null default app_tenant() references tenants (id) on delete cascade,
  form_id       uuid not null,
  user_id       uuid not null,
  submitted_on  date not null default current_date,
  primary key (tenant_id, form_id, user_id),
  foreign key (tenant_id, form_id) references feedback_forms (tenant_id, id) on delete cascade,
  foreign key (tenant_id, user_id) references users (tenant_id, id) on delete cascade
);

create table feedback_answers (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null default app_tenant() references tenants (id) on delete cascade,
  form_id      uuid not null,
  question_id  uuid not null,
  response_id  uuid not null,
  rating       smallint check (rating between 1 and 5),
  comment      text check (length(comment) <= 1000),
  answered_on  date not null default current_date,
  foreign key (tenant_id, form_id) references feedback_forms (tenant_id, id) on delete cascade,
  foreign key (tenant_id, question_id) references feedback_questions (tenant_id, id) on delete cascade
);
create index feedback_answers_ix on feedback_answers (tenant_id, form_id, question_id);

do $$
declare t text;
begin
  foreach t in array array['grievances', 'grievance_messages', 'feedback_forms', 'feedback_questions', 'feedback_submissions', 'feedback_answers'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy tenant_isolation on %I using (tenant_id = (select app_tenant())) with check (tenant_id = (select app_tenant()))', t);
  end loop;
end $$;

-- The new module is switched on for institutes that already exist (new ones get it from their preset)
select set_config('app.is_platform', 'on', true);
update tenants set modules = array_append(modules, 'grievance') where not ('grievance' = any (modules));

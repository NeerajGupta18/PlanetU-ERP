-- =====================================================================
-- Notice board (Phase 2)
--
-- The `notices` table already existed (a simple list the sample data filled in). It now becomes a real
-- notice board; existing rows keep working and simply become "for everyone, published".
--
--   audience    everyone, only students, or only staff. A student notice can be limited to one class/course.
--   notice_date the day it starts showing (a date in the future means "scheduled")
--   expires_on  the last day it shows (empty = until removed)
--   pinned      stays at the top; priority 'important' is highlighted
--   status      draft (only the office sees it) or published
--   notice_reads  who has opened which notice, so people can see what is new
-- =====================================================================
alter table notices
  add column audience   text not null default 'all' check (audience in ('all', 'students', 'employees')),
  add column course_id  uuid,
  add column priority   text not null default 'normal' check (priority in ('normal', 'important')),
  add column pinned     boolean not null default false,
  add column status     text not null default 'published' check (status in ('draft', 'published')),
  add column expires_on date,
  add column created_by uuid,
  add column created_at timestamptz not null default now(),
  add column updated_at timestamptz not null default now(),
  add constraint notices_expiry_ck check (expires_on is null or expires_on >= notice_date),
  add constraint notices_course_fk foreign key (tenant_id, course_id) references courses (tenant_id, id) on delete cascade,
  add constraint notices_created_by_fk foreign key (tenant_id, created_by) references users (tenant_id, id) on delete set null (created_by);
create index notices_feed_ix on notices (tenant_id, status, notice_date desc);

create table notice_reads (
  tenant_id  uuid not null default app_tenant() references tenants (id) on delete cascade,
  notice_id  uuid not null,
  user_id    uuid not null,
  read_at    timestamptz not null default now(),
  primary key (tenant_id, notice_id, user_id),
  foreign key (tenant_id, notice_id) references notices (tenant_id, id) on delete cascade,
  foreign key (tenant_id, user_id) references users (tenant_id, id) on delete cascade
);

alter table notice_reads enable row level security;
alter table notice_reads force row level security;
create policy tenant_isolation on notice_reads
  using (tenant_id = (select app_tenant())) with check (tenant_id = (select app_tenant()));

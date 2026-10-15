-- =====================================================================
-- In-app notifications (UI Phase 2)
--
-- The bell in the top bar. Every role gets short messages about things that happened to them: leave approved,
-- assignment graded, certificate ready, a reply on a ticket, a placement update, a visitor at the gate, a payslip,
-- or (for a parent) the child marked absent. Each message links to the page it is about and can be marked read.
-- Reminders that depend on today's date (fees falling due, work due soon, approvals waiting) are worked out when
-- the bell is opened and are not stored here.
-- =====================================================================
create table user_notifications (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null default app_tenant() references tenants (id) on delete cascade,
  user_id     uuid not null,
  kind        text not null check (length(kind) between 1 and 40),
  title       text not null check (length(title) between 1 and 200),
  body        text not null default '' check (length(body) <= 500),
  link        text not null default '' check (length(link) <= 300),
  created_at  timestamptz not null default now(),
  read_at     timestamptz,
  unique (tenant_id, id),
  foreign key (tenant_id, user_id) references users (tenant_id, id) on delete cascade
);
create index user_notifications_user_ix on user_notifications (tenant_id, user_id, created_at desc);
create index user_notifications_unread_ix on user_notifications (tenant_id, user_id) where read_at is null;

alter table user_notifications enable row level security;
alter table user_notifications force row level security;
create policy tenant_isolation on user_notifications
  using (tenant_id = (select app_tenant())) with check (tenant_id = (select app_tenant()));

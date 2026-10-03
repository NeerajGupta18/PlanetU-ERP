-- Account security + email notifications

alter table users
  add column must_change_password boolean not null default false,
  add column password_changed_at  timestamptz not null default now();

-- Outbox: requests queue mail here (inside their own transaction); a worker delivers it.
-- tenant_id NULL = platform-level mail (e.g. the vendor's own Super Admin).
create table notifications (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid default app_tenant() references tenants (id) on delete cascade,
  to_email        text not null,
  template        text not null,
  subject         text not null,
  text_body       text not null,
  html_body       text not null,
  status          text not null default 'queued' check (status in ('queued', 'sent', 'failed')),
  attempts        int not null default 0,
  last_error      text,
  next_attempt_at timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  sent_at         timestamptz
);
create index notifications_queue_ix on notifications (status, next_attempt_at) where status = 'queued';

-- One-time tokens for "set / reset your password" links. Only the hash is stored.
create table password_resets (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid default app_tenant() references tenants (id) on delete cascade,
  user_id    uuid not null references users (id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at    timestamptz,
  created_at timestamptz not null default now()
);
create index password_resets_user_ix on password_resets (user_id);

alter table notifications enable row level security;
alter table notifications force row level security;
create policy notifications_scope on notifications
  using (tenant_id = (select app_tenant()) or (tenant_id is null and (select app_platform())))
  with check (tenant_id = (select app_tenant()) or (tenant_id is null and (select app_platform())));

-- Reset links are opened by signed-out people, so lookup happens in platform context (like login)
alter table password_resets enable row level security;
alter table password_resets force row level security;
create policy resets_scope on password_resets
  using (tenant_id = (select app_tenant()) or (select app_platform()))
  with check (tenant_id = (select app_tenant()) or (select app_platform()));

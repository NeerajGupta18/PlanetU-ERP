-- =====================================================================
-- Parent consent, and demo requests from the public page
--
-- user_consents: what a parent agreed to at first sign-in, for which purpose, under which wording (version),
-- and when. Rows are only ever added: agreeing again, or withdrawing an optional purpose, adds a new row, so the
-- history stays. The newest row per purpose is the one that counts.
--
-- demo_requests: the "Book a demo" form on the public landing page. It belongs to no institute, so only the
-- platform (the vendor console) may read or write it.
-- =====================================================================
create table user_consents (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null default app_tenant() references tenants (id) on delete cascade,
  user_id      uuid not null,
  purpose      text not null check (purpose in ('records', 'messages')),
  granted      boolean not null,
  version      text not null check (length(version) between 1 and 20),
  ip           text,
  user_agent   text check (length(user_agent) <= 300),
  recorded_at  timestamptz not null default now(),
  foreign key (tenant_id, user_id) references users (tenant_id, id) on delete cascade
);
create index user_consents_user_ix on user_consents (tenant_id, user_id, purpose, recorded_at desc);

alter table user_consents enable row level security;
alter table user_consents force row level security;
create policy tenant_isolation on user_consents
  using (tenant_id = (select app_tenant())) with check (tenant_id = (select app_tenant()));

create table demo_requests (
  id              uuid primary key default gen_random_uuid(),
  name            text not null check (length(name) between 2 and 100),
  institute       text not null check (length(institute) between 2 and 150),
  institute_type  text not null check (institute_type in ('school', 'college', 'university', 'other')),
  phone           text not null check (length(phone) between 6 and 20),
  email           text not null check (length(email) between 5 and 150),
  city            text check (length(city) <= 80),
  students        text check (length(students) <= 20),
  message         text check (length(message) <= 1000),
  status          text not null default 'new' check (status in ('new', 'contacted', 'closed')),
  created_at      timestamptz not null default now()
);
create index demo_requests_created_ix on demo_requests (created_at desc);

alter table demo_requests enable row level security;
alter table demo_requests force row level security;
create policy demo_requests_platform on demo_requests
  for all using ((select app_platform())) with check ((select app_platform()));

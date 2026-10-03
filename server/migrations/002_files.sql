alter table users add constraint users_tenant_id_uq unique (tenant_id, id);

-- Uploaded files. Bytes live in object storage (local disk in dev, S3-compatible later) under a
-- key that starts with the tenant id; this table is the index and the authorisation record.
create table files (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null default app_tenant() references tenants (id) on delete cascade,
  created_by    uuid,
  purpose       text not null default 'general',
  original_name text not null,
  mime          text not null,
  size_bytes    int not null check (size_bytes > 0),
  sha256        text not null,
  storage_key   text not null unique,
  created_at    timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, created_by) references users (tenant_id, id) on delete set null (created_by)
);
create index files_owner_ix on files (tenant_id, created_by);

alter table files enable row level security;
alter table files force row level security;
create policy tenant_isolation on files
  using (tenant_id = (select app_tenant())) with check (tenant_id = (select app_tenant()));

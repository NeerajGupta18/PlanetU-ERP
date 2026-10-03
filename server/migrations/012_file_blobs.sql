-- =====================================================================
-- File bytes inside PostgreSQL (used when STORAGE_DRIVER=db, e.g. on hosts with no persistent disk).
-- Always created, so switching the driver later needs no migration. Same per-institute isolation as every other table.
-- =====================================================================
create table file_blobs (
  storage_key text primary key,
  tenant_id   uuid not null default app_tenant() references tenants (id) on delete cascade,
  data        bytea not null,
  created_at  timestamptz not null default now()
);
create index file_blobs_tenant_ix on file_blobs (tenant_id);

alter table file_blobs enable row level security;
alter table file_blobs force row level security;
create policy tenant_isolation on file_blobs
  using (tenant_id = (select app_tenant())) with check (tenant_id = (select app_tenant()));

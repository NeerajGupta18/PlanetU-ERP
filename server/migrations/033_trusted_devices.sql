-- =====================================================================
-- Fingerprint sign-in on the Android app: trusted devices
--
-- trusted_devices: one row per account per phone where the person chose "Use fingerprint next time". The phone
-- keeps a long random token in its secure storage; the server keeps ONLY the SHA-256 hash of it, so a copy of
-- this table cannot be used to sign in. A token signs in only while the row is not revoked, not past its
-- expiry (30 days after it was issued), the account is active, and its password has not changed since.
--
-- Institute accounts only (the vendor's own owner account keeps its password), isolated per institute like
-- every other table.
--
-- A new table only: nothing existing is changed.
-- =====================================================================
create table trusted_devices (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null default app_tenant() references tenants (id) on delete cascade,
  user_id         uuid not null,
  label           text not null check (length(label) between 1 and 80),
  token_hash      text not null unique check (length(token_hash) = 64),
  created_at      timestamptz not null default now(),
  last_used_at    timestamptz,
  expires_at      timestamptz not null default now() + interval '30 days',
  revoked_at      timestamptz,
  revoked_reason  text check (revoked_reason in ('forget', 'password', 'deactivated', 'removed', 'removed_by_admin')),
  foreign key (tenant_id, user_id) references users (tenant_id, id) on delete cascade
);
create index trusted_devices_user_ix on trusted_devices (tenant_id, user_id, created_at desc);

alter table trusted_devices enable row level security;
alter table trusted_devices force row level security;
create policy tenant_isolation on trusted_devices
  using (tenant_id = (select app_tenant())) with check (tenant_id = (select app_tenant()));

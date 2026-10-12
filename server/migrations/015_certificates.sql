-- =====================================================================
-- Certificates (Phase 2)
--
-- A student asks for a certificate (or the office issues one over the counter). When it is issued it gets a
-- number from the institute's own series, and the PDF is produced from the saved details - so the same
-- certificate can be downloaded again and always reads the same.
--
--   cert_type  bonafide | character | noc | transfer
--   status     requested -> issued, or requested -> rejected (with a reason)
--   details    type-specific extras, e.g. a transfer certificate's leaving date, reason and conduct
-- =====================================================================
create table certificate_requests (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null default app_tenant() references tenants (id) on delete cascade,
  student_id      uuid not null,
  cert_type       text not null check (cert_type in ('bonafide', 'character', 'noc', 'transfer')),
  purpose         text not null default '' check (length(purpose) <= 300),
  status          text not null default 'requested' check (status in ('requested', 'issued', 'rejected')),
  certificate_no  text,
  details         jsonb not null default '{}',
  remark          text not null default '',
  requested_by    uuid,
  decided_by      uuid,
  issued_at       timestamptz,
  decided_at      timestamptz,
  created_at      timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, certificate_no),
  foreign key (tenant_id, student_id) references students (tenant_id, id) on delete cascade,
  foreign key (tenant_id, requested_by) references users (tenant_id, id) on delete set null (requested_by),
  foreign key (tenant_id, decided_by) references users (tenant_id, id) on delete set null (decided_by)
);
create index certificate_requests_status_ix on certificate_requests (tenant_id, status, created_at desc);
create index certificate_requests_student_ix on certificate_requests (tenant_id, student_id, created_at desc);

alter table certificate_requests enable row level security;
alter table certificate_requests force row level security;
create policy tenant_isolation on certificate_requests
  using (tenant_id = (select app_tenant())) with check (tenant_id = (select app_tenant()));

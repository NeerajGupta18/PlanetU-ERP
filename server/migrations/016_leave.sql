-- =====================================================================
-- Leave management (Phase 3)
--
-- An institute sets up its leave types (Casual, Sick...) with a yearly allowance. An employee applies for a type
-- and a date range; the office approves or rejects it. Sundays and holidays on the calendar are not counted as
-- leave days. A leave type with no allowance (days_per_year empty) has no limit, e.g. leave without pay.
--
--   status  pending -> approved | rejected, or cancelled (by the employee)
-- =====================================================================
create table leave_types (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null default app_tenant() references tenants (id) on delete cascade,
  name          text not null check (length(name) between 1 and 60),
  days_per_year numeric(5,1) check (days_per_year is null or days_per_year >= 0),
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  unique (tenant_id, id)
);
create unique index leave_types_name_uq on leave_types (tenant_id, lower(name));

create table leave_requests (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null default app_tenant() references tenants (id) on delete cascade,
  employee_id   uuid not null,
  leave_type_id uuid not null,
  from_date     date not null,
  to_date       date not null,
  half_day      boolean not null default false,
  days          numeric(5,1) not null check (days > 0),
  reason        text not null default '' check (length(reason) <= 500),
  status        text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  remark        text not null default '' check (length(remark) <= 300),
  applied_by    uuid,
  decided_by    uuid,
  decided_at    timestamptz,
  created_at    timestamptz not null default now(),
  unique (tenant_id, id),
  check (to_date >= from_date),
  check (not half_day or from_date = to_date),
  foreign key (tenant_id, employee_id) references employees (tenant_id, id) on delete cascade,
  foreign key (tenant_id, leave_type_id) references leave_types (tenant_id, id),
  foreign key (tenant_id, applied_by) references users (tenant_id, id) on delete set null (applied_by),
  foreign key (tenant_id, decided_by) references users (tenant_id, id) on delete set null (decided_by)
);
create index leave_requests_status_ix on leave_requests (tenant_id, status, from_date);
create index leave_requests_emp_ix on leave_requests (tenant_id, employee_id, from_date);

do $$
declare t text;
begin
  foreach t in array array['leave_types', 'leave_requests'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy tenant_isolation on %I using (tenant_id = (select app_tenant())) with check (tenant_id = (select app_tenant()))', t);
  end loop;
end $$;

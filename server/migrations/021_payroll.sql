-- =====================================================================
-- Payroll (Phase 4)
--
-- Each employee has a monthly salary (basic, HRA, other allowances, PF as a percent of basic, other fixed deductions).
-- A monthly run makes one payslip per employee with a salary. Days of approved leave without pay in that month are
-- deducted at gross / days in the month. A run is a draft (can be made again) until it is finalised; only then can
-- employees open their payslips. Amounts on a payslip are copied at run time, so later salary changes do not alter it.
-- =====================================================================
create table employee_salaries (
  tenant_id         uuid not null default app_tenant() references tenants (id) on delete cascade,
  employee_id       uuid not null,
  basic             numeric(12,2) not null check (basic >= 0),
  hra               numeric(12,2) not null default 0 check (hra >= 0),
  allowances        numeric(12,2) not null default 0 check (allowances >= 0),
  pf_percent        numeric(5,2) not null default 12 check (pf_percent between 0 and 100),
  other_deductions  numeric(12,2) not null default 0 check (other_deductions >= 0),
  updated_at        timestamptz not null default now(),
  primary key (tenant_id, employee_id),
  foreign key (tenant_id, employee_id) references employees (tenant_id, id) on delete cascade
);

create table payroll_runs (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null default app_tenant() references tenants (id) on delete cascade,
  month         text not null check (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  status        text not null default 'draft' check (status in ('draft', 'finalised')),
  created_by    uuid,
  finalised_at  timestamptz,
  created_at    timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, month),
  foreign key (tenant_id, created_by) references users (tenant_id, id) on delete set null (created_by)
);

create table payslips (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null default app_tenant() references tenants (id) on delete cascade,
  run_id           uuid not null,
  employee_id      uuid not null,
  basic            numeric(12,2) not null,
  hra              numeric(12,2) not null,
  allowances       numeric(12,2) not null,
  gross            numeric(12,2) not null,
  pf               numeric(12,2) not null,
  other_deductions numeric(12,2) not null,
  unpaid_days      numeric(5,1) not null default 0,
  unpaid_amount    numeric(12,2) not null default 0,
  total_deductions numeric(12,2) not null,
  net              numeric(12,2) not null,
  unique (tenant_id, id),
  unique (tenant_id, run_id, employee_id),
  foreign key (tenant_id, run_id) references payroll_runs (tenant_id, id) on delete cascade,
  foreign key (tenant_id, employee_id) references employees (tenant_id, id) on delete cascade
);
create index payslips_emp_ix on payslips (tenant_id, employee_id);

do $$
declare t text;
begin
  foreach t in array array['employee_salaries', 'payroll_runs', 'payslips'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy tenant_isolation on %I using (tenant_id = (select app_tenant())) with check (tenant_id = (select app_tenant()))', t);
  end loop;
end $$;

-- =====================================================================
-- Staff roles (UI Phase 3)
--
-- Real institutes have office staff who are not teachers: a principal, heads of department, an accountant, an
-- admission officer, the exam cell, a librarian, hostel wardens, a transport in-charge, a placement officer and
-- gate security. Each of them signs in with their ordinary employee login; the admin gives them one or more staff
-- roles, and they then see only the office pages that role needs (see server/src/config/staffRoles.js).
-- A head of department is tied to one department and only sees that department's leave and attendance.
-- =====================================================================
create table staff_roles (
  tenant_id      uuid not null default app_tenant() references tenants (id) on delete cascade,
  employee_id    uuid not null,
  role           text not null check (role in ('principal', 'hod', 'accountant', 'admission_officer', 'exam_cell',
                                                'librarian', 'warden', 'transport_incharge', 'placement_officer', 'gate_security')),
  department_id  uuid,
  granted_by     uuid,
  created_at     timestamptz not null default now(),
  primary key (tenant_id, employee_id, role),
  check ((role = 'hod') = (department_id is not null)),
  foreign key (tenant_id, employee_id) references employees (tenant_id, id) on delete cascade,
  foreign key (tenant_id, department_id) references departments (tenant_id, id) on delete cascade,
  foreign key (tenant_id, granted_by) references users (tenant_id, id) on delete set null (granted_by)
);
create index staff_roles_role_ix on staff_roles (tenant_id, role);

alter table staff_roles enable row level security;
alter table staff_roles force row level security;
create policy tenant_isolation on staff_roles
  using (tenant_id = (select app_tenant())) with check (tenant_id = (select app_tenant()));

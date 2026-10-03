-- =====================================================================
-- Fees & Payments
--
-- A fee structure is a per-course TEMPLATE ("BCA Year 1 2026-27": Tuition 50000,
-- Exam 2000...). Assigning it to a student COPIES its items into student_fee_items
-- as concrete charges, so editing the template later never changes what an
-- already-assigned student owes (the same reason real accounting systems don't
-- let you retroactively edit an issued invoice).
-- A payment can be split across several fee items (payment_allocations), and a
-- fee item can be paid off by several payments (fees paid in instalments).
-- =====================================================================
create table fee_structures (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null default app_tenant() references tenants (id) on delete cascade,
  course_id      uuid not null,
  name           text not null,
  academic_year  text not null,
  created_at     timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, course_id) references courses (tenant_id, id)
);

create table fee_structure_items (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null default app_tenant() references tenants (id) on delete cascade,
  structure_id uuid not null,
  label        text not null,
  amount       numeric(12, 2) not null check (amount > 0),
  due_date     date,
  unique (tenant_id, id),
  foreign key (tenant_id, structure_id) references fee_structures (tenant_id, id) on delete cascade
);

-- Concrete charges against one student. `source` distinguishes what created the row.
create table student_fee_items (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null default app_tenant() references tenants (id) on delete cascade,
  student_id          uuid not null,
  label               text not null,
  amount              numeric(12, 2) not null check (amount > 0),
  due_date            date,
  status              text not null default 'unpaid' check (status in ('unpaid', 'partial', 'paid', 'waived')),
  source              text not null default 'manual' check (source in ('structure', 'manual')),
  structure_id        uuid,
  waived_reason        text,
  created_at          timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, student_id) references students (tenant_id, id) on delete cascade,
  foreign key (tenant_id, structure_id) references fee_structures (tenant_id, id)
);
create index student_fee_items_student_ix on student_fee_items (tenant_id, student_id, status);

create table payments (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null default app_tenant() references tenants (id) on delete cascade,
  student_id   uuid not null,
  receipt_no   text not null,
  amount       numeric(12, 2) not null check (amount > 0),
  method       text not null check (method in ('cash', 'cheque', 'bank_transfer', 'upi', 'card', 'online')),
  reference    text not null default '',
  note         text not null default '',
  received_by  uuid,
  paid_at      timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, receipt_no),
  foreign key (tenant_id, student_id) references students (tenant_id, id) on delete cascade,
  foreign key (tenant_id, received_by) references users (tenant_id, id) on delete set null (received_by)
);
create index payments_student_ix on payments (tenant_id, student_id, paid_at desc);

create table payment_allocations (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null default app_tenant() references tenants (id) on delete cascade,
  payment_id    uuid not null,
  fee_item_id   uuid not null,
  amount        numeric(12, 2) not null check (amount > 0),
  unique (tenant_id, id),
  foreign key (tenant_id, payment_id) references payments (tenant_id, id) on delete cascade,
  foreign key (tenant_id, fee_item_id) references student_fee_items (tenant_id, id) on delete cascade
);
create index payment_allocations_item_ix on payment_allocations (tenant_id, fee_item_id);

-- =====================================================================
-- Library
-- =====================================================================
create table books (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null default app_tenant() references tenants (id) on delete cascade,
  isbn             text not null default '',
  title            text not null,
  author           text not null default '',
  publisher        text not null default '',
  category         text not null default '',
  shelf_location   text not null default '',
  total_copies     int not null default 1 check (total_copies >= 0),
  available_copies int not null default 1 check (available_copies >= 0),
  created_at       timestamptz not null default now(),
  unique (tenant_id, id),
  check (available_copies <= total_copies)
);
create index books_search_ix on books (tenant_id, lower(title));

create table book_issues (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null default app_tenant() references tenants (id) on delete cascade,
  book_id       uuid not null,
  borrower_type text not null check (borrower_type in ('student', 'employee')),
  student_id    uuid,
  employee_id   uuid,
  issued_at     timestamptz not null default now(),
  due_date      date not null,
  returned_at   timestamptz,
  fine_amount   numeric(10, 2) not null default 0,
  fine_paid     boolean not null default false,
  issued_by     uuid,
  unique (tenant_id, id),
  check ((borrower_type = 'student') = (student_id is not null)),
  check ((borrower_type = 'employee') = (employee_id is not null)),
  foreign key (tenant_id, book_id) references books (tenant_id, id) on delete cascade,
  foreign key (tenant_id, student_id) references students (tenant_id, id) on delete cascade,
  foreign key (tenant_id, employee_id) references employees (tenant_id, id) on delete cascade,
  foreign key (tenant_id, issued_by) references users (tenant_id, id) on delete set null (issued_by)
);
create index book_issues_open_ix on book_issues (tenant_id, book_id) where returned_at is null;
create index book_issues_student_ix on book_issues (tenant_id, student_id) where student_id is not null;
create index book_issues_employee_ix on book_issues (tenant_id, employee_id) where employee_id is not null;

-- =====================================================================
-- Assets
-- =====================================================================
create table assets (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null default app_tenant() references tenants (id) on delete cascade,
  asset_tag         text not null,
  name              text not null,
  category          text not null default '',
  department_id     uuid,
  location          text not null default '',
  purchase_date     date,
  purchase_value    numeric(12, 2),
  status            text not null default 'available' check (status in ('available', 'in_use', 'maintenance', 'retired')),
  assigned_to       uuid,
  notes             text not null default '',
  created_at        timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, department_id) references departments (tenant_id, id) on delete set null (department_id),
  foreign key (tenant_id, assigned_to) references employees (tenant_id, id) on delete set null (assigned_to)
);
create unique index assets_tag_uq on assets (tenant_id, lower(asset_tag));
create index assets_status_ix on assets (tenant_id, status);

create table asset_logs (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null default app_tenant() references tenants (id) on delete cascade,
  asset_id    uuid not null,
  action      text not null check (action in ('created', 'assigned', 'unassigned', 'status_change', 'maintenance')),
  note        text not null default '',
  cost        numeric(12, 2),
  logged_by   uuid,
  logged_at   timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, asset_id) references assets (tenant_id, id) on delete cascade,
  foreign key (tenant_id, logged_by) references users (tenant_id, id) on delete set null (logged_by)
);
create index asset_logs_asset_ix on asset_logs (tenant_id, asset_id, logged_at desc);

-- =====================================================================
-- Row Level Security - same tenant_isolation policy as every other tenant table
-- =====================================================================
do $$
declare t text;
begin
  foreach t in array array[
    'fee_structures', 'fee_structure_items', 'student_fee_items', 'payments', 'payment_allocations',
    'books', 'book_issues', 'assets', 'asset_logs'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format(
      'create policy tenant_isolation on %I using (tenant_id = (select app_tenant())) with check (tenant_id = (select app_tenant()))', t);
  end loop;
end $$;

-- =====================================================================
-- Online fee payments (Razorpay)
--
-- One row per Razorpay ORDER (an intent to pay a fixed amount). The ERP's own ledger is still
-- `payments` + `payment_allocations`: when Razorpay confirms the money, the order is
-- reconciled by recording an ordinary `payments` row (method 'online', reference = the Razorpay
-- payment id) through the same allocation logic the admin uses - so receipts, balances and
-- reports need no special-casing for online money.
--
-- status:
--   created       order made, money not (yet) confirmed - includes abandoned checkouts
--   paid          confirmed AND recorded in `payments` (payment_id points at it)
--   needs_review  Razorpay took the money but the ERP could not apply it (e.g. the charge was
--                 settled by cash in the meantime). An admin must refund or record it manually.
--   resolved      an admin dealt with a needs_review order
-- =====================================================================
create table online_payment_orders (
  id                  uuid primary key,
  tenant_id           uuid not null default app_tenant() references tenants (id) on delete cascade,
  student_id          uuid not null,
  fee_item_id         uuid,
  amount              numeric(12, 2) not null check (amount > 0),
  currency            text not null default 'INR',
  razorpay_order_id   text not null unique,
  razorpay_payment_id text unique,
  status              text not null default 'created' check (status in ('created', 'paid', 'needs_review', 'resolved')),
  method              text,
  failure_reason      text,
  payment_id          uuid,
  created_by          uuid,
  created_at          timestamptz not null default now(),
  paid_at             timestamptz,
  unique (tenant_id, id),
  foreign key (tenant_id, student_id) references students (tenant_id, id) on delete cascade,
  foreign key (tenant_id, fee_item_id) references student_fee_items (tenant_id, id) on delete set null (fee_item_id),
  foreign key (tenant_id, payment_id) references payments (tenant_id, id) on delete set null (payment_id)
);
create index online_payment_orders_student_ix on online_payment_orders (tenant_id, student_id, created_at desc);
create index online_payment_orders_status_ix on online_payment_orders (tenant_id, status);

alter table online_payment_orders enable row level security;
alter table online_payment_orders force row level security;
create policy tenant_isolation on online_payment_orders
  using (tenant_id = (select app_tenant())) with check (tenant_id = (select app_tenant()));

-- =====================================================================
-- Vendor-side billing: PlanetU charges each institute a subscription.
--
--   billing_plans         the price list (platform-wide; edited in the vendor console)
--   tenant_subscriptions  one row per institute: plan, cycle, status, the period it has paid for
--   billing_profiles      who to invoice: legal name, GSTIN, address, state (decides CGST+SGST vs IGST)
--   billing_invoices      tax invoices (+ billing_invoice_lines); numbered consecutively per financial year
--   billing_payments      money received against an invoice (online via Razorpay, or recorded offline)
--   billing_orders        one Razorpay order per payment attempt (mirrors online_payment_orders for fees)
--   billing_notices       which reminder emails were sent for an invoice (so each is sent once)
--   billing_counters      the invoice number sequence, per financial year
--
-- Access: an institute may READ its own rows; only the platform (vendor console, billing worker,
-- Razorpay webhook) may write. A tenant admin therefore cannot mark their own invoice paid, even
-- through a bug. Amounts are stored in rupees (numeric); the gateway is the only place paise appear.
--
-- Subscription status:
--   trialing   free trial, no invoice yet
--   active     the current period is paid for
--   past_due   an invoice is unpaid past its due date, still inside the grace period (access continues)
--   suspended  grace period over, or trial ended, or cancelled: the institute is locked (admins can still
--              open the Billing page to pay, which restores access automatically)
-- =====================================================================

alter table tenants add column suspension_reason text check (suspension_reason in ('manual', 'billing'));
update tenants set suspension_reason = 'manual' where status = 'suspended';

create table billing_plans (
  key                 text primary key,
  name                text not null,
  description         text not null default '',
  monthly_price       numeric(12, 2) not null check (monthly_price >= 0),
  annual_price        numeric(12, 2) not null check (annual_price >= 0),
  included_students   int not null default 0 check (included_students >= 0),
  extra_student_price numeric(10, 2) not null default 0 check (extra_student_price >= 0),
  features            jsonb not null default '[]',
  selectable          boolean not null default true,   -- can an institute choose it themselves?
  sort_order          int not null default 0,
  updated_at          timestamptz not null default now()
);

-- The starting price list (all prices exclude GST; editable any time in the vendor console).
insert into billing_plans (key, name, description, monthly_price, annual_price, included_students, extra_student_price, features, selectable, sort_order) values
  ('trial',    'Free trial', 'Try everything for a few weeks. No card needed.',                       0,        0,         10000, 0,
     '["Full access while you evaluate"]', false, 0),
  ('basic',    'Basic',      'For small schools and coaching institutes getting started.',            1999.00,  19990.00,  300,   8.00,
     '["Up to 300 students included","Every module your institute uses","Email support"]', true, 1),
  ('standard', 'Standard',   'For growing schools and colleges that run the whole institute on it.',  4999.00,  49990.00,  1000,  5.00,
     '["Up to 1,000 students included","Every module your institute uses","Email support","Lower cost per extra student"]', true, 2),
  ('premium',  'Premium',    'For large institutions and groups with priority needs.',                9999.00,  99990.00,  3000,  3.00,
     '["Up to 3,000 students included","Every module your institute uses","Priority support","Lowest cost per extra student"]', true, 3);

create table tenant_subscriptions (
  tenant_id            uuid primary key references tenants (id) on delete cascade,
  plan_key             text not null references billing_plans (key),
  cycle                text not null default 'monthly' check (cycle in ('monthly', 'annual')),
  status               text not null default 'trialing' check (status in ('trialing', 'active', 'past_due', 'suspended')),
  suspended_reason     text check (suspended_reason in ('unpaid', 'trial_ended', 'cancelled')),
  trial_ends_on        date,
  current_period_start date,
  current_period_end   date,                              -- paid up to (and not including) this date
  pending_plan_key     text references billing_plans (key),
  pending_cycle        text check (pending_cycle in ('monthly', 'annual')),
  custom_monthly_price numeric(12, 2) check (custom_monthly_price >= 0),   -- a negotiated base price, replaces the plan's
  discount_percent     numeric(5, 2) not null default 0 check (discount_percent between 0 and 100),
  grace_days           int not null default 7 check (grace_days between 0 and 60),
  cancel_at_period_end boolean not null default false,
  trial_notice         text check (trial_notice in ('ending', 'ended')),   -- the last trial reminder sent, so each goes once
  started_on           date not null default current_date,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create table billing_profiles (
  tenant_id     uuid primary key references tenants (id) on delete cascade,
  legal_name    text not null default '',
  gstin         text not null default '',
  address       text not null default '',
  city          text not null default '',
  state         text not null default '',
  pincode       text not null default '',
  billing_email text not null default '',
  billing_phone text not null default '',
  updated_at    timestamptz not null default now()
);

create table billing_counters (
  fy          text primary key,       -- e.g. '2026-27'
  last_number int not null default 0
);

create table billing_invoices (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants (id) on delete cascade,
  number         text not null unique,
  status         text not null default 'open' check (status in ('open', 'paid', 'void')),
  source         text not null default 'auto' check (source in ('auto', 'manual', 'plan_selection')),
  plan_key       text not null,
  cycle          text not null check (cycle in ('monthly', 'annual')),
  period_start   date not null,
  period_end     date not null,
  issue_date     date not null default current_date,
  due_date       date not null,
  subtotal       numeric(12, 2) not null check (subtotal >= 0),
  discount       numeric(12, 2) not null default 0 check (discount >= 0),
  taxable        numeric(12, 2) not null check (taxable >= 0),
  tax_rate       numeric(5, 2) not null default 0,
  cgst           numeric(12, 2) not null default 0,
  sgst           numeric(12, 2) not null default 0,
  igst           numeric(12, 2) not null default 0,
  total          numeric(12, 2) not null check (total >= 0),
  place_of_supply text not null default '',
  customer       jsonb not null default '{}',   -- name, GSTIN, address as they were when issued
  vendor         jsonb not null default '{}',   -- the issuer's details as they were when issued
  paid_at        timestamptz,
  void_reason    text,
  voided_at      timestamptz,
  created_by     uuid,
  created_at     timestamptz not null default now(),
  unique (tenant_id, id),
  check (period_end > period_start)
);
-- One live invoice per institute per period: the worker can run any number of times without double-billing
create unique index billing_invoices_period_uq on billing_invoices (tenant_id, period_start) where status <> 'void';
create index billing_invoices_status_ix on billing_invoices (status, due_date);
create index billing_invoices_tenant_ix on billing_invoices (tenant_id, issue_date desc);

create table billing_invoice_lines (
  id          uuid primary key default gen_random_uuid(),
  invoice_id  uuid not null references billing_invoices (id) on delete cascade,
  position    int not null,
  description text not null,
  quantity    numeric(12, 2) not null default 1,
  unit_price  numeric(12, 2) not null,
  amount      numeric(12, 2) not null
);
create index billing_invoice_lines_ix on billing_invoice_lines (invoice_id, position);

create table billing_payments (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references tenants (id) on delete cascade,
  invoice_id          uuid not null references billing_invoices (id) on delete cascade,
  amount              numeric(12, 2) not null check (amount > 0),
  method              text not null check (method in ('razorpay', 'bank_transfer', 'upi', 'cheque', 'cash', 'other')),
  reference           text not null default '',
  razorpay_payment_id text unique,
  note                text not null default '',
  paid_at             timestamptz not null default now(),
  recorded_by         uuid,
  created_at          timestamptz not null default now()
);
create index billing_payments_invoice_ix on billing_payments (invoice_id);

create table billing_orders (
  id                  uuid primary key,
  tenant_id           uuid not null references tenants (id) on delete cascade,
  invoice_id          uuid not null references billing_invoices (id) on delete cascade,
  amount              numeric(12, 2) not null check (amount > 0),
  razorpay_order_id   text not null unique,
  razorpay_payment_id text unique,
  status              text not null default 'created' check (status in ('created', 'paid', 'needs_review', 'resolved')),
  method              text,
  failure_reason      text,
  created_by          uuid,
  created_at          timestamptz not null default now(),
  paid_at             timestamptz
);
create index billing_orders_invoice_ix on billing_orders (invoice_id);
create index billing_orders_status_ix on billing_orders (status);

create table billing_notices (
  invoice_id uuid not null references billing_invoices (id) on delete cascade,
  kind       text not null,
  sent_at    timestamptz not null default now(),
  primary key (invoice_id, kind)
);

-- Backfill: every existing real institute gets a subscription. Paid plans start as ACTIVE with one month
-- of coverage from today (so nobody is invoiced by surprise on deploy day); trials get 14 days from today.
-- Demo institutes (plan 'demo') are never billed.
insert into tenant_subscriptions (tenant_id, plan_key, status, trial_ends_on, current_period_start, current_period_end)
select id, plan,
       case when plan = 'trial' then 'trialing' else 'active' end,
       case when plan = 'trial' then current_date + 14 end,
       current_date,
       case when plan = 'trial' then current_date + 14 else (current_date + interval '1 month')::date end
from tenants where plan in ('trial', 'basic', 'standard', 'premium');

insert into billing_profiles (tenant_id, legal_name)
select t.id, t.name from tenants t where t.plan in ('trial', 'basic', 'standard', 'premium');

-- Row Level Security: read your own, platform writes everything.
do $$
declare t text;
begin
  foreach t in array array['tenant_subscriptions', 'billing_profiles', 'billing_invoices', 'billing_payments', 'billing_orders'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy %I on %I for select using (tenant_id = (select app_tenant()) or (select app_platform()))', t || '_read', t);
    execute format('create policy %I on %I for all using ((select app_platform())) with check ((select app_platform()))', t || '_write', t);
  end loop;
end $$;

-- Lines and notices follow their invoice
alter table billing_invoice_lines enable row level security;
alter table billing_invoice_lines force row level security;
create policy billing_invoice_lines_read on billing_invoice_lines for select using (
  (select app_platform()) or exists (select 1 from billing_invoices i where i.id = invoice_id and i.tenant_id = (select app_tenant())));
create policy billing_invoice_lines_write on billing_invoice_lines for all using ((select app_platform())) with check ((select app_platform()));

alter table billing_notices enable row level security;
alter table billing_notices force row level security;
create policy billing_notices_all on billing_notices for all using ((select app_platform())) with check ((select app_platform()));

alter table billing_counters enable row level security;
alter table billing_counters force row level security;
create policy billing_counters_all on billing_counters for all using ((select app_platform())) with check ((select app_platform()));

-- The price list is public to every signed-in institute (they see what they would pay); only the platform edits it
alter table billing_plans enable row level security;
alter table billing_plans force row level security;
create policy billing_plans_read on billing_plans for select using (true);
create policy billing_plans_write on billing_plans for all using ((select app_platform())) with check ((select app_platform()));

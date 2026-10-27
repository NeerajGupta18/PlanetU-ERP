-- =====================================================================
-- AI assistants: the run log and the approval inbox
--
-- agent_runs: one row per assistant run - who asked, which assistant, which tools ran (names and checked
-- inputs), what came of it, and the tokens it used (the daily allowance per institute is summed from here).
-- Rows are only ever added: the app's database role cannot change or remove them (see migrate.js).
--
-- agent_proposals: the ONLY thing an assistant can write. A proposal is a change waiting for a person;
-- nothing happens to the institute's data until someone with the right office role approves it, and then the
-- app's own functions (fee reminders, student import, staff import) make the change. Who decided, when, and
-- what the change did are kept on the row.
--
-- Both are new tables: nothing existing is changed.
-- =====================================================================
create table agent_runs (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null default app_tenant() references tenants (id) on delete cascade,
  user_id            uuid,
  actor_role         text,
  agent              text not null check (agent in ('ask', 'brief', 'fees', 'setup')),
  input              text check (length(input) <= 600),
  tools              jsonb not null default '[]',
  outcome            text not null check (outcome in ('answered', 'proposed', 'refused', 'busy', 'capped', 'error')),
  model              text check (length(model) <= 100),
  prompt_tokens      int not null default 0 check (prompt_tokens >= 0),
  completion_tokens  int not null default 0 check (completion_tokens >= 0),
  created_at         timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, user_id) references users (tenant_id, id) on delete set null (user_id)
);
create index agent_runs_tenant_ix on agent_runs (tenant_id, created_at desc);

create table agent_proposals (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null default app_tenant() references tenants (id) on delete cascade,
  run_id         uuid,
  agent          text not null check (agent in ('fees', 'setup')),
  kind           text not null check (kind in ('fee_reminders', 'student_import', 'staff_import')),
  title          text not null check (length(title) between 1 and 200),
  summary        text not null default '' check (length(summary) <= 2000),
  payload        jsonb not null default '{}',
  figures        jsonb not null default '{}',
  status         text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'failed')),
  created_by     uuid,
  created_at     timestamptz not null default now(),
  decided_by     uuid,
  decided_at     timestamptz,
  decision_note  text check (length(decision_note) <= 500),
  result         jsonb,
  unique (tenant_id, id),
  foreign key (tenant_id, run_id) references agent_runs (tenant_id, id) on delete set null (run_id),
  foreign key (tenant_id, created_by) references users (tenant_id, id) on delete set null (created_by),
  foreign key (tenant_id, decided_by) references users (tenant_id, id) on delete set null (decided_by)
);
create index agent_proposals_tenant_ix on agent_proposals (tenant_id, status, created_at desc);

do $$
declare t text;
begin
  foreach t in array array['agent_runs', 'agent_proposals'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format(
      'create policy tenant_isolation on %I using (tenant_id = (select app_tenant())) with check (tenant_id = (select app_tenant()))', t);
  end loop;
end $$;

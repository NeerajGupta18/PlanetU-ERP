-- =====================================================================
-- More assistants, and the public Support Help Agent
--
-- 1. agent_runs / agent_proposals: the lists of allowed assistant names and proposal kinds get longer, so the
--    two new assistants can log runs and make proposals: Attendance watch ('attendance', proposal 'parent_notes')
--    and Admissions helper ('admissions', proposal 'enquiry_reply'). Every value allowed before is still allowed;
--    no row is changed.
--
-- 2. demo_requests.source: where a demo request came from, the form ('form', every existing row) or the chat
--    on the landing page ('chat'). New column with a default: existing rows are not changed.
--
-- 3. support_messages: "leave a message for the team" from the public chat. Belongs to no institute; only the
--    platform (vendor console) reads it, like demo_requests.
--
-- 4. support_chat_runs: one row per public chat message - what was asked (clipped), what the assistant did, and
--    the tokens used (the public chat's daily allowance is summed from here). Add-only for the app.
--
-- Only additions: nothing is dropped, renamed or rewritten.
-- =====================================================================
alter table agent_runs drop constraint agent_runs_agent_check;
alter table agent_runs add constraint agent_runs_agent_check
  check (agent in ('ask', 'brief', 'fees', 'setup', 'attendance', 'admissions'));

alter table agent_proposals drop constraint agent_proposals_agent_check;
alter table agent_proposals add constraint agent_proposals_agent_check
  check (agent in ('fees', 'setup', 'attendance', 'admissions'));

alter table agent_proposals drop constraint agent_proposals_kind_check;
alter table agent_proposals add constraint agent_proposals_kind_check
  check (kind in ('fee_reminders', 'student_import', 'staff_import', 'parent_notes', 'enquiry_reply'));

alter table demo_requests add column source text not null default 'form' check (source in ('form', 'chat'));

create table support_messages (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(name) between 2 and 100),
  contact     text not null check (length(contact) between 5 and 150),
  message     text not null check (length(message) between 2 and 1000),
  status      text not null default 'new' check (status in ('new', 'contacted', 'closed')),
  created_at  timestamptz not null default now()
);
create index support_messages_created_ix on support_messages (created_at desc);

create table support_chat_runs (
  id                 uuid primary key default gen_random_uuid(),
  session            text not null check (length(session) <= 64),
  question           text check (length(question) <= 600),
  outcome            text not null check (outcome in ('answered', 'unknown', 'handover', 'demo', 'message', 'busy', 'capped', 'error')),
  language           text check (language in ('en', 'hi', 'mr')),
  model              text check (length(model) <= 100),
  prompt_tokens      int not null default 0 check (prompt_tokens >= 0),
  completion_tokens  int not null default 0 check (completion_tokens >= 0),
  created_at         timestamptz not null default now()
);
create index support_chat_runs_created_ix on support_chat_runs (created_at desc);

do $$
declare t text;
begin
  foreach t in array array['support_messages', 'support_chat_runs'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy platform_only on %I for all using ((select app_platform())) with check ((select app_platform()))', t);
  end loop;
end $$;

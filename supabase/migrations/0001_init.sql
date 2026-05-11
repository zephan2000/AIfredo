-- AIfredo core schema: users, telegram_links, runs, run_steps, messages.

create type run_status as enum ('queued', 'running', 'done', 'failed', 'cancelled');
create type message_channel as enum ('telegram', 'web', 'mcp');
create type message_role as enum ('user', 'assistant', 'system');
create type provider_kind as enum ('claude', 'codex');

create table public.users (
  id uuid primary key default gen_random_uuid(),
  clerk_id text unique,
  display_name text,
  created_at timestamptz not null default now()
);

create table public.telegram_links (
  telegram_user_id bigint primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  chat_id bigint not null,
  registered_at timestamptz not null default now()
);

create table public.runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  kind text not null,
  status run_status not null default 'queued',
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  source_doc_path text,
  parent_step_id uuid,
  metadata jsonb not null default '{}'::jsonb
);

create table public.run_steps (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.runs(id) on delete cascade,
  idx int not null,
  provider provider_kind not null,
  status run_status not null default 'queued',
  started_at timestamptz,
  ended_at timestamptz,
  prompt text,
  output text,
  tokens_in int,
  tokens_out int,
  cost_usd numeric(10, 6),
  rate_limit_info jsonb,
  metadata jsonb not null default '{}'::jsonb,
  unique (run_id, idx)
);

alter table public.runs
  add constraint runs_parent_step_id_fk
  foreign key (parent_step_id) references public.run_steps(id) on delete set null;

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  channel message_channel not null,
  external_message_id text,
  external_chat_id text,
  run_id uuid references public.runs(id) on delete set null,
  role message_role not null,
  content text not null,
  created_at timestamptz not null default now()
);

create index runs_user_id_started_at_idx on public.runs (user_id, started_at desc);
create index run_steps_run_id_idx on public.run_steps (run_id);
create index messages_user_id_created_at_idx on public.messages (user_id, created_at desc);
create index messages_run_id_idx on public.messages (run_id);

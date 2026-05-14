-- Tracks the Claude Code session backing each Telegram chat thread.
-- One "hot" row per chat at a time (enforced by partial unique index);
-- archived/forgotten rows accumulate for audit + later restore.

create table public.chat_sessions (
  id uuid primary key default gen_random_uuid(),
  telegram_chat_id bigint not null,
  user_id uuid not null references public.users(id) on delete cascade,
  session_id uuid not null,
  status text not null default 'hot' check (status in ('hot', 'archived', 'forgotten')),
  last_used_at timestamptz not null default now(),
  turn_count int not null default 0,
  created_at timestamptz not null default now()
);

create unique index chat_sessions_one_hot_per_chat
  on public.chat_sessions (telegram_chat_id)
  where status = 'hot';

create index chat_sessions_user_status_last_used_idx
  on public.chat_sessions (user_id, status, last_used_at desc);

alter table public.chat_sessions enable row level security;

create policy chat_sessions_self_select on public.chat_sessions
  for select using (user_id = auth.uid());

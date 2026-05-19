-- Guided /trade flow state. One in-progress draft per Telegram chat;
-- advanced by inline-button taps and free-text steps. Ephemeral by
-- design (TTL enforced in app: TRADE_DRAFT_TTL_MS), so no history kept.
-- The completed intent lands in trade_journal via the existing check;
-- this table only holds the half-built draft. Personal data, RLS-scoped.

create table public.trade_drafts (
  chat_id bigint primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  step text not null,
  draft jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create index trade_drafts_user_idx on public.trade_drafts (user_id);

alter table public.trade_drafts enable row level security;

create policy trade_drafts_self on public.trade_drafts
  for select using (user_id = auth.uid());

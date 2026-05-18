-- Trade checkpoint: anti-pattern memory + gated executor audit.
-- AIfredo never holds withdrawal rights; this is decision-support + a
-- server-side gate, not autonomous dealing. Personal data, RLS-scoped.

create table public.trade_config (
  user_id uuid primary key references public.users(id) on delete cascade,
  mode text not null default 'testnet' check (mode in ('testnet', 'live')),
  kill_switch boolean not null default false,
  max_notional_per_trade numeric not null default 500,
  max_notional_per_day numeric not null default 2000,
  max_trades_per_day int not null default 10,
  updated_at timestamptz not null default now()
);

create table public.trade_journal (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  venue text not null default 'binance-futures',
  symbol text not null,
  side text not null check (side in ('BUY', 'SELL')),
  order_type text not null check (order_type in ('LIMIT', 'MARKET')),
  qty numeric not null,
  limit_price numeric,
  est_notional numeric,
  state_tags text[] not null default '{}',
  thesis text,
  verdict text check (verdict in ('clear', 'warn')),
  verdict_reasons jsonb,
  ack text not null default 'none' check (ack in ('none', 'confirm', 'override')),
  mode text not null default 'testnet',
  executor_status text not null default 'pending'
    check (executor_status in ('pending', 'blocked', 'filled', 'rejected', 'error', 'aborted')),
  executor_request jsonb,
  executor_response jsonb,
  confirm_expires_at timestamptz
);

create index trade_journal_user_created_idx
  on public.trade_journal (user_id, created_at desc);

-- Lookup for the Telegram CONFIRM/OVERRIDE state machine.
create index trade_journal_pending_idx
  on public.trade_journal (user_id, symbol, executor_status, confirm_expires_at);

alter table public.trade_config enable row level security;
alter table public.trade_journal enable row level security;

create policy trade_config_self on public.trade_config
  for select using (user_id = auth.uid());
create policy trade_journal_self on public.trade_journal
  for select using (user_id = auth.uid());

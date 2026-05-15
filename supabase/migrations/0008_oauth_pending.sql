-- Short-lived handoff rows for the Telegram-bot → web-OAuth flow.
-- /connect <provider> inserts a row with a random `token`; the user clicks a
-- link carrying that token, the /oauth/<provider>/start route validates it,
-- generates an OAuth `state`, persists it, and redirects to the provider.
-- The callback matches on `state` and marks the row consumed.

create table public.oauth_pending (
  token text primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  provider text not null,
  state text,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index oauth_pending_user_idx
  on public.oauth_pending (user_id, expires_at);

create index oauth_pending_state_idx
  on public.oauth_pending (state) where state is not null;

-- Service role only; no end-user access.
alter table public.oauth_pending enable row level security;

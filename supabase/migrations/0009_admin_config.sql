-- Operator-set config for integrations (provider client_id / client_secret /
-- API keys etc.). Set via `/admin set <provider> <key> <value>` in Telegram,
-- encrypted at rest with INTEGRATION_TOKEN_KEY. Single-tenant; if AIfredo
-- ever goes multi-tenant per-deployment, add user_id and partial unique.

create table public.admin_config (
  provider text not null,
  key text not null,
  encrypted_value text not null,
  updated_at timestamptz not null default now(),
  primary key (provider, key)
);

-- Service role only.
alter table public.admin_config enable row level security;

-- Per-user OAuth-connected third-party integrations (Slack, Gmail, ...).
-- Tokens are encrypted at rest with INTEGRATION_TOKEN_KEY (AES-256-GCM via
-- packages/shared/src/crypto.ts). external_account_id is the provider's own
-- account/workspace identifier (Slack team_id, Gmail email, etc.) — null
-- until the OAuth callback completes.

create type integration_status as enum ('active', 'reauth_required', 'revoked');

create table public.user_integrations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  provider text not null,
  external_account_id text,
  scopes text[] not null default '{}',
  encrypted_tokens text not null,
  config jsonb not null default '{}',
  status integration_status not null default 'active',
  refreshed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (user_id, provider, external_account_id)
);

create index user_integrations_user_provider_idx
  on public.user_integrations (user_id, provider);

alter table public.user_integrations enable row level security;

create policy user_integrations_self_select on public.user_integrations
  for select using (user_id = auth.uid());

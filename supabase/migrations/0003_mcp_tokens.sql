-- MCP OAuth 2.1 issuer storage. The Vercel app implements the OAuth issuer
-- per the MCP authorization spec; this is its persistence layer.

create table public.mcp_clients (
  client_id text primary key,
  client_secret_hash text,
  client_name text not null,
  redirect_uris text[] not null,
  grant_types text[] not null default array['authorization_code', 'refresh_token'],
  scope text not null default 'mcp',
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.mcp_authorizations (
  code text primary key,
  client_id text not null references public.mcp_clients(client_id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  redirect_uri text not null,
  code_challenge text not null,
  code_challenge_method text not null default 'S256',
  scope text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz
);

create table public.mcp_tokens (
  token_hash text primary key,
  client_id text not null references public.mcp_clients(client_id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  scope text not null,
  refresh_token_hash text unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index mcp_tokens_user_id_idx on public.mcp_tokens (user_id);
create index mcp_authorizations_expires_at_idx on public.mcp_authorizations (expires_at);

alter table public.mcp_clients enable row level security;
alter table public.mcp_authorizations enable row level security;
alter table public.mcp_tokens enable row level security;

create policy mcp_clients_self on public.mcp_clients
  for select using (created_by = auth.uid());

create policy mcp_tokens_self on public.mcp_tokens
  for select using (user_id = auth.uid());

-- mcp_authorizations: server-side only, no end-user policy.

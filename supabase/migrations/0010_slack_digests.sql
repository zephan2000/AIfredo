-- Named Slack digest groups. One row per (user, name). The auto-created
-- "default" group covers all member channels; named groups scope to a
-- subset. include_channels empty ⇒ all member channels; exclude always
-- removes. Channel values are names (sans leading #), resolved to IDs at
-- digest time via conversations.list.
--
-- external_account_id (Slack team_id) is reserved for multi-workspace:
-- null ⇒ the user's most-recent active Slack integration. No multi-
-- workspace logic yet; the column avoids a later migration.
--
-- schedule is reserved for per-group cron; v1 runs every enabled group on
-- the single daily tick.

create table public.slack_digests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  name text not null,
  external_account_id text,
  include_channels text[] not null default '{}',
  exclude_channels text[] not null default '{}',
  schedule text,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

create index slack_digests_user_enabled_idx
  on public.slack_digests (user_id, enabled);

alter table public.slack_digests enable row level security;

create policy slack_digests_self_select on public.slack_digests
  for select using (user_id = auth.uid());

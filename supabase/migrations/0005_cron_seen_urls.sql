-- Dedupe table for cron skills that fetch external feeds (RSS, etc.).
-- One row per URL seen. `kind` distinguishes feeds so we can prune per-feed
-- without cross-contamination.

create table public.cron_seen_urls (
  url text primary key,
  kind text not null,
  first_seen_at timestamptz not null default now()
);

create index cron_seen_urls_kind_first_seen_idx
  on public.cron_seen_urls (kind, first_seen_at desc);

-- service_role only; no RLS policy needed (RLS off on this table).
alter table public.cron_seen_urls enable row level security;

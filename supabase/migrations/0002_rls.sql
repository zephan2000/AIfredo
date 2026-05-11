-- Row-level security. The brain VM and Vercel server-side both use the
-- service_role key which bypasses RLS; these policies protect end-user
-- (anon / authenticated) reads via the Supabase JS client.

alter table public.users enable row level security;
alter table public.telegram_links enable row level security;
alter table public.runs enable row level security;
alter table public.run_steps enable row level security;
alter table public.messages enable row level security;

create policy users_self_select on public.users
  for select using (id = auth.uid());

create policy users_self_update on public.users
  for update using (id = auth.uid());

create policy telegram_links_self_select on public.telegram_links
  for select using (user_id = auth.uid());

create policy runs_self_select on public.runs
  for select using (user_id = auth.uid());

create policy run_steps_self_select on public.run_steps
  for select using (
    exists (
      select 1 from public.runs
      where runs.id = run_steps.run_id
        and runs.user_id = auth.uid()
    )
  );

create policy messages_self_select on public.messages
  for select using (user_id = auth.uid());

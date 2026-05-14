-- Seed a deterministic admin user row so system-initiated work (cron jobs,
-- the MCP issuer, future schedulers) can attribute runs to a known user_id
-- without waiting for an inbound Telegram message.
--
-- The telegram_link row is NOT seeded here — it's created on first /start by
-- ensureUserFromTelegram in apps/web/lib/users.ts. If the operator only ever
-- uses cron and never DMs the bot, there's no link; if they DM the bot, a
-- separate user row gets created. Both states are fine; cron runs stay
-- attributed to this seeded UUID regardless.

insert into public.users (id, display_name)
values ('e6f02d30-ef47-4c54-b754-8dd5b5eae6e9', 'admin (seeded)')
on conflict (id) do nothing;

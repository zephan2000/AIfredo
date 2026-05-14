# AIfredo

A personal autonomous agent hub. Orchestrates Claude Code and Codex CLIs as a multi-agent system, reachable from Telegram, the web, and as an MCP server for Cowork / Codex / Claude Code itself.

**Status**: Phase 0 deployed end-to-end; Phase 1 (cron skills, WIF) in progress.

## What this is

AIfredo runs your existing Claude Pro/Max and ChatGPT subscriptions as a 24/7 agent on free infra. You drive it from Telegram, it calls back through streamed edits, and other tools (Codex, Cowork) can invoke its skills via MCP.

## Architecture (one-paragraph version)

A long-lived service on a free GCP e2-micro VM (the "brain") drives `claude -p` and `codex exec` subprocesses, with state in Supabase. A Next.js app on Vercel hosts the Telegram webhook, the public MCP HTTP endpoint with OAuth, and a thin web UI. Cloudflare Tunnel exposes the VM to Vercel without opening ports. Cron skills run on GitHub Actions, fed by VM-rotated CLI credentials. Everything is OpenTofu-provisioned.

## Self-hosting

Full step-by-step at [`docs/self-host.md`](docs/self-host.md). Designed to be driven by an AI agent (Claude Code, Codex, etc.) reading it as a runbook — every step calls out the edge cases real first-time deploys hit so the agent surfaces them to you proactively.

### What you should know up front

- **You're bringing the subscriptions.** AIfredo doesn't include LLM credits; it leverages your existing Claude Pro/Max and ChatGPT Plus accounts via the official CLIs' OAuth flows. No API keys.
- **You'll OAuth twice during setup.** Once for `claude login`, once for `codex login`, both on the VM (not your laptop — macOS Keychain isn't portable). Takes ~3 minutes.
- **OAuth tokens are self-refreshing and long-lasting.** Both CLIs auto-refresh their tokens on every invocation; under Telegram-driven daily use the tokens stay valid indefinitely. An automatic encrypted snapshot to GCS every 6 hours keeps them recoverable across VM rebuilds. You only need to re-OAuth if (a) the brain is idle for a month+, (b) you change your Anthropic/OpenAI password, (c) you explicitly log out via the provider dashboard, or (d) your subscription lapses. See [self-host.md → Credential lifecycle](docs/self-host.md#credential-lifecycle--what-to-expect-long-term).
- **Free-tier-only by design.** No paid SaaS introduced. GCP/Cloudflare/Vercel/Supabase/GitHub free tiers carry the entire architecture; a `$1 USD` budget alert fires the moment anything starts billing on GCP.
- **One operator per deployment.** Multi-user is on the roadmap, but day one assumes you (and only you) are the admin. Telegram bot is locked to your numeric user ID; MCP OAuth issuer is single-tenant.

## Repo layout

```
apps/
  web/         Next.js on Vercel — Telegram webhook, MCP server, web UI
  brain/       Hono service on the VM — router, CLI runners, streaming
packages/
  shared/      Types, zod schemas, Supabase client factory
infra/         OpenTofu: GCP, Cloudflare, Vercel, GitHub, Supabase
supabase/      SQL migrations
.github/
  workflows/   Credential refresh, brain deploy
```

## License

MIT.

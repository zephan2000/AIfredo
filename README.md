# AIfredo

A personal autonomous agent hub. Orchestrates Claude Code and Codex CLIs as a multi-agent system, reachable from Telegram, the web, and as an MCP server for Cowork / Codex / Claude Code itself.

**Status**: Phase 0 — scaffolding. Not usable yet.

## What this is

AIfredo runs your existing Claude Pro/Max and ChatGPT subscriptions as a 24/7 agent on free infra. You drive it from Telegram, it calls back through streamed edits, and other tools (Codex, Cowork) can invoke its skills via MCP.

## Architecture (one-paragraph version)

A long-lived service on a free GCP e2-micro VM (the "brain") drives `claude -p` and `codex exec` subprocesses, with state in Supabase. A Next.js app on Vercel hosts the Telegram webhook, the public MCP HTTP endpoint with OAuth, and a thin web UI. Cloudflare Tunnel exposes the VM to Vercel without opening ports. Cron skills run on GitHub Actions, fed by VM-rotated CLI credentials. Everything is OpenTofu-provisioned.

## Self-hosting

See [`docs/self-host.md`](docs/self-host.md) (TBD in Phase 0).

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

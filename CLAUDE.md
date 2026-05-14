# AIfredo

Personal autonomous agent hub. Telegram + web + MCP frontends; Claude Code CLI and Codex CLI as the subscription-backed "agents" running on a free GCP VM. Single-operator deployment (Zephan), open-source friendly.

## Status

**Phase 0 deployed.** As of 2026-05-13: brain VM (`aifredo-brain`, us-west1-a), Cloudflare tunnel at `agent.zephan.space`, Vercel `aifredo-web.vercel.app`, Supabase `uuberahlfkoieypboxlh` in `us-west-1`, GCP project `aifredo-zephan`, state bucket `aifredo-tfstate-4079f57f`. Telegram round-trip verified end-to-end. ChatGPT-Plus auth lives under `matildalimyingxin@gmail.com` (different from Claude account); both creds are on the VM disk only.

## Architecture in one paragraph

A long-lived Hono service on a free **GCP e2-micro VM in us-west1** ("the brain") spawns `claude -p --output-format stream-json` and `codex exec --json` as subprocesses, with state in **Supabase Postgres (us-west-1, colocated)**. **Next.js on Vercel** hosts the Telegram webhook (admin-only, secret-validated, edit-stream UX with 750ms debounce), an `/api/ingest` callback stub, and the MCP OAuth 2.1 issuer (metadata only in Phase 0). **Cloudflare Tunnel** publishes the VM at `brain.<domain>` without opening ports; SSH is IAP-only. **OpenTofu** provisions everything from a single `bootstrap.sh`. Subscription auth lives in the VM's filesystem (`~/.claude/.credentials.json`, `~/.codex/auth.json`), OAuth'd manually once per VM.

## Hard constraints

- **Free tier only.** No new paid subs. Hub leverages user's existing **Claude Pro/Max + ChatGPT Plus** via CLI OAuth flows.
- **Vercel = doorway, VM = brain.** CLIs cannot run inside Vercel functions (no persistent disk, 60s sync cap, no robust subprocess model for agent loops).
- **Single user day one, multi-user-ready architecture.** RLS on every table, `user_id` everywhere, OAuth-scoped MCP tokens.
- **Open-source from day one.** Public repo, MIT, self-hostable. Credentials are per-deployment (forkers bring their own subs).

## Working style — preferences confirmed during scaffolding

- **Plan before code on non-trivial changes.** Scope at file level, get agreement, then write.
- **Terse.** No filler, no restating the user's request, no "great question".
- **Push back when assumptions are weak.** Don't agree to please.
- **Small commits, logical units.** CI passes on every push.
- **Don't add comments that describe what code does** — only non-obvious "why".
- **TaskCreate for multi-step work.** Mark done as you go; don't batch.
- **Don't gold-plate.** No frameworks where the in-house code is shorter (no LangGraph, no Mastra — the orchestrator is intentionally hand-rolled).

## Spike-verified facts (don't re-verify)

- `claude -p --output-format stream-json --verbose` emits NDJSON: `system.init` → `rate_limit_event` → `assistant` → `result`. `apiKeySource: "none"` confirms OAuth path. `rate_limit_event.rate_limit_info` exposes `status`, `resetsAt`, `rateLimitType`, `overageStatus` — used by `apps/brain/src/quota.ts` for deterministic Claude→Codex fallback.
- `codex exec --skip-git-repo-check --json --output-last-message <file> -s workspace-write -C <scratch> -` works headlessly. Events: `thread.started` → `turn.started` → `item.completed` (with `agent_message.text`) → `turn.completed`.
- **Claude Code creds on macOS are in Keychain (not portable). On Linux they're at `~/.claude/.credentials.json` (portable).** OAuth must happen on the Linux VM; never copy from Mac.
- **Codex auth (`~/.codex/auth.json`) is plain JSON, portable.** Schema (codex CLI v0.130+): top-level `auth_mode`, `last_refresh`, `OPENAI_API_KEY`, and a nested `tokens.{access_token, refresh_token, id_token, account_id}`. `auth_mode = "chatgpt"` + `OPENAI_API_KEY = null` confirms subscription auth.

## Common gotchas

- **pnpm strict isolation:** every workspace package must list its direct deps explicitly, even for type-only transitive imports. `packages/shared` needs `@types/node` even though it only uses `process.env`.
- **e2-micro has 1GB RAM.** 2GB swap configured in `vm-startup.sh.tftpl`. Queue CLI subprocesses serially; never run claude + codex concurrently on the brain.
- **Cloudflare TF provider v4** uses `content` (not `value`) for CNAME records.
- **GCP free tier requires a billing account** even though it's $0. A `$1 USD` budget alert at 1%/50%/100% is configured; it fires the moment any non-free resource starts billing.
- **GCS state bucket has `force_destroy = false`** so `tofu destroy` keeps it. Empty manually for full clean slate.
- **Vercel auto-detects pnpm workspaces** from `packageManager` in root `package.json` — don't override `install_command` or `build_command` in `vercel.tf`.
- **Telegram bot edits cap at ~1/sec/chat.** `TELEGRAM_EDIT_DEBOUNCE_MS = 750` in `packages/shared/src/constants.ts`.
- **`waitUntil` from `@vercel/functions`** is used for the Telegram webhook's background work after the 200 ACK.

## Repo layout

```
apps/
  brain/         Hono service on VM. server.ts, router.ts, runners/{claude,codex}.ts, quota.ts, memory.ts
  web/           Next.js 15 on Vercel. app/api/telegram, /api/ingest, /api/mcp/[...slug], lib/{telegram,supabase,users,brain}
packages/shared/ Types, zod schemas, makeServiceClient(), constants. Used by both apps.
infra/           OpenTofu: providers, gcp.tf, cloudflare.tf, vercel.tf, github.tf, supabase.tf, vm-startup.sh.tftpl, bootstrap.sh
supabase/        config.toml + 3 migrations (init, RLS, MCP OAuth tables)
.github/workflows/ ci.yml (typecheck), deploy-brain.yml (manual + push, needs WIF wired)
docs/self-host.md
```

## Phase roadmap

- **Phase 0** — scaffold + IaC + Telegram round-trip. ✅ Complete.
- **Phase 1** — first cron skill (SG news daily via GitHub Actions), credential snapshot/refresh workflow, expose `telegram_webhook_secret` as TF output, wire GCP WIF for `deploy-brain.yml`.
- **Phase 2** — slide-deck multi-step workflow (Claude strategist → Claude critic → Gemini tighten → Claude prompt-eng → Codex execute, source-of-truth doc versioned in Supabase Storage), MCP OAuth 2.1 issuer real implementation (DCR /register + /authorize + /token + tool dispatch).
- **Phase 3** — article breakdown (Jina Reader), social-video transcribe (Gemini Flash audio), learn-Chinese port (from github.com/nathoyina/learn-chinese — not yet fetched), web UI.

## Reject these reflexively unless user explicitly asks

- Switching hosting (no Oracle, no Fly — user picked GCP).
- Adding LLM API calls (defeats subscription-leverage goal).
- Telegram MarkdownV2 / HTML parsing (plain text is fine).
- An agent framework (LangGraph, Mastra, OpenAI Agents SDK).
- Branch protection / required reviews on `main` (solo project).

## Open Phase-0+ items (small follow-ups)

1. ~~Expose `telegram_webhook_secret` as a TF output~~ — done 2026-05-13.
2. Wire **GCP Workload Identity Federation** so `deploy-brain.yml` actually runs (it's dispatch-only and will fail on auth until WIF is set up).
3. ~~Encrypted snapshot of VM credentials for DR~~ — done 2026-05-14. GCS bucket `<project>-aifredo-creds`, aes-256-cbc with TF-state passphrase, cron every 6h, restore-on-boot before brain start. Use Supabase Storage instead if porting off GCP.
4. Stub a `/api/health` route on Vercel that pings brain `/health` and aggregates — useful for uptime checks.
5. `github_actions_secret` resources emit deprecation warnings (`plaintext_value` → `value`). Mass-rename when convenient; non-blocking.
6. `packages/shared/package.json` declares `main: ./src/index.ts`. Works in dev (tsx) and brain (compiled then tsx-loaded), but Next.js needed the `.js` suffixes removed from re-exports inside the shared package, and the brain systemd unit needs `node --import tsx` to load the .ts source. Consider building shared properly and pointing `main` at `dist/index.js` if this trips us again.

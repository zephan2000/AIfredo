# AIfredo roadmap

A decision log for AIfredo's future shape. Pair this with [CLAUDE.md](../CLAUDE.md) (current state + stable facts) and [self-host.md](self-host.md) (deploy runbook). This doc owns **rationale** — the reasoning behind what's planned, deferred, or rejected.

## How agents should use this doc

When asked to plan, scope, or recommend work:
1. Read this whole file first. The "Decisions" section captures choices already made; re-litigating them wastes context.
2. Treat the "Now / Soon / Later" buckets as priority, not strict order. Items can move on new information.
3. If a request conflicts with a Decision or Non-goal, push back with the entry's rationale; don't quietly cave.
4. When you complete an item, move it to "Done", keep the why, link the commit.
5. When the user asks "what should we build next?", recommend from "Now" first, then "Soon". Don't pull from "Later" without explaining why it's promoted.

This doc is not a contract. If a decision turns out wrong, edit the entry and add a note explaining the reversal. Future sessions need the trail.

---

## Done

| Item | Commit | Why it mattered |
|---|---|---|
| Phase 0 scaffold + IaC | up to `a69e397` | Whole-architecture skeleton — VM, tunnel, Vercel webhook, Supabase, GH secrets, all OpenTofu. |
| First real deploy | up to `cacf3e7` | Validated everything end-to-end against real accounts. Surfaced 12+ edge cases now documented in self-host.md. |
| Encrypted credential snapshot DR | `e28cdd8` | VM replacement (any tweak to startup script) wipes OAuth. Bit us once. GCS snapshot + cron + restore-on-boot makes future replacements zero-touch. |
| WIF for `deploy-brain.yml` | `4c0f6a7` | GHA can now SSH to brain without static SA keys. Required before any iteration on brain code can be CI-driven. |
| `telegram_webhook_secret` as TF output | within `e28cdd8` cluster | Webhook registration is one command, not a state-pull. |
| SG news cron (v1, Claude-in-loop) — CNA + Mothership | `28f5863` | First autonomous skill. Validated the GHA → brain → claude → Telegram pipeline for non-prompted flows. Established the cron-skill shape every later skill will copy. Admin UUID seeded via `0004_admin_seed.sql`; dedupe via `cron_seen_urls`. |
| Per-chat session continuity (`claude --resume`) | `bc33b24` | Decoupled Claude session_id from AIfredo run_id; web persists per-chat session in `chat_sessions` (one "hot" row enforced by partial unique index). Step 1 of the hot/archive/forget lifecycle. |

## Now (Phase 1, in flight)

_Empty — pick next from Soon._

## Soon (next 1–3 deploys)

### Session lifecycle — `/forget`, `/keep`, `/new` + archive/surfacing crons

**What**: Finish the hot → archive → forgotten flow sketched while building continuity. Steps:

1. Telegram commands `/forget`, `/keep`, `/new` that mutate `chat_sessions.status` for the current chat. (Small — handler in `apps/web/app/api/telegram/route.ts`.)
2. Archive cron — weekly: scan `chat_sessions where last_used_at > 14d and status = 'hot'`. Move .jsonl into Supabase Storage (or `messages` rows), flip status to `archived`. Silent move.
3. Surfacing cron — same schedule, post-archive: DM the user the freshly-archived list with `/keep N` / `/forget N` actions.
4. Forget cron — monthly: scan `archived` rows older than 90d, surface for `/forget` confirmation. Never auto-deletes.
5. `--resume` failure fallback in the brain runner. Today a missing .jsonl (post-rebuild) throws; should retry without `--resume` and update the chat_sessions row.

**Why it matters**: Continuity without hygiene fills the VM disk and the operator's mental space with stale threads. Surfacing-before-delete is the operator-trust contract.

**Why now**: Continuity just landed; the lifecycle gaps are visible. Also step 5 (fallback) is a concrete known footgun mentioned in the continuity commit message.

**Why piece-wise not all at once**: Step 1 is independently useful (manual cleanup). Steps 2-4 are only needed when there's clutter, which is months away.

### Skill-as-config refactor

**What**: Once a second cron skill exists, refactor from per-skill TypeScript files to declarative `skills/<name>.yaml` + `skills/<name>/prompt.md`. One generic `apps/cron/src/runner.ts`. GitHub Actions matrix discovers skills automatically.

**Why it matters**: Adding a skill becomes "drop a YAML + a markdown prompt" — no TS edits, no workflow edits. Critical for non-technical forkers to extend the system to their own needs (the project's primary distribution mechanism).

**Why wait**: Two examples force the right abstraction; one example invents the wrong one. CLAUDE.md says "don't gold-plate" — ship the SG news cron as a one-off, let the natural shape emerge when the second skill is added.

### Bot-triggered prompt editor (UI redirect flow)

**What**: `/skills` or `/edit <skill>` in Telegram replies with a one-time-token link to `https://<vercel>/admin/skills/<name>`. The page is a markdown editor wired to commit-and-push the `prompt.md` via the GitHub API. Token is single-use, ~5 min TTL, scoped to admin Telegram ID.

**Why it matters**: Forkers (and operators long-term) shouldn't need a terminal to tune prompts. This puts prompt iteration on a phone. Combined with skill-as-config, a non-technical operator can add and tune skills entirely from Telegram + browser.

**Why not skip git and use a DB**: We want diff + history + rollback for free. Prompts in Supabase lose that unless we build the audit log ourselves. The bot→UI→GitHub commit path inherits git's superpowers.

**Why wait**: Depends on skill-as-config landing first (no point editing `prompt.md` if it doesn't exist as a separate file yet).

### Stub `/api/health` route on Vercel

**What**: Vercel endpoint that pings brain `/health` + Supabase + maybe Telegram getMe, aggregates into one JSON response.

**Why it matters**: Single uptime check covers the whole stack. Useful if (a) you ever set up external monitoring like Uptime Kuma, or (b) a self-hoster wants a "is my deploy healthy" check without SSH.

**Effort**: ~30 minutes. Will get bundled into the next infra-touching PR.

## Later (when shape is clearer)

### Phase 2 — Slide-deck multi-step workflow

**What**: Claude strategist → Claude critic → Gemini tighten → Claude prompt-eng → Codex execute. Source-of-truth doc versioned in Supabase Storage.

**Why it matters**: Proves the multi-agent orchestrator design beyond one-CLI calls. Slide decks are a useful enough output to validate the whole approach with a real-feeling user workflow.

**Why later**: Needs skill-as-config first (this is a complex skill, not a one-off). Also needs better orchestration primitives in `apps/brain/src/router.ts` — multi-step state machines aren't there yet.

**Open question**: Gemini step burns API credits (no Gemini subscription via CLI exists). Either accept the small cost or replace with a second Claude pass. Decide when scoping.

### Phase 2 — MCP OAuth 2.1 real implementation

**What**: DCR `/register`, `/authorize`, `/token`, plus tool dispatch through the existing `/api/mcp` route. Today it's metadata-only.

**Why it matters**: MCP is how other tools (Codex, Cursor, Claude Code itself) discover and call AIfredo's skills. Without it, the hub only routes Telegram → Claude, not Claude → AIfredo.

**Why later**: No external MCP client is depending on it yet. The metadata stub is enough to verify the route exists; real impl can wait until there's a concrete consumer.

### Phase 3 — Article breakdown via Jina Reader

**What**: User sends a URL in Telegram → brain calls Jina Reader to extract clean text → Claude summarises with configurable depth (TL;DR / outline / deep dive).

**Why it matters**: The most-used "personal agent" pattern. High value, low complexity once Phase 1 skills work.

### Phase 3 — Social video transcribe (Gemini Flash audio)

**What**: User shares a video link or file → download audio → Gemini Flash transcribes → Claude summarises.

**Why it matters**: Covers the "I watched a YouTube/TikTok and want notes" workflow. Gemini Flash audio is significantly cheaper than Whisper for transcription.

**Why later**: Audio download is a separate moving piece (yt-dlp on the VM); needs care with rate limits and ToS. Defer until Phase 1/2 skills are stable.

### Phase 3 — Learn-Chinese port

**What**: Port of [github.com/nathoyina/learn-chinese](https://github.com/nathoyina/learn-chinese) into AIfredo's skill framework.

**Why it matters**: User-specific skill, but a good test of "can someone fork their existing project into AIfredo's skill model". If this port goes smoothly, it validates the framework for arbitrary external code.

**Why later**: Source repo not yet fetched; need to see its shape before scoping.

### Phase 3 — Web UI

**What**: Beyond `/admin/skills/...`, a real chat UI at `<vercel>/chat` that mirrors the Telegram interface for desktop use.

**Why it matters**: Some workflows (long-form drafting, code review) are painful on Telegram. A web chat with the same brain backend gives operators a desktop option.

**Why later**: Nice-to-have; Telegram covers the core need. Build only if you find yourself wishing for it.

### Operational polish

- **`/api/health` aggregator** — moved to Soon.
- **`github_actions_secret` deprecation cleanup** — `plaintext_value` → `value`. Cosmetic, mass-rename when convenient.
- **`packages/shared` dual-build** — `main: ./src/index.ts` works via tsx runtime but is unusual. Consider building shared to `dist/` and pointing `main` there if this causes friction again. Not urgent.

---

## Decisions made

Each entry: the choice + the reasoning. Future sessions should respect these unless presenting new information that changes the calculus.

### D-001 — Subscription leverage over API calls
**Choice**: Always use `claude -p` / `codex exec` CLIs against OAuth'd Pro/Max + Plus subscriptions. Never add direct Anthropic/OpenAI API calls.
**Why**: The entire premise of AIfredo is "$0/month + your existing subs". Adding API billing defeats it. If a workflow genuinely needs an API capability not in the CLIs (e.g., embeddings), prefer free alternatives (Jina, Gemini Flash free tier) over re-introducing per-token billing.

### D-002 — Single-operator first, multi-user-ready architecture
**Choice**: Admin Telegram ID is hardcoded in tfvars; bot ignores all other senders. Tables have `user_id` columns and RLS even though only one user exists.
**Why**: We want to ship now, not solve multi-tenancy first. But the schema cost of "always include user_id" is small enough that we pay it upfront and avoid a painful migration later.

### D-003 — Self-host model, not hosted SaaS
**Choice**: Users wanting to use AIfredo fork the repo and deploy their own instance. No hosted version is offered.
**Why**: A hosted version requires you to absorb their LLM costs (or build per-user OAuth, billing, abuse handling). Self-host preserves operator sovereignty and the $0/month thesis. Trade-off: bar for users is "technically curious + can follow a runbook with an AI agent driving" — not "anyone".

### D-004 — Skill-as-config waits for two skills
**Choice**: SG news cron ships as one-off TypeScript. Refactor to declarative YAML only after the second skill demands the abstraction.
**Why**: Premature abstraction over a single example invents the wrong shape. Two examples force the right one. CLAUDE.md "don't gold-plate" applies.

### D-005 — Prompts as files in repo, not DB rows
**Choice**: Skill prompts live as `prompt.md` files in the repo. Editing them goes through git (manually) or the bot→UI→GitHub flow (eventually).
**Why**: Forkers already have a git repo. Prompts in markdown get diff/history/rollback for free. Prompts in DB lose all that unless we rebuild it. Hot-reload from DB matters when end users tune prompts in a hosted product — irrelevant for our self-host model.

### D-006 — `claude_rate_limit` triggers Codex fallback, not retry
**Choice**: When `claude -p` returns a rate-limit event, the brain falls back to `codex exec` immediately. No exponential backoff on Claude.
**Why**: User-facing latency matters more than which model answered. The two CLIs have independent rate-limit windows, so falling back to Codex usually succeeds. If both are exhausted, then we tell the user.

### D-007 — Plain text Telegram replies, no MarkdownV2
**Choice**: Bot sends plain text. No Markdown / HTML parsing.
**Why**: MarkdownV2's escape rules are a constant footgun and a single bad character breaks the message. Plain text is robust, monospace-fonts render code OK, and the streaming-edit UX doesn't need formatting.

### D-008 — OS Login + serviceAccountUser for CI, not osAdminLogin
**Choice**: WIF SA has `roles/compute.osLogin` + `roles/iam.serviceAccountUser` on the brain SA, plus an instance-scoped `iap.tunnelResourceAccessor` and a sudoers drop-in for `sa_<unique_id>` allowing exactly `sudo -u aifredo bash` and `sudo systemctl restart aifredo-brain.service`.
**Why**: `osAdminLogin` grants sudo on every instance in the project. Today there's one VM, but the moment a second one exists, CI has implicit sudo on it. Least-privilege from the start; the extra TF lines are minor.

---

## Non-goals (rejected; agents should push back if asked)

Each entry: the thing + why it's rejected. Don't reopen without new information.

### N-001 — No hosting on Oracle Cloud / Fly / Render / Railway
We picked GCP after evaluating alternatives. Switching hosts is months of work for marginal upside. CLAUDE.md "reject reflexively" applies.

### N-002 — No direct LLM API calls
See D-001. Defeats the subscription-leverage thesis.

### N-003 — No agent frameworks (LangGraph, Mastra, OpenAI Agents SDK)
The orchestrator is intentionally hand-rolled in `apps/brain/src/router.ts`. Frameworks add abstraction overhead without solving the routing problem we have (two CLIs, one fallback rule). If routing complexity ever justifies a framework, revisit — but the bar is high.

### N-004 — No Telegram MarkdownV2 / HTML parsing
See D-007.

### N-005 — No branch protection on `main`
Solo project. Required reviews add friction without value when there's one committer.

### N-006 — No deterministic v0 skills where a Claude call would do
See "Why v1 not v0" under SG news cron. The thesis is to use the subscription; deliberately not using it wastes the premise.

### N-007 — No paid SaaS in the stack
Free tier carries the architecture (GCP, Cloudflare, Vercel, Supabase, GitHub). Adding any paid SaaS — even cheap ones — raises the bar for forkers and breaks the $0/month story. Pre-existing personal subs (Claude Pro/Max, ChatGPT Plus) are the only exception, and they're brought-your-own.

---

## Open questions

Things that need a decision but aren't blocking right now.

- **Q-001 — Single-tenant or multi-tenant on a forker's deployment?** Today the bot is admin-only. Some forkers may want to share their deployment with friends/family. We've punted (D-003: "they fork their own"). Revisit if multiple users ask for it. The honest answer might be: provide an `ALLOWED_TELEGRAM_USER_IDS` env var as an opt-in extension, but keep the default single-operator.
- **Q-002 — When to extract `packages/shared` to a real build pipeline?** Today `main: ./src/index.ts` works via tsx but is unusual. The next time Next.js (or any non-tsx consumer) complains, build it properly. Until then, leave it.
- **Q-003 — Cron skills: per-user or global?** SG news goes to the admin only. If a forker adds family members later, do their cron skills get their own per-user delivery, or is there only one global feed? The schema supports per-user (user_id on cron_seen_urls), but the workflow doesn't iterate. Decide when adding the second user.

---

## Meta — keeping this doc useful

- **Update when you finish work.** Move items from Now → Done. Add the commit hash.
- **Update when you decide.** New decisions go in the Decisions section with a D-NNN ID. New rejections go in Non-goals with an N-NNN ID.
- **Don't pre-fill Later with everything you can think of.** Items in Later imply we'll get to them. If we won't, they're Non-goals.
- **Cross-link to commits and code, not vague pointers.** "See `apps/brain/src/quota.ts`" is useful; "the rate limit logic" is not.
- **Date entries when timing matters.** "Revisit in 3 months" is more useful than "later".

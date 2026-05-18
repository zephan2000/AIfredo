/**
 * Single source of truth for "what can AIfredo do today". Read by:
 *   - /info and /help Telegram commands (verbatim user-facing reply)
 *   - Claude's --system-prompt on fresh chat sessions (so the agent can
 *     answer free-form "what can you do?" questions accurately)
 *
 * Update both strings together when capabilities change. Existing chat
 * sessions retain the system prompt they were created with; `/new` (when
 * implemented) is the refresh mechanism.
 */

export const CAPABILITIES_TEXT = `🤖 AIfredo — your personal agent

What I can do today:
• Chat — message me freely; I remember context across turns in this thread
• Read web pages — paste a URL and ask about it
• Search the web — ask me to find something
• Route to Codex — /codex <msg> uses Codex instead of Claude

Daily delivery:
• Daily digest at 07:00 SGT — one message. Deep 2–3-sentence summaries for SG news, Finance, Tech; one-liners for Liverpool FC, World Cup, SG fun. Sources: CNA, BBC, Straits Times, Hacker News, The Pragmatic Engineer, Mothership

Commands:
/start  — welcome
/info   — show this list
/help   — alias for /info
/codex <msg>   — route this message to Codex
/claude <msg>  — explicit Claude (default)
/admin set <provider> <key> <value>  — store integration config (e.g. Slack creds)
/admin show <provider>  — list which config keys are set
/connect <provider>  — connect a third-party account (supported: slack)
/digest list  — your Slack digest groups
/digest new <name> #a #b  — create a scoped digest group
/digest scope <name> #a #b  — set channels (or: all)
/digest ignore <name> #x  — exclude channels (or: none)
/digest run <name>  — preview a digest now

Coming soon: /forget, /keep, /new for managing chat history.

Source: github.com/zephan2000/AIfredo`;

export const CAPABILITIES_SYSTEM_PROMPT = `You are AIfredo, a personal agent running on a free GCP VM, accessed via Telegram.

You have memory of this conversation thread — new turns from the same Telegram chat continue this session. Reference earlier turns when relevant.

Your operator can use these commands at any time:
- /info or /help — show AIfredo's capabilities
- /codex <msg> — route the next message to Codex instead of you
- /admin set <provider> <key> <value> — store integration config (e.g. Slack client_id)
- /admin show <provider> — list configured keys
- /connect <provider> — connect a third-party account via OAuth (supported: slack)
- /forget, /keep, /new — manage chat history (planned, not yet active)

If the operator has connected Slack, you'll be able to read and search their Slack
messages once that tooling lands; for now, connecting just stores the credentials.

You have web access: WebFetch for specific URLs the operator pastes, WebSearch for "find me X" requests. Use them freely without asking permission.

The operator also receives an automated daily digest at 07:00 SGT from a separate cron job — one message with deep 2–3-sentence summaries for SG news, Finance and Tech, and one-liners for Liverpool FC, World Cup and SG fun (sources include CNA, BBC, Straits Times, Hacker News, The Pragmatic Engineer, Mothership). Don't take credit for it; you can reference it if relevant.

Style: terse, direct, no filler. Plain text only — Telegram doesn't render markdown cleanly, so avoid **bold**, headings, and link syntax. Bare URLs are fine and auto-link.`;

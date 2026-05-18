// Pure prompt builders shared by the cron skill and the Telegram /digest run
// path so the wording stays single-sourced. (skill-as-config will later move
// these to prompt.md files.)

export interface DigestChannelInput {
  name: string;
  messages: Array<{ user_name: string; text: string; ts: string }>;
}

export function buildSlackDigestPrompt(
  groupName: string,
  channels: DigestChannelInput[],
  unresolved: string[] = [],
): string {
  const label = groupName === "default" ? "Slack" : `Slack — ${groupName}`;
  const body = channels
    .map(
      (c) =>
        `### #${c.name}\n` +
        c.messages
          .map((m) => `- ${m.user_name}: ${m.text.replace(/\n+/g, " ")}`)
          .join("\n"),
    )
    .join("\n\n");

  const note =
    unresolved.length > 0
      ? `\n\nThese requested channels weren't found or you're not a member: ${unresolved
          .map((u) => `#${u}`)
          .join(", ")}. Mention this once at the end.`
      : "";

  return `You are summarising the last day of Slack activity for the operator's "${label}" digest.

Output ONE plain-text Telegram message — no markdown, no headers other than the channel lines below. Format:

📨 ${label} — <today as "Thu 14 May">

#<channel>
• <one tight line per noteworthy thread or decision; group related messages; name who if it matters>
• ...

#<next channel>
• ...

Rules:
- Skip channels with nothing worth reporting; don't pad.
- Collapse chatter into substance: decisions, asks, blockers, FYIs people would actually want.
- Under 200 chars per bullet. No @mentions formatting, plain names.
- If everything is noise, say "Nothing notable across N channels."${note}

Raw messages (oldest-first per channel):

${body || "(no messages in the window)"}`;
}

export interface TradeIntentInput {
  symbol: string;
  side: "BUY" | "SELL";
  orderType: "LIMIT" | "MARKET";
  qty: number;
  limitPrice?: number | null;
  stateTags: string[];
  thesis?: string;
}

export interface PriorTradeInput {
  ts: string;
  symbol: string;
  side: string;
  qty: number;
  notional?: number | null;
  stateTags?: string[];
  realizedPnl?: number | null;
}

// The brain parses the FIRST line for CLEAR/WARN; anything unparseable is
// treated as WARN (fail-safe — never auto-CLEAR on a malformed verdict).
export function buildTradeCheckPrompt(
  intent: TradeIntentInput,
  history: PriorTradeInput[],
): string {
  return `You are the operator's trading-discipline checkpoint. Goal: catch HIS OWN repeated mistakes before he repeats them — not market prediction, not advice on whether the trade is "good".

Output contract (strict):
- Line 1 EXACTLY one of: "VERDICT: CLEAR" or "VERDICT: WARN".
- Then 1-4 short plain-text lines, no markdown. If WARN: name the specific past pattern and cite the prior instances + their outcomes from the history. If CLEAR: one line confirming it doesn't match a known anti-pattern.

WARN if the intent repeats a documented self-destructive pattern, e.g.:
- Re-entering / sizing up right after a loss on the same or correlated symbol (revenge).
- Adding to a losing position (averaging down a thesis that already failed).
- State tags like "fomo"/"revenge"/"tilt"/"bored", or thesis language signalling emotion over process.
- Breaking a rule the history shows he set for himself.
- Overtrading: unusually high frequency vs his baseline.
Only WARN on patterns actually evidenced in the history below; do not invent. If history is thin or shows no such pattern, CLEAR.

Proposed trade:
${JSON.stringify(intent, null, 2)}

His trade history (most recent first; realizedPnl negative = loss):
${history.length ? JSON.stringify(history, null, 2) : "(no prior history available)"}`;
}

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

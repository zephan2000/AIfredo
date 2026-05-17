import { randomUUID } from "node:crypto";
import {
  makeServiceClient,
  RUN_KINDS,
  buildSlackDigestPrompt,
} from "@aifredo/shared";
import type { BrainStreamEvent } from "@aifredo/shared";
import { callBrain } from "./brain-client.js";
import { sendMessage } from "./telegram.js";
import { fetchSlackDigest } from "./slack-digest.js";

interface DigestGroup {
  name: string;
  include_channels: string[];
  exclude_channels: string[];
}

async function main(): Promise<void> {
  const chatIdRaw =
    process.env.ADMIN_TELEGRAM_CHAT_ID ?? process.env.ADMIN_TELEGRAM_USER_ID;
  if (!chatIdRaw) {
    throw new Error("ADMIN_TELEGRAM_USER_ID or ADMIN_TELEGRAM_CHAT_ID required");
  }
  const chatId = Number(chatIdRaw);
  if (!Number.isFinite(chatId)) throw new Error("invalid admin chat id");

  const supabase = makeServiceClient();

  // The Slack integration is attached to the Telegram-mapped user (created by
  // /connect), not the seeded cron UUID. Resolve from user_integrations.
  const { data: integ, error: integErr } = await supabase
    .from("user_integrations")
    .select("user_id")
    .eq("provider", "slack")
    .eq("status", "active")
    .order("refreshed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (integErr) throw new Error(`slack integration lookup: ${integErr.message}`);
  if (!integ) {
    console.log("no active Slack integration; nothing to digest");
    return;
  }
  const userId = integ.user_id as string;

  const { data: rows, error: grpErr } = await supabase
    .from("slack_digests")
    .select("name, include_channels, exclude_channels")
    .eq("user_id", userId)
    .eq("enabled", true);
  if (grpErr) throw new Error(`slack_digests lookup: ${grpErr.message}`);

  const groups: DigestGroup[] =
    rows && rows.length > 0
      ? (rows as DigestGroup[])
      : [{ name: "default", include_channels: [], exclude_channels: [] }];

  for (const group of groups) {
    try {
      await runGroup(supabase, userId, chatId, group);
    } catch (err) {
      console.error(`digest "${group.name}" failed:`, err);
    }
  }
}

async function runGroup(
  supabase: ReturnType<typeof makeServiceClient>,
  userId: string,
  chatId: number,
  group: DigestGroup,
): Promise<void> {
  const data = await fetchSlackDigest({
    userId,
    include: group.include_channels,
    exclude: group.exclude_channels,
    sinceHours: 24,
  });

  if (data.channels.length === 0) {
    console.log(`digest "${group.name}": nothing in window; skipping`);
    return;
  }

  const prompt = buildSlackDigestPrompt(group.name, data.channels, data.unresolved);

  const runId = randomUUID();
  const { error: runErr } = await supabase.from("runs").insert({
    id: runId,
    user_id: userId,
    kind: RUN_KINDS.CRON_SLACK_DAILY,
    status: "queued",
  });
  if (runErr) throw new Error(`insert run: ${runErr.message}`);

  let final = "";
  await callBrain({
    runId,
    userId,
    provider: "claude",
    prompt,
    onEvent: (e: BrainStreamEvent) => {
      if (e.type === "done") final = e.final;
      else if (e.type === "error") console.error("brain error event:", e.message);
    },
  });

  if (!final.trim()) {
    console.error(`digest "${group.name}": brain returned empty; not sending`);
    return;
  }
  await sendMessage(chatId, final);
}

main().catch((err) => {
  console.error("slack-daily failed:", err);
  process.exitCode = 1;
});

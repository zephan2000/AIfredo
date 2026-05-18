import { randomUUID } from "node:crypto";
import {
  makeServiceClient,
  RUN_KINDS,
  buildTradeReviewPrompt,
} from "@aifredo/shared";
import type { BrainStreamEvent, ReviewTradeInput } from "@aifredo/shared";
import { callBrain } from "./brain-client.js";
import { sendMessage } from "./telegram.js";

// READ-ONLY. This cron summarises the day's trade_journal for discipline
// reflection. It never calls the trade check/execute endpoints and cannot
// place orders — by construction.

async function main(): Promise<void> {
  const chatIdRaw =
    process.env.ADMIN_TELEGRAM_CHAT_ID ?? process.env.ADMIN_TELEGRAM_USER_ID;
  if (!chatIdRaw) throw new Error("ADMIN_TELEGRAM_USER_ID required");
  const chatId = Number(chatIdRaw);
  if (!Number.isFinite(chatId)) throw new Error("invalid admin chat id");

  const supabase = makeServiceClient();

  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);

  const { data: rows, error } = await supabase
    .from("trade_journal")
    .select(
      "user_id, created_at, symbol, side, qty, est_notional, state_tags, verdict, ack, executor_status",
    )
    .gte("created_at", dayStart.toISOString())
    .order("created_at", { ascending: true });
  if (error) throw new Error(`trade_journal read: ${error.message}`);

  if (!rows || rows.length === 0) {
    console.log("no trades today; skipping review");
    return;
  }

  const userId = rows[rows.length - 1]!.user_id as string;
  const trades: ReviewTradeInput[] = rows
    .filter((r) => r.user_id === userId)
    .map((r) => ({
      ts: r.created_at as string,
      symbol: r.symbol as string,
      side: r.side as string,
      qty: Number(r.qty),
      estNotional: r.est_notional == null ? null : Number(r.est_notional),
      stateTags: (r.state_tags as string[]) ?? [],
      verdict: (r.verdict as string | null) ?? null,
      ack: r.ack as string,
      status: r.executor_status as string,
    }));

  const day = new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "Asia/Singapore",
  }).format(new Date());

  const runId = randomUUID();
  const { error: runErr } = await supabase.from("runs").insert({
    id: runId,
    user_id: userId,
    kind: RUN_KINDS.CRON_TRADE_REVIEW,
    status: "queued",
  });
  if (runErr) throw new Error(`insert run: ${runErr.message}`);

  let final = "";
  await callBrain({
    runId,
    userId,
    provider: "claude",
    prompt: buildTradeReviewPrompt(day, trades),
    onEvent: (e: BrainStreamEvent) => {
      if (e.type === "done") final = e.final;
      else if (e.type === "error") console.error("brain error:", e.message);
    },
  });

  if (!final.trim()) {
    console.error("empty review; not sending");
    return;
  }
  await sendMessage(chatId, final);
}

main().catch((err) => {
  console.error("trade-review failed:", err);
  process.exitCode = 1;
});

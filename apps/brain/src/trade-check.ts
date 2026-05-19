import { makeServiceClient, buildTradeCheckPrompt } from "@aifredo/shared";
import type {
  TradeIntentInput,
  PriorTradeInput,
  TradeVenue,
} from "@aifredo/shared";
import { runClaude } from "./runners/claude.js";
import type { TradeMode, UserTrade, PlaceOrderArgs } from "./tools/trade.js";
import * as binance from "./tools/trade.js";
import * as tiger from "./tools/tiger.js";

// binance and tiger expose the same minimal contract, all keyed on
// TradeMode, so venue routing is a single switch — no per-venue branching
// downstream. (binance also exports getPositionRisk; not part of the
// contract, so it stays out of VenueClient.)
interface VenueClient {
  getMarkPrice(mode: TradeMode, symbol: string): Promise<number>;
  getUserTrades(
    mode: TradeMode,
    symbol: string,
    limit?: number,
  ): Promise<UserTrade[]>;
  placeOrder(
    mode: TradeMode,
    args: PlaceOrderArgs,
  ): Promise<{ orderId: number; status: string; raw: unknown }>;
}
function venueOf(v?: string | null): TradeVenue {
  return v === "tiger" ? "tiger" : "binance-futures";
}
function venueClient(v: TradeVenue): VenueClient {
  return v === "tiger" ? tiger : binance;
}

const supabase = makeServiceClient();

interface TradeConfig {
  mode: TradeMode;
  kill_switch: boolean;
  max_notional_per_trade: number;
  max_notional_per_day: number;
  max_trades_per_day: number;
}

const DEFAULT_CFG: TradeConfig = {
  mode: "testnet",
  kill_switch: false,
  max_notional_per_trade: 500,
  max_notional_per_day: 2000,
  max_trades_per_day: 10,
};

async function getConfig(userId: string): Promise<TradeConfig> {
  const { data } = await supabase
    .from("trade_config")
    .select("mode, kill_switch, max_notional_per_trade, max_notional_per_day, max_trades_per_day")
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) {
    await supabase.from("trade_config").insert({ user_id: userId }).select();
    return DEFAULT_CFG;
  }
  return data as TradeConfig;
}

export interface CheckResult {
  journalId: string;
  verdict: "clear" | "warn";
  reasons: string;
  estNotional: number;
  mode: TradeMode;
  requiresOverride: boolean;
}

export async function runTradeCheck(
  userId: string,
  intent: TradeIntentInput,
): Promise<CheckResult> {
  const cfg = await getConfig(userId);
  const venue = venueOf(intent.venue);
  const client = venueClient(venue);

  const price =
    intent.orderType === "LIMIT" && intent.limitPrice
      ? intent.limitPrice
      : await client.getMarkPrice(cfg.mode, intent.symbol);
  const estNotional = Math.round(intent.qty * price * 100) / 100;

  // Real fills (with realizedPnl) + recent logged intents = the memory.
  const history: PriorTradeInput[] = [];
  try {
    const fills = await client.getUserTrades(cfg.mode, intent.symbol, 100);
    for (const f of fills.slice(-50).reverse()) {
      history.push({
        ts: new Date(f.time).toISOString(),
        symbol: f.symbol,
        side: f.side,
        qty: f.qty,
        notional: Math.round(f.qty * f.price * 100) / 100,
        realizedPnl: f.realizedPnl,
      });
    }
  } catch (err) {
    console.error("getUserTrades (non-fatal):", err);
  }
  const { data: priorIntents } = await supabase
    .from("trade_journal")
    .select("created_at, symbol, side, qty, est_notional, state_tags")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(30);
  for (const p of priorIntents ?? []) {
    history.push({
      ts: p.created_at as string,
      symbol: p.symbol as string,
      side: p.side as string,
      qty: Number(p.qty),
      notional: p.est_notional == null ? null : Number(p.est_notional),
      stateTags: (p.state_tags as string[]) ?? [],
    });
  }

  const prompt = buildTradeCheckPrompt(intent, history);
  const { text } = await runClaude({
    prompt,
    onText: () => {},
    onRateLimit: () => {},
  });

  const first = text.trim().split("\n")[0]?.trim() ?? "";
  // Fail-safe: only an explicit CLEAR clears; anything else → WARN.
  const verdict: "clear" | "warn" = /^VERDICT:\s*CLEAR\b/i.test(first)
    ? "clear"
    : "warn";
  const reasons =
    text.trim().split("\n").slice(1).join("\n").trim() ||
    (verdict === "clear" ? "No known anti-pattern matched." : "Flagged.");

  // At most one live pending intent per user — keeps the Telegram
  // CONFIRM/OVERRIDE/ABORT mapping unambiguous without a pointer table.
  await supabase
    .from("trade_journal")
    .update({ executor_status: "aborted" })
    .eq("user_id", userId)
    .eq("executor_status", "pending");

  const { data: row, error } = await supabase
    .from("trade_journal")
    .insert({
      user_id: userId,
      venue,
      symbol: intent.symbol,
      side: intent.side,
      order_type: intent.orderType,
      qty: intent.qty,
      limit_price: intent.limitPrice ?? null,
      est_notional: estNotional,
      state_tags: intent.stateTags,
      thesis: intent.thesis ?? null,
      verdict,
      verdict_reasons: { text: reasons },
      mode: cfg.mode,
      executor_status: "pending",
      confirm_expires_at: new Date(Date.now() + 5 * 60_000).toISOString(),
    })
    .select("id")
    .single();
  if (error || !row) throw new Error(`journal insert: ${error?.message}`);

  return {
    journalId: row.id as string,
    verdict,
    reasons,
    estNotional,
    mode: cfg.mode,
    requiresOverride: verdict === "warn",
  };
}

export interface ExecuteResult {
  status: "filled" | "blocked" | "rejected" | "error" | "aborted";
  detail: string;
}

export async function executeTrade(
  userId: string,
  journalId: string,
  ack: "confirm" | "override",
): Promise<ExecuteResult> {
  const { data: j } = await supabase
    .from("trade_journal")
    .select("*")
    .eq("id", journalId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!j) return { status: "error", detail: "intent not found" };

  const finalize = async (
    status: ExecuteResult["status"],
    detail: string,
    extra: Record<string, unknown> = {},
  ): Promise<ExecuteResult> => {
    await supabase
      .from("trade_journal")
      .update({ executor_status: status, ack, ...extra })
      .eq("id", journalId);
    return { status, detail };
  };

  if (j.executor_status !== "pending")
    return { status: "error", detail: `already ${j.executor_status}` };
  if (!j.confirm_expires_at || new Date(j.confirm_expires_at as string) < new Date())
    return finalize("aborted", "confirmation window expired");

  const cfg = await getConfig(userId);
  if (cfg.kill_switch) return finalize("blocked", "kill switch is on");

  if (j.verdict === "warn" && ack !== "override")
    return finalize("blocked", "WARN requires OVERRIDE, not CONFIRM");
  if (j.verdict === "clear" && ack !== "confirm" && ack !== "override")
    return finalize("blocked", "needs explicit confirmation");

  const est = Number(j.est_notional ?? 0);
  if (est > cfg.max_notional_per_trade)
    return finalize(
      "blocked",
      `notional ${est} > per-trade cap ${cfg.max_notional_per_trade}`,
    );

  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const { data: todays } = await supabase
    .from("trade_journal")
    .select("est_notional")
    .eq("user_id", userId)
    .eq("executor_status", "filled")
    .gte("created_at", dayStart.toISOString());
  const filledToday = todays ?? [];
  if (filledToday.length >= cfg.max_trades_per_day)
    return finalize("blocked", `daily trade count cap ${cfg.max_trades_per_day} reached`);
  const notionalToday = filledToday.reduce(
    (s, r) => s + Number(r.est_notional ?? 0),
    0,
  );
  if (notionalToday + est > cfg.max_notional_per_day)
    return finalize(
      "blocked",
      `would exceed daily notional cap ${cfg.max_notional_per_day}`,
    );

  // Two-key arm for live. Testnet always permitted.
  if (cfg.mode === "live" && process.env.TRADE_LIVE_ENABLED !== "true")
    return finalize("blocked", "live mode not armed (TRADE_LIVE_ENABLED)");

  const orderArgs = {
    symbol: j.symbol as string,
    side: j.side as "BUY" | "SELL",
    type: j.order_type as "LIMIT" | "MARKET",
    qty: Number(j.qty),
    price: j.limit_price == null ? undefined : Number(j.limit_price),
  };
  try {
    const r = await venueClient(venueOf(j.venue as string)).placeOrder(
      cfg.mode,
      orderArgs,
    );
    return finalize(
      "filled",
      `order ${r.orderId} ${r.status} (${cfg.mode})`,
      { executor_request: orderArgs, executor_response: r.raw },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return finalize("rejected", msg, {
      executor_request: orderArgs,
      executor_response: { error: msg },
    });
  }
}

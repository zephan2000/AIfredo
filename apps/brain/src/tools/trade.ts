import { createHmac } from "node:crypto";

// Binance USD-M Futures client. Deliberately minimal and "dumb": it only
// reads and places orders. NO withdrawal, transfer, or leverage-change
// endpoints exist here — they are not omitted by accident, they must never
// be added. All gating (mode, caps, kill-switch, verdict/ack) lives in the
// caller (trade-check); this client never decides whether to trade.

export type TradeMode = "testnet" | "live";

const BASE: Record<TradeMode, string> = {
  testnet: "https://testnet.binancefuture.com",
  live: "https://fapi.binance.com",
};

function creds(mode: TradeMode): { key: string; secret: string } {
  const prefix = mode === "testnet" ? "BINANCE_TESTNET" : "BINANCE";
  const key = process.env[`${prefix}_API_KEY`];
  const secret = process.env[`${prefix}_API_SECRET`];
  if (!key || !secret) {
    // Fail-safe: live creds intentionally absent until the post-validation
    // live step. Missing creds → throw, never silently fall back.
    throw new Error(`Binance ${mode} creds missing (${prefix}_API_KEY/SECRET)`);
  }
  return { key, secret };
}

async function signed<T>(
  mode: TradeMode,
  method: "GET" | "POST",
  path: string,
  params: Record<string, string | number> = {},
): Promise<T> {
  const { key, secret } = creds(mode);
  const qs = new URLSearchParams({
    ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
    timestamp: String(Date.now()),
    recvWindow: "5000",
  });
  const sig = createHmac("sha256", secret).update(qs.toString()).digest("hex");
  qs.append("signature", sig);
  const url = `${BASE[mode]}${path}?${qs.toString()}`;
  const res = await fetch(url, {
    method,
    headers: { "X-MBX-APIKEY": key },
  });
  const json = (await res.json().catch(() => null)) as
    | (T & { code?: number; msg?: string })
    | null;
  if (!res.ok || json == null || (typeof json === "object" && "code" in json && (json as { code: number }).code < 0)) {
    const err = json && "msg" in json ? (json as { msg: string }).msg : `HTTP ${res.status}`;
    throw new Error(`binance ${path} failed: ${err}`);
  }
  return json as T;
}

export async function getMarkPrice(
  mode: TradeMode,
  symbol: string,
): Promise<number> {
  const res = await fetch(
    `${BASE[mode]}/fapi/v1/premiumIndex?symbol=${encodeURIComponent(symbol)}`,
  );
  const json = (await res.json().catch(() => null)) as { markPrice?: string } | null;
  const p = json?.markPrice ? Number(json.markPrice) : NaN;
  if (!Number.isFinite(p)) throw new Error(`markPrice unavailable for ${symbol}`);
  return p;
}

export interface UserTrade {
  symbol: string;
  side: string;
  qty: number;
  price: number;
  realizedPnl: number;
  time: number;
}

export async function getUserTrades(
  mode: TradeMode,
  symbol: string,
  limit = 200,
): Promise<UserTrade[]> {
  const rows = await signed<
    Array<{
      symbol: string;
      side: string;
      qty: string;
      price: string;
      realizedPnl: string;
      time: number;
    }>
  >(mode, "GET", "/fapi/v1/userTrades", { symbol, limit });
  return rows.map((r) => ({
    symbol: r.symbol,
    side: r.side,
    qty: Number(r.qty),
    price: Number(r.price),
    realizedPnl: Number(r.realizedPnl),
    time: r.time,
  }));
}

export interface PositionRisk {
  symbol: string;
  positionAmt: number;
  entryPrice: number;
  unRealizedProfit: number;
}

export async function getPositionRisk(
  mode: TradeMode,
): Promise<PositionRisk[]> {
  const rows = await signed<
    Array<{
      symbol: string;
      positionAmt: string;
      entryPrice: string;
      unRealizedProfit: string;
    }>
  >(mode, "GET", "/fapi/v2/positionRisk");
  return rows
    .map((r) => ({
      symbol: r.symbol,
      positionAmt: Number(r.positionAmt),
      entryPrice: Number(r.entryPrice),
      unRealizedProfit: Number(r.unRealizedProfit),
    }))
    .filter((p) => p.positionAmt !== 0);
}

export interface PlaceOrderArgs {
  symbol: string;
  side: "BUY" | "SELL";
  type: "LIMIT" | "MARKET";
  qty: number;
  price?: number;
}

export async function placeOrder(
  mode: TradeMode,
  a: PlaceOrderArgs,
): Promise<{ orderId: number; status: string; raw: unknown }> {
  const params: Record<string, string | number> = {
    symbol: a.symbol,
    side: a.side,
    type: a.type,
    quantity: a.qty,
  };
  if (a.type === "LIMIT") {
    if (!a.price) throw new Error("LIMIT order requires price");
    params.price = a.price;
    params.timeInForce = "GTC";
  }
  const r = await signed<{ orderId: number; status: string }>(
    mode,
    "POST",
    "/fapi/v1/order",
    params,
  );
  return { orderId: r.orderId, status: r.status, raw: r };
}

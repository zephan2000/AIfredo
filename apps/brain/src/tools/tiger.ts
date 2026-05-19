import * as cfgNs from "@tigeropenapi/tigeropen/config/client-config";
import * as httpNs from "@tigeropenapi/tigeropen/client/http-client";
import * as tradeNs from "@tigeropenapi/tigeropen/trade/trade-client";
import * as quoteNs from "@tigeropenapi/tigeropen/quote/quote-client";
import type { TradeMode, UserTrade, PlaceOrderArgs } from "./trade.js";

// Tiger Brokers client. Same deliberately "dumb" contract as tools/trade.ts:
// it only reads and places orders. NO withdrawal, transfer, fund-movement,
// or position-transfer calls. The SDK's TradeClient *does* expose those
// (transferSegmentFund, transferPosition, placeForexOrder, getFundingHistory,
// …); this module must never call or re-export any of them. They are not
// omitted by accident. All gating (mode, caps, kill-switch, verdict/ack)
// lives in the caller (trade-check); this client never decides whether to
// trade.
//
// Mode → account: testnet uses the Tiger paper (simulation) account, live
// uses the live account. Same tigerId + RSA key for both; the SDK signs
// every request. Equities only (secType STK) — Tiger's OPT/FUT are out of
// scope for this venue.
//
// SDK packaging note: @tigeropenapi/tigeropen@0.4.0 ships only "." in its
// package `exports` and a root barrel that re-exports nothing, so subpaths
// are reached via a committed pnpm patch (patches/@tigeropenapi__tigeropen
// @0.4.0.patch adds a "./*" exports map). The compiled module is CJS; under
// the brain's tsx loader a default import surfaces as `.default`, so we
// namespace-import and unwrap. Do not "simplify" to `import { X } from …`:
// the named ESM import does not survive tsx's CJS interop and resolves to
// undefined at runtime.

function pickDefault<T>(ns: unknown): T {
  const d = (ns as { default?: T }).default;
  return (d ?? (ns as T)) as T;
}

const { createClientConfig } =
  pickDefault<typeof import("@tigeropenapi/tigeropen/config/client-config")>(
    cfgNs,
  );
const { HttpClient } =
  pickDefault<typeof import("@tigeropenapi/tigeropen/client/http-client")>(
    httpNs,
  );
const { TradeClient } =
  pickDefault<typeof import("@tigeropenapi/tigeropen/trade/trade-client")>(
    tradeNs,
  );
const { QuoteClient } =
  pickDefault<typeof import("@tigeropenapi/tigeropen/quote/quote-client")>(
    quoteNs,
  );

const SEC_TYPE = "STK";

function tigerCfg(mode: TradeMode): {
  tigerId: string;
  privateKey: string;
  account: string;
} {
  const tigerId = process.env.TIGER_ID;
  const b64 = process.env.TIGER_PRIVATE_KEY_B64;
  const account =
    mode === "testnet"
      ? process.env.TIGER_PAPER_ACCOUNT
      : process.env.TIGER_LIVE_ACCOUNT;
  if (!tigerId || !b64 || !account) {
    // Fail-safe, mirroring tools/trade.ts: live creds are intentionally
    // absent until the post-validation live step. Missing creds → throw,
    // never silently fall back.
    const acctVar =
      mode === "testnet" ? "TIGER_PAPER_ACCOUNT" : "TIGER_LIVE_ACCOUNT";
    throw new Error(
      `Tiger ${mode} creds missing (TIGER_ID/TIGER_PRIVATE_KEY_B64/${acctVar})`,
    );
  }
  return {
    tigerId,
    privateKey: Buffer.from(b64, "base64").toString("utf8"),
    account,
  };
}

interface TigerClients {
  trade: InstanceType<typeof TradeClient>;
  quote: InstanceType<typeof QuoteClient>;
}

const cache = new Map<TradeMode, TigerClients>();

function clients(mode: TradeMode): TigerClients {
  const hit = cache.get(mode);
  if (hit) return hit;
  const { tigerId, privateKey, account } = tigerCfg(mode);
  const config = createClientConfig({ tigerId, privateKey, account });
  const http = new HttpClient(config);
  const made: TigerClients = {
    trade: new TradeClient(http, account),
    quote: new QuoteClient(http),
  };
  cache.set(mode, made);
  return made;
}

export async function getMarkPrice(
  mode: TradeMode,
  symbol: string,
): Promise<number> {
  const { quote } = clients(mode);
  const briefs = await quote.getBrief({ symbols: [symbol] });
  const p = briefs?.[0]?.latestPrice;
  if (p == null || !Number.isFinite(p)) {
    throw new Error(`tiger: no quote for ${symbol}`);
  }
  return p;
}

export async function getUserTrades(
  mode: TradeMode,
  symbol: string,
  _limit = 200,
): Promise<UserTrade[]> {
  const { trade } = clients(mode);
  const now = Date.now();
  const orders = await trade.getFilledOrders({
    symbol,
    secType: SEC_TYPE,
    startDate: now - 90 * 24 * 3600 * 1000,
    endDate: now,
  });
  return (orders ?? [])
    .filter((o) => (o.filledQuantity ?? 0) > 0)
    .map((o) => ({
      symbol: o.symbol ?? symbol,
      side: o.action ?? "",
      qty: o.filledQuantity ?? 0,
      price: o.avgFillPrice ?? 0,
      realizedPnl: o.realizedPnl ?? 0,
      time: o.updateTime ?? o.latestTime ?? o.openTime ?? now,
    }));
}

export async function placeOrder(
  mode: TradeMode,
  a: PlaceOrderArgs,
): Promise<{ orderId: number; status: string; raw: unknown }> {
  if (a.type === "LIMIT" && !a.price) {
    throw new Error("LIMIT order requires price");
  }
  const { trade } = clients(mode);
  const order = {
    symbol: a.symbol,
    secType: SEC_TYPE,
    action: a.side,
    orderType: a.type === "LIMIT" ? "LMT" : "MKT",
    totalQuantity: a.qty,
    timeInForce: "DAY",
    ...(a.type === "LIMIT" ? { limitPrice: a.price } : {}),
  };
  const r = await trade.placeOrder(order);
  if (!r) throw new Error("tiger placeOrder: empty response");
  const orderId = r.order_id ?? r.id;
  const status = r.orders?.[0]?.status ?? "submitted";
  return { orderId, status, raw: r };
}

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { BRAIN_PORT, RunRequestSchema } from "@aifredo/shared";
import type { BrainStreamEvent } from "@aifredo/shared";
import { runOnce } from "./router.js";
import { getLastRateLimit } from "./quota.js";
import { buildChannelDigest } from "./tools/slack.js";
import { runTradeCheck, executeTrade } from "./trade-check.js";

const BEARER = process.env.BRAIN_BEARER_TOKEN;
if (!BEARER) throw new Error("BRAIN_BEARER_TOKEN must be set");

const app = new Hono();

app.use("*", async (c, next) => {
  if (c.req.path === "/health") return next();
  if (c.req.header("authorization") !== `Bearer ${BEARER}`) {
    return c.json({ error: "unauthorized" }, 401);
  }
  return next();
});

app.get("/health", (c) =>
  c.json({
    status: "ok",
    claude_rate_limit: getLastRateLimit(),
    uptime_s: Math.floor(process.uptime()),
  }),
);

app.post("/run", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = RunRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_request", details: parsed.error.flatten() }, 400);
  }
  const req = parsed.data;

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (event: BrainStreamEvent) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          // controller already closed
        }
      };
      try {
        await runOnce(req, send);
      } catch (err) {
        send({
          type: "error",
          run_id: req.run_id,
          message: err instanceof Error ? err.message : String(err),
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    },
  });
});

app.post("/tools/slack/digest", async (c) => {
  const body = (await c.req.json().catch(() => null)) as {
    user_id?: string;
    include?: string[];
    exclude?: string[];
    since_hours?: number;
    external_account_id?: string;
  } | null;
  if (!body?.user_id) {
    return c.json({ error: "user_id required" }, 400);
  }
  try {
    const digest = await buildChannelDigest(body.user_id, {
      include: body.include,
      exclude: body.exclude,
      sinceHours: body.since_hours ?? 24,
      externalAccountId: body.external_account_id,
    });
    return c.json(digest);
  } catch (err) {
    return c.json(
      { error: err instanceof Error ? err.message : String(err) },
      502,
    );
  }
});

app.post("/tools/trade/check", async (c) => {
  const b = (await c.req.json().catch(() => null)) as {
    user_id?: string;
    intent?: {
      symbol?: string;
      side?: "BUY" | "SELL";
      orderType?: "LIMIT" | "MARKET";
      qty?: number;
      limitPrice?: number | null;
      stateTags?: string[];
      thesis?: string;
      venue?: "binance-futures" | "tiger";
    };
  } | null;
  const i = b?.intent;
  if (
    !b?.user_id ||
    !i?.symbol ||
    (i.side !== "BUY" && i.side !== "SELL") ||
    (i.orderType !== "LIMIT" && i.orderType !== "MARKET") ||
    !i.qty ||
    i.qty <= 0 ||
    (i.orderType === "LIMIT" && !i.limitPrice)
  ) {
    return c.json({ error: "invalid trade intent" }, 400);
  }
  try {
    const r = await runTradeCheck(b.user_id, {
      symbol: i.symbol,
      side: i.side,
      orderType: i.orderType,
      qty: i.qty,
      limitPrice: i.limitPrice ?? null,
      stateTags: i.stateTags ?? [],
      thesis: i.thesis,
      venue: i.venue,
    });
    return c.json(r);
  } catch (err) {
    return c.json(
      { error: err instanceof Error ? err.message : String(err) },
      502,
    );
  }
});

app.post("/tools/trade/execute", async (c) => {
  const b = (await c.req.json().catch(() => null)) as {
    user_id?: string;
    journal_id?: string;
    ack?: "confirm" | "override";
  } | null;
  if (
    !b?.user_id ||
    !b.journal_id ||
    (b.ack !== "confirm" && b.ack !== "override")
  ) {
    return c.json({ error: "invalid execute request" }, 400);
  }
  try {
    return c.json(await executeTrade(b.user_id, b.journal_id, b.ack));
  } catch (err) {
    return c.json(
      { error: err instanceof Error ? err.message : String(err) },
      502,
    );
  }
});

const port = Number(process.env.PORT ?? BRAIN_PORT);
serve({ fetch: app.fetch, port });
console.log(`AIfredo brain listening on :${port}`);

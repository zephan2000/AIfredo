import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { BRAIN_PORT, RunRequestSchema } from "@aifredo/shared";
import type { BrainStreamEvent } from "@aifredo/shared";
import { runOnce } from "./router.js";
import { getLastRateLimit } from "./quota.js";

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

const port = Number(process.env.PORT ?? BRAIN_PORT);
serve({ fetch: app.fetch, port });
console.log(`AIfredo brain listening on :${port}`);

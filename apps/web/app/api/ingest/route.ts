import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Brain → web callback. Used by GH Actions cron jobs (Phase 1+) to push
 * results back to Telegram without holding a persistent connection to Vercel.
 * Phase 0: stub.
 */
export async function POST(req: Request): Promise<NextResponse> {
  if (req.headers.get("authorization") !== `Bearer ${process.env.BRAIN_BEARER_TOKEN}`) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  return NextResponse.json({ ok: true, phase: "stub" });
}

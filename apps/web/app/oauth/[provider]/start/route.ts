import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { getAdminConfig } from "@/lib/admin-config";
import { attachState, findByToken, isUsable } from "@/lib/oauth-pending";
import { buildSlackAuthUrl } from "@/lib/oauth/slack";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ provider: string }> },
): Promise<Response> {
  const { provider } = await params;
  if (provider !== "slack") {
    return new Response(`Unsupported provider: ${provider}`, { status: 404 });
  }

  const token = new URL(req.url).searchParams.get("token");
  if (!token) return new Response("Missing token", { status: 400 });

  const pending = await findByToken(token);
  if (!pending || pending.provider !== "slack") {
    return new Response("Invalid or unknown token", { status: 401 });
  }
  const usable = isUsable(pending);
  if (!usable.ok) return new Response(usable.reason, { status: 410 });

  const clientId = await getAdminConfig("slack", "client_id");
  if (!clientId) {
    return new Response(
      "Slack client_id not set. Run: /admin set slack client_id <id>",
      { status: 412 },
    );
  }

  const state = randomBytes(32).toString("base64url");
  await attachState(token, state);

  const redirectUri = `${new URL(req.url).origin}/oauth/slack/callback`;
  return NextResponse.redirect(
    buildSlackAuthUrl({ clientId, state, redirectUri }),
    302,
  );
}

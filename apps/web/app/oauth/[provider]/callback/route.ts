import { getAdminConfig } from "@/lib/admin-config";
import { findByState, isUsable, markConsumed } from "@/lib/oauth-pending";
import { exchangeSlackCode } from "@/lib/oauth/slack";
import { upsertIntegration } from "@/lib/integrations";
import { getServerSupabase } from "@/lib/supabase";
import { sendMessage } from "@/lib/telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function page(message: string, status = 200): Response {
  return new Response(
    `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:system-ui;max-width:30rem;margin:4rem auto;padding:0 1rem;text-align:center"><p style="font-size:1.1rem">${message}</p></body>`,
    { status, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ provider: string }> },
): Promise<Response> {
  const { provider } = await params;
  if (provider !== "slack") return page(`Unsupported provider: ${provider}`, 404);

  const url = new URL(req.url);
  const oauthErr = url.searchParams.get("error");
  if (oauthErr) {
    return page(`Cancelled (${oauthErr}). Close this tab and try /connect slack again.`);
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return page("Missing code or state.", 400);

  const pending = await findByState(state);
  if (!pending || pending.provider !== "slack") {
    return page("Unknown or invalid state.", 401);
  }
  const usable = isUsable(pending);
  if (!usable.ok) return page(usable.reason, 410);

  const clientId = await getAdminConfig("slack", "client_id");
  const clientSecret = await getAdminConfig("slack", "client_secret");
  if (!clientId || !clientSecret) {
    return page("Slack client_id/client_secret not set in /admin.", 412);
  }

  const redirectUri = `${url.origin}/oauth/slack/callback`;
  let tokens;
  try {
    tokens = await exchangeSlackCode({ clientId, clientSecret, code, redirectUri });
  } catch (err) {
    return page(
      `Slack rejected the token exchange: ${err instanceof Error ? err.message : String(err)}`,
      502,
    );
  }

  await upsertIntegration({
    user_id: pending.user_id,
    provider: "slack",
    external_account_id: tokens.team_id,
    scopes: tokens.scope ? tokens.scope.split(",") : [],
    tokens: {
      access_token: tokens.access_token,
      authed_user_id: tokens.authed_user_id,
    },
    config: { team_name: tokens.team_name },
  });
  await markConsumed(pending.token);

  // Best-effort Telegram confirmation; absence of a link must not fail the flow.
  try {
    const supabase = getServerSupabase();
    const { data: link } = await supabase
      .from("telegram_links")
      .select("chat_id")
      .eq("user_id", pending.user_id)
      .maybeSingle();
    if (link?.chat_id) {
      await sendMessage(
        Number(link.chat_id),
        `Slack connected — workspace "${tokens.team_name}". Ask me about your Slack messages anytime.`,
      );
    }
  } catch (err) {
    console.error("oauth callback telegram notify failed", err);
  }

  return page(
    `Connected to <strong>${tokens.team_name}</strong> ✓<br>Return to Telegram.`,
  );
}

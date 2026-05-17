import { makeServiceClient, decryptJson } from "@aifredo/shared";

// Slack Web API access for a connected user. Tokens were stored by the web
// OAuth callback as encryptJson({ access_token, authed_user_id }) in
// user_integrations.encrypted_tokens (AES-256-GCM, INTEGRATION_TOKEN_KEY).
//
// User tokens are non-expiring unless the workspace enabled token rotation
// (uncommon) — no refresh logic here. A revoked/invalid token surfaces as
// a Slack `invalid_auth` / `token_revoked` error; the fix is /connect slack
// again. search.messages requires a paid Slack plan; on free workspaces it
// returns `not_allowed_token_type`/feature errors while conversations.* still
// work.

const SLACK_API = "https://slack.com/api";
const supabase = makeServiceClient();

interface StoredSlackTokens {
  access_token: string;
  authed_user_id: string;
}

async function getActiveSlackToken(userId: string): Promise<string> {
  const { data, error } = await supabase
    .from("user_integrations")
    .select("encrypted_tokens")
    .eq("user_id", userId)
    .eq("provider", "slack")
    .eq("status", "active")
    .order("refreshed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`slack token lookup: ${error.message}`);
  if (!data) throw new Error("no active Slack integration; run /connect slack");
  const tokens = decryptJson<StoredSlackTokens>(data.encrypted_tokens as string);
  return tokens.access_token;
}

async function slackApi<T>(
  token: string,
  method: string,
  params: Record<string, string | number | undefined>,
): Promise<T> {
  const url = new URL(`${SLACK_API}/${method}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) url.searchParams.set(k, String(v));
  }
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${token}` },
  });
  const json = (await res.json()) as { ok: boolean; error?: string } & T;
  if (!json.ok) {
    throw new Error(`slack ${method} failed: ${json.error ?? "unknown_error"}`);
  }
  return json;
}

export interface SlackSearchMatch {
  text: string;
  channel: string;
  username: string;
  ts: string;
  permalink: string;
}

export async function searchMessages(
  userId: string,
  query: string,
  count = 20,
): Promise<SlackSearchMatch[]> {
  const token = await getActiveSlackToken(userId);
  const json = await slackApi<{
    messages?: {
      matches?: Array<{
        text?: string;
        channel?: { name?: string };
        username?: string;
        ts?: string;
        permalink?: string;
      }>;
    };
  }>(token, "search.messages", { query, count });
  return (json.messages?.matches ?? []).map((m) => ({
    text: m.text ?? "",
    channel: m.channel?.name ?? "",
    username: m.username ?? "",
    ts: m.ts ?? "",
    permalink: m.permalink ?? "",
  }));
}

export interface SlackConversation {
  id: string;
  name: string;
  is_private: boolean;
  is_im: boolean;
  is_member: boolean;
}

export async function listConversations(
  userId: string,
  types = "public_channel,private_channel,im,mpim",
): Promise<SlackConversation[]> {
  const token = await getActiveSlackToken(userId);
  const json = await slackApi<{
    channels?: Array<{
      id?: string;
      name?: string;
      is_private?: boolean;
      is_im?: boolean;
      is_member?: boolean;
    }>;
  }>(token, "conversations.list", {
    types,
    limit: 200,
    exclude_archived: "true",
  });
  return (json.channels ?? []).map((c) => ({
    id: c.id ?? "",
    name: c.name ?? "",
    is_private: c.is_private ?? false,
    is_im: c.is_im ?? false,
    is_member: c.is_member ?? false,
  }));
}

export interface SlackMessage {
  user: string;
  text: string;
  ts: string;
  thread_ts: string | null;
}

export async function getHistory(
  userId: string,
  channelId: string,
  opts: { since?: Date; limit?: number } = {},
): Promise<SlackMessage[]> {
  const token = await getActiveSlackToken(userId);
  const json = await slackApi<{
    messages?: Array<{
      user?: string;
      text?: string;
      ts?: string;
      thread_ts?: string;
    }>;
  }>(token, "conversations.history", {
    channel: channelId,
    limit: opts.limit ?? 100,
    oldest: opts.since ? Math.floor(opts.since.getTime() / 1000) : undefined,
  });
  return (json.messages ?? []).map((m) => ({
    user: m.user ?? "",
    text: m.text ?? "",
    ts: m.ts ?? "",
    thread_ts: m.thread_ts ?? null,
  }));
}

export interface SlackUser {
  id: string;
  name: string;
  real_name: string;
}

export async function getUserInfo(
  userId: string,
  slackUserId: string,
): Promise<SlackUser> {
  const token = await getActiveSlackToken(userId);
  const json = await slackApi<{
    user?: { id?: string; name?: string; real_name?: string };
  }>(token, "users.info", { user: slackUserId });
  return {
    id: json.user?.id ?? slackUserId,
    name: json.user?.name ?? "",
    real_name: json.user?.real_name ?? "",
  };
}

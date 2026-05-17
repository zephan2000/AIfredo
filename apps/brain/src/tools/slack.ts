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

async function getActiveSlackToken(
  userId: string,
  externalAccountId?: string,
): Promise<string> {
  let q = supabase
    .from("user_integrations")
    .select("encrypted_tokens")
    .eq("user_id", userId)
    .eq("provider", "slack")
    .eq("status", "active");
  if (externalAccountId) q = q.eq("external_account_id", externalAccountId);
  const { data, error } = await q
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

// --- Digest: token resolved once, slackApi reused directly ---

const MAX_DIGEST_CHANNELS = 15;
const MAX_MSGS_PER_CHANNEL = 40;

export interface DigestChannel {
  name: string;
  messages: Array<{ user_name: string; text: string; ts: string }>;
}

export interface ChannelDigest {
  channels: DigestChannel[];
  unresolved: string[]; // include names that matched no member channel
}

export async function buildChannelDigest(
  userId: string,
  opts: {
    include?: string[];
    exclude?: string[];
    sinceHours?: number;
    externalAccountId?: string;
  } = {},
): Promise<ChannelDigest> {
  const token = await getActiveSlackToken(userId, opts.externalAccountId);
  const include = (opts.include ?? []).map((c) => c.replace(/^#/, "").toLowerCase());
  const exclude = new Set(
    (opts.exclude ?? []).map((c) => c.replace(/^#/, "").toLowerCase()),
  );
  const sinceTs = opts.sinceHours
    ? Math.floor((Date.now() - opts.sinceHours * 3600_000) / 1000)
    : undefined;

  const list = await slackApi<{
    channels?: Array<{
      id?: string;
      name?: string;
      is_member?: boolean;
      is_im?: boolean;
      is_mpim?: boolean;
    }>;
  }>(token, "conversations.list", {
    types: "public_channel,private_channel",
    limit: 500,
    exclude_archived: "true",
  });

  const member = (list.channels ?? []).filter(
    (c) => c.is_member && !c.is_im && !c.is_mpim && c.id && c.name,
  );
  const byName = new Map(member.map((c) => [c.name!.toLowerCase(), c]));

  let selected: Array<{ id: string; name: string }>;
  const unresolved: string[] = [];
  if (include.length > 0) {
    selected = [];
    for (const n of include) {
      const c = byName.get(n);
      if (c) selected.push({ id: c.id!, name: c.name! });
      else unresolved.push(n);
    }
  } else {
    selected = member.map((c) => ({ id: c.id!, name: c.name! }));
  }
  selected = selected
    .filter((c) => !exclude.has(c.name.toLowerCase()))
    .slice(0, MAX_DIGEST_CHANNELS);

  const userNameCache = new Map<string, string>();
  const resolveUser = async (uid: string): Promise<string> => {
    if (!uid) return "unknown";
    const cached = userNameCache.get(uid);
    if (cached) return cached;
    try {
      const u = await slackApi<{
        user?: { name?: string; real_name?: string };
      }>(token, "users.info", { user: uid });
      const name = u.user?.real_name || u.user?.name || uid;
      userNameCache.set(uid, name);
      return name;
    } catch {
      userNameCache.set(uid, uid);
      return uid;
    }
  };

  const channels: DigestChannel[] = [];
  for (const ch of selected) {
    const hist = await slackApi<{
      messages?: Array<{ user?: string; text?: string; ts?: string }>;
    }>(token, "conversations.history", {
      channel: ch.id,
      limit: MAX_MSGS_PER_CHANNEL,
      oldest: sinceTs,
    });
    const raw = (hist.messages ?? []).filter((m) => (m.text ?? "").trim());
    const messages = [];
    for (const m of raw) {
      messages.push({
        user_name: await resolveUser(m.user ?? ""),
        text: m.text ?? "",
        ts: m.ts ?? "",
      });
    }
    if (messages.length > 0) channels.push({ name: ch.name, messages });
  }

  return { channels, unresolved };
}

// Slack OAuth v2. We request *user-token* scopes (not bot scopes) so the
// operator can read their own DMs and private channels. The user token comes
// back under `authed_user.access_token`.

const SLACK_USER_SCOPES = [
  "search:read",
  "users:read",
  "channels:read",
  "channels:history",
  "groups:read",
  "groups:history",
  "im:read",
  "im:history",
  "mpim:read",
  "mpim:history",
].join(",");

export function buildSlackAuthUrl(args: {
  clientId: string;
  state: string;
  redirectUri: string;
}): string {
  const u = new URL("https://slack.com/oauth/v2/authorize");
  u.searchParams.set("client_id", args.clientId);
  u.searchParams.set("user_scope", SLACK_USER_SCOPES);
  u.searchParams.set("state", args.state);
  u.searchParams.set("redirect_uri", args.redirectUri);
  return u.toString();
}

export interface SlackTokens {
  access_token: string;
  scope: string;
  authed_user_id: string;
  team_id: string;
  team_name: string;
}

export async function exchangeSlackCode(args: {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
}): Promise<SlackTokens> {
  const res = await fetch("https://slack.com/api/oauth.v2.access", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: args.clientId,
      client_secret: args.clientSecret,
      code: args.code,
      redirect_uri: args.redirectUri,
    }),
  });
  const json = (await res.json()) as {
    ok: boolean;
    error?: string;
    authed_user?: { id: string; access_token?: string; scope?: string };
    team?: { id: string; name: string };
  };
  if (!json.ok || !json.authed_user?.access_token) {
    throw new Error(
      `slack oauth.v2.access failed: ${json.error ?? "no user access_token in response"}`,
    );
  }
  return {
    access_token: json.authed_user.access_token,
    scope: json.authed_user.scope ?? "",
    authed_user_id: json.authed_user.id,
    team_id: json.team?.id ?? "",
    team_name: json.team?.name ?? "",
  };
}

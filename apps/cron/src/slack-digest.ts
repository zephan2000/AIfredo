export interface SlackDigestData {
  channels: Array<{
    name: string;
    messages: Array<{ user_name: string; text: string; ts: string }>;
  }>;
  unresolved: string[];
}

export async function fetchSlackDigest(args: {
  userId: string;
  include: string[];
  exclude: string[];
  sinceHours?: number;
}): Promise<SlackDigestData> {
  const url = process.env.BRAIN_URL;
  const token = process.env.BRAIN_BEARER_TOKEN;
  if (!url || !token) throw new Error("BRAIN_URL and BRAIN_BEARER_TOKEN required");

  const res = await fetch(`${url}/tools/slack/digest`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      user_id: args.userId,
      include: args.include,
      exclude: args.exclude,
      since_hours: args.sinceHours ?? 24,
    }),
  });
  const json = (await res.json().catch(() => null)) as
    | (SlackDigestData & { error?: string })
    | null;
  if (!res.ok || !json) {
    throw new Error(`brain digest ${res.status}: ${json?.error ?? "no body"}`);
  }
  return { channels: json.channels ?? [], unresolved: json.unresolved ?? [] };
}

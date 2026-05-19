import { BrainStreamEventSchema } from "@aifredo/shared";
import type { BrainStreamEvent, ProviderKind } from "@aifredo/shared";

interface CallBrainArgs {
  run_id: string;
  user_id: string;
  provider: ProviderKind;
  prompt: string;
  system?: string;
  session_id?: string;
  onEvent: (event: BrainStreamEvent) => void | Promise<void>;
}

export interface SlackDigestData {
  channels: Array<{
    name: string;
    messages: Array<{ user_name: string; text: string; ts: string }>;
  }>;
  unresolved: string[];
}

export async function fetchSlackDigest(args: {
  user_id: string;
  include: string[];
  exclude: string[];
  since_hours?: number;
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
      user_id: args.user_id,
      include: args.include,
      exclude: args.exclude,
      since_hours: args.since_hours ?? 24,
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

export async function callBrain(args: CallBrainArgs): Promise<void> {
  const url = process.env.BRAIN_URL;
  const token = process.env.BRAIN_BEARER_TOKEN;
  if (!url || !token) throw new Error("BRAIN_URL and BRAIN_BEARER_TOKEN required");

  const res = await fetch(`${url}/run`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      run_id: args.run_id,
      user_id: args.user_id,
      provider: args.provider,
      prompt: args.prompt,
      system: args.system,
      session_id: args.session_id,
    }),
  });
  if (!res.ok || !res.body) {
    const errText = await res.text().catch(() => "");
    throw new Error(`brain /run ${res.status}: ${errText}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffered += decoder.decode(value, { stream: true });

    let split: number;
    while ((split = buffered.indexOf("\n\n")) >= 0) {
      const frame = buffered.slice(0, split);
      buffered = buffered.slice(split + 2);

      const dataLines = frame
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trim());
      if (dataLines.length === 0) continue;

      try {
        const json = JSON.parse(dataLines.join("\n"));
        const parsed = BrainStreamEventSchema.safeParse(json);
        if (parsed.success) await args.onEvent(parsed.data);
      } catch {
        // ignore non-JSON
      }
    }
  }
}

interface TradeIntentWire {
  symbol: string;
  side: "BUY" | "SELL";
  orderType: "LIMIT" | "MARKET";
  qty: number;
  limitPrice?: number | null;
  stateTags: string[];
  thesis?: string;
  venue?: "binance-futures" | "tiger";
}

export interface TradeCheckResult {
  journalId: string;
  verdict: "clear" | "warn";
  reasons: string;
  estNotional: number;
  mode: "testnet" | "live";
  requiresOverride: boolean;
}

function brainEnv(): { url: string; token: string } {
  const url = process.env.BRAIN_URL;
  const token = process.env.BRAIN_BEARER_TOKEN;
  if (!url || !token) throw new Error("BRAIN_URL and BRAIN_BEARER_TOKEN required");
  return { url, token };
}

export async function tradeCheck(
  userId: string,
  intent: TradeIntentWire,
): Promise<TradeCheckResult> {
  const { url, token } = brainEnv();
  const res = await fetch(`${url}/tools/trade/check`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ user_id: userId, intent }),
  });
  const json = (await res.json().catch(() => null)) as
    | (TradeCheckResult & { error?: string })
    | null;
  if (!res.ok || !json || json.error) {
    throw new Error(`brain trade/check ${res.status}: ${json?.error ?? "no body"}`);
  }
  return json;
}

export async function tradeExecute(
  userId: string,
  journalId: string,
  ack: "confirm" | "override",
): Promise<{ status: string; detail: string }> {
  const { url, token } = brainEnv();
  const res = await fetch(`${url}/tools/trade/execute`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ user_id: userId, journal_id: journalId, ack }),
  });
  const json = (await res.json().catch(() => null)) as
    | { status?: string; detail?: string; error?: string }
    | null;
  if (!res.ok || !json || json.error) {
    throw new Error(`brain trade/execute ${res.status}: ${json?.error ?? "no body"}`);
  }
  return { status: json.status ?? "error", detail: json.detail ?? "" };
}

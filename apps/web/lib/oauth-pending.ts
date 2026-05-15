import { randomBytes } from "node:crypto";
import { getServerSupabase } from "./supabase";

export interface PendingRow {
  token: string;
  user_id: string;
  provider: string;
  state: string | null;
  expires_at: string;
  consumed_at: string | null;
}

const COLS = "token, user_id, provider, state, expires_at, consumed_at";

export async function createPending(args: {
  user_id: string;
  provider: string;
  ttlSeconds?: number;
}): Promise<string> {
  const supabase = getServerSupabase();
  const token = randomBytes(32).toString("base64url");
  const expires_at = new Date(
    Date.now() + (args.ttlSeconds ?? 300) * 1000,
  ).toISOString();
  const { error } = await supabase.from("oauth_pending").insert({
    token,
    user_id: args.user_id,
    provider: args.provider,
    expires_at,
  });
  if (error) throw new Error(`createPending: ${error.message}`);
  return token;
}

export async function findByToken(token: string): Promise<PendingRow | null> {
  const supabase = getServerSupabase();
  const { data } = await supabase
    .from("oauth_pending")
    .select(COLS)
    .eq("token", token)
    .maybeSingle();
  return (data as PendingRow | null) ?? null;
}

export async function findByState(state: string): Promise<PendingRow | null> {
  const supabase = getServerSupabase();
  const { data } = await supabase
    .from("oauth_pending")
    .select(COLS)
    .eq("state", state)
    .maybeSingle();
  return (data as PendingRow | null) ?? null;
}

export async function attachState(token: string, state: string): Promise<void> {
  const supabase = getServerSupabase();
  const { error } = await supabase
    .from("oauth_pending")
    .update({ state })
    .eq("token", token);
  if (error) throw new Error(`attachState: ${error.message}`);
}

export async function markConsumed(token: string): Promise<void> {
  const supabase = getServerSupabase();
  const { error } = await supabase
    .from("oauth_pending")
    .update({ consumed_at: new Date().toISOString() })
    .eq("token", token);
  if (error) throw new Error(`markConsumed: ${error.message}`);
}

export function isUsable(row: PendingRow): { ok: true } | { ok: false; reason: string } {
  if (row.consumed_at) return { ok: false, reason: "Link already used." };
  if (new Date(row.expires_at) < new Date()) {
    return { ok: false, reason: "Link expired — send /connect again in Telegram." };
  }
  return { ok: true };
}

import { getServerSupabase } from "./supabase";

export interface HotSession {
  id: string;
  session_id: string;
  turn_count: number;
}

export async function getHotSession(
  telegram_chat_id: number,
): Promise<HotSession | null> {
  const supabase = getServerSupabase();
  const { data, error } = await supabase
    .from("chat_sessions")
    .select("id, session_id, turn_count")
    .eq("telegram_chat_id", telegram_chat_id)
    .eq("status", "hot")
    .maybeSingle();
  if (error) {
    console.error("getHotSession", error);
    return null;
  }
  return data
    ? {
        id: data.id as string,
        session_id: data.session_id as string,
        turn_count: data.turn_count as number,
      }
    : null;
}

/**
 * Upsert the hot session row after a successful turn. Two cases:
 *   1. Existing hot row → bump last_used_at and turn_count; refresh session_id
 *      (Claude may rotate it after compaction).
 *   2. No hot row → insert one.
 *
 * Concurrent calls from the same chat are not serialized at this layer.
 * Humans typing in Telegram rarely race; if they do, the partial unique
 * index will reject the second insert and we'll fall back to update.
 */
export async function upsertHotSession(args: {
  telegram_chat_id: number;
  user_id: string;
  session_id: string;
}): Promise<void> {
  const supabase = getServerSupabase();
  const now = new Date().toISOString();

  const { data: existing } = await supabase
    .from("chat_sessions")
    .select("id, turn_count")
    .eq("telegram_chat_id", args.telegram_chat_id)
    .eq("status", "hot")
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from("chat_sessions")
      .update({
        session_id: args.session_id,
        last_used_at: now,
        turn_count: (existing.turn_count as number) + 1,
      })
      .eq("id", existing.id as string);
    if (error) console.error("upsertHotSession update", error);
    return;
  }

  const { error } = await supabase.from("chat_sessions").insert({
    telegram_chat_id: args.telegram_chat_id,
    user_id: args.user_id,
    session_id: args.session_id,
    status: "hot",
    last_used_at: now,
    turn_count: 1,
  });
  if (error) console.error("upsertHotSession insert", error);
}

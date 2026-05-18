import { getServerSupabase } from "./supabase";

export interface PendingTrade {
  id: string;
  symbol: string;
  verdict: "clear" | "warn";
}

// runTradeCheck supersedes older pending rows, so there is at most one live
// pending intent per user — making CONFIRM/OVERRIDE/ABORT unambiguous
// without a separate per-chat pointer table.
export async function latestPendingTrade(
  userId: string,
): Promise<PendingTrade | null> {
  const supabase = getServerSupabase();
  const { data } = await supabase
    .from("trade_journal")
    .select("id, symbol, verdict, confirm_expires_at")
    .eq("user_id", userId)
    .eq("executor_status", "pending")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  if (
    !data.confirm_expires_at ||
    new Date(data.confirm_expires_at as string) < new Date()
  ) {
    return null;
  }
  return {
    id: data.id as string,
    symbol: data.symbol as string,
    verdict: data.verdict as "clear" | "warn",
  };
}

export async function abortTrade(id: string): Promise<void> {
  const supabase = getServerSupabase();
  await supabase
    .from("trade_journal")
    .update({ executor_status: "aborted" })
    .eq("id", id);
}

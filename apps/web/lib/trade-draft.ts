import { TRADE_DRAFT_TTL_MS } from "@aifredo/shared";
import { getServerSupabase } from "./supabase";

// Order of the guided /trade flow. `step` is always the step we are
// currently waiting on. `price` is skipped for MARKET orders (route.ts
// decides the next step from the draft).
export type WizardStep =
  | "venue"
  | "symbol"
  | "side"
  | "qty"
  | "type"
  | "price"
  | "tags"
  | "thesis";

export interface TradeDraftData {
  venue?: "binance-futures" | "tiger";
  symbol?: string;
  side?: "BUY" | "SELL";
  qty?: number;
  orderType?: "LIMIT" | "MARKET";
  limitPrice?: number;
  stateTags: string[];
  thesis?: string;
}

export interface TradeDraftState {
  step: WizardStep;
  draft: TradeDraftData;
}

function empty(): TradeDraftData {
  return { stateTags: [] };
}

export async function getDraft(
  chatId: number,
): Promise<TradeDraftState | null> {
  const supabase = getServerSupabase();
  const { data, error } = await supabase
    .from("trade_drafts")
    .select("step, draft, updated_at")
    .eq("chat_id", chatId)
    .maybeSingle();
  if (error) {
    console.error("getDraft", error);
    return null;
  }
  if (!data) return null;
  const age = Date.now() - new Date(data.updated_at as string).getTime();
  if (age > TRADE_DRAFT_TTL_MS) {
    await clearDraft(chatId);
    return null;
  }
  const draft = (data.draft as TradeDraftData) ?? empty();
  if (!Array.isArray(draft.stateTags)) draft.stateTags = [];
  return { step: data.step as WizardStep, draft };
}

export async function startDraft(
  chatId: number,
  userId: string,
): Promise<void> {
  const supabase = getServerSupabase();
  const { error } = await supabase.from("trade_drafts").upsert(
    {
      chat_id: chatId,
      user_id: userId,
      step: "venue",
      draft: empty(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "chat_id" },
  );
  if (error) console.error("startDraft", error);
}

export async function patchDraft(
  chatId: number,
  patch: Partial<TradeDraftData>,
  nextStep: WizardStep,
): Promise<TradeDraftState | null> {
  const current = await getDraft(chatId);
  if (!current) return null;
  const draft = { ...current.draft, ...patch };
  const supabase = getServerSupabase();
  const { error } = await supabase
    .from("trade_drafts")
    .update({
      draft,
      step: nextStep,
      updated_at: new Date().toISOString(),
    })
    .eq("chat_id", chatId);
  if (error) {
    console.error("patchDraft", error);
    return null;
  }
  return { step: nextStep, draft };
}

export async function toggleTag(
  chatId: number,
  tag: string,
): Promise<string[]> {
  const current = await getDraft(chatId);
  if (!current) return [];
  const set = new Set(current.draft.stateTags);
  if (set.has(tag)) set.delete(tag);
  else set.add(tag);
  const stateTags = [...set];
  const supabase = getServerSupabase();
  const { error } = await supabase
    .from("trade_drafts")
    .update({
      draft: { ...current.draft, stateTags },
      updated_at: new Date().toISOString(),
    })
    .eq("chat_id", chatId);
  if (error) console.error("toggleTag", error);
  return stateTags;
}

export async function clearDraft(chatId: number): Promise<void> {
  const supabase = getServerSupabase();
  const { error } = await supabase
    .from("trade_drafts")
    .delete()
    .eq("chat_id", chatId);
  if (error) console.error("clearDraft", error);
}

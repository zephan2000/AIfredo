import { makeServiceClient } from "@aifredo/shared";
import type { SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null = null;

export function getServerSupabase(): SupabaseClient {
  if (!cached) cached = makeServiceClient();
  return cached;
}

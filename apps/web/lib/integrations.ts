import { encryptJson } from "@aifredo/shared";
import { getServerSupabase } from "./supabase";

export async function upsertIntegration(args: {
  user_id: string;
  provider: string;
  external_account_id: string;
  scopes: string[];
  tokens: unknown;
  config?: Record<string, unknown>;
}): Promise<void> {
  const supabase = getServerSupabase();
  const { error } = await supabase.from("user_integrations").upsert(
    {
      user_id: args.user_id,
      provider: args.provider,
      external_account_id: args.external_account_id,
      scopes: args.scopes,
      encrypted_tokens: encryptJson(args.tokens),
      config: args.config ?? {},
      status: "active",
      refreshed_at: new Date().toISOString(),
    },
    { onConflict: "user_id,provider,external_account_id" },
  );
  if (error) throw new Error(`upsertIntegration: ${error.message}`);
}

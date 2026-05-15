import { decryptString, encryptString } from "@aifredo/shared";
import { getServerSupabase } from "./supabase";

/**
 * Per-deployment, operator-set config for integrations
 * (e.g., slack/client_id). Encrypted at rest with INTEGRATION_TOKEN_KEY.
 * Set via `/admin set <provider> <key> <value>` in Telegram.
 */

export async function getAdminConfig(
  provider: string,
  key: string,
): Promise<string | null> {
  const supabase = getServerSupabase();
  const { data, error } = await supabase
    .from("admin_config")
    .select("encrypted_value")
    .eq("provider", provider)
    .eq("key", key)
    .maybeSingle();
  if (error) {
    console.error("getAdminConfig", error);
    return null;
  }
  if (!data) return null;
  return decryptString(data.encrypted_value as string);
}

export async function setAdminConfig(
  provider: string,
  key: string,
  value: string,
): Promise<void> {
  const supabase = getServerSupabase();
  const encrypted_value = encryptString(value);
  const { error } = await supabase
    .from("admin_config")
    .upsert(
      {
        provider,
        key,
        encrypted_value,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "provider,key" },
    );
  if (error) throw new Error(`setAdminConfig: ${error.message}`);
}

export async function listAdminConfig(provider: string): Promise<string[]> {
  const supabase = getServerSupabase();
  const { data, error } = await supabase
    .from("admin_config")
    .select("key")
    .eq("provider", provider);
  if (error) {
    console.error("listAdminConfig", error);
    return [];
  }
  return (data ?? []).map((r) => r.key as string);
}

import { getServerSupabase } from "./supabase";

export interface DigestGroup {
  name: string;
  include_channels: string[];
  exclude_channels: string[];
  enabled: boolean;
}

const COLS = "name, include_channels, exclude_channels, enabled";

function norm(chans: string[]): string[] {
  return chans
    .map((c) => c.replace(/^#/, "").toLowerCase().trim())
    .filter(Boolean);
}

export async function listDigests(user_id: string): Promise<DigestGroup[]> {
  const supabase = getServerSupabase();
  const { data, error } = await supabase
    .from("slack_digests")
    .select(COLS)
    .eq("user_id", user_id)
    .order("name");
  if (error) {
    console.error("listDigests", error);
    return [];
  }
  return (data ?? []) as DigestGroup[];
}

export async function getDigest(
  user_id: string,
  name: string,
): Promise<DigestGroup | null> {
  const supabase = getServerSupabase();
  const { data } = await supabase
    .from("slack_digests")
    .select(COLS)
    .eq("user_id", user_id)
    .eq("name", name)
    .maybeSingle();
  return (data as DigestGroup | null) ?? null;
}

/** Create the all-channels "default" group if it doesn't exist. */
export async function ensureDefault(user_id: string): Promise<DigestGroup> {
  const existing = await getDigest(user_id, "default");
  if (existing) return existing;
  const supabase = getServerSupabase();
  const { error } = await supabase.from("slack_digests").insert({
    user_id,
    name: "default",
    include_channels: [],
    exclude_channels: [],
  });
  if (error && !error.message.includes("duplicate")) {
    throw new Error(`ensureDefault: ${error.message}`);
  }
  return {
    name: "default",
    include_channels: [],
    exclude_channels: [],
    enabled: true,
  };
}

export async function upsertDigest(
  user_id: string,
  name: string,
  patch: { include?: string[]; exclude?: string[] },
): Promise<void> {
  const supabase = getServerSupabase();
  const row: Record<string, unknown> = { user_id, name };
  if (patch.include !== undefined) row.include_channels = norm(patch.include);
  if (patch.exclude !== undefined) row.exclude_channels = norm(patch.exclude);
  const { error } = await supabase
    .from("slack_digests")
    .upsert(row, { onConflict: "user_id,name" });
  if (error) throw new Error(`upsertDigest: ${error.message}`);
}

export async function deleteDigest(
  user_id: string,
  name: string,
): Promise<boolean> {
  const supabase = getServerSupabase();
  const { error, count } = await supabase
    .from("slack_digests")
    .delete({ count: "exact" })
    .eq("user_id", user_id)
    .eq("name", name);
  if (error) throw new Error(`deleteDigest: ${error.message}`);
  return (count ?? 0) > 0;
}

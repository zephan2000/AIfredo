import { getServerSupabase } from "./supabase";

export interface UserContext {
  user_id: string;
  chat_id: number;
}

export async function ensureUserFromTelegram(
  telegram_user_id: number,
  chat_id: number,
  display_name?: string,
): Promise<UserContext> {
  const supabase = getServerSupabase();

  const { data: link } = await supabase
    .from("telegram_links")
    .select("user_id, chat_id")
    .eq("telegram_user_id", telegram_user_id)
    .maybeSingle();

  if (link) return { user_id: link.user_id as string, chat_id: Number(link.chat_id) };

  const { data: user, error: userErr } = await supabase
    .from("users")
    .insert({ display_name: display_name ?? null })
    .select("id")
    .single();
  if (userErr || !user) throw new Error(`create user failed: ${userErr?.message}`);

  const { error: linkErr } = await supabase.from("telegram_links").insert({
    telegram_user_id,
    user_id: user.id,
    chat_id,
  });
  if (linkErr) throw new Error(`create telegram_link failed: ${linkErr.message}`);

  return { user_id: user.id as string, chat_id };
}

export async function recordInboundMessage(args: {
  user_id: string;
  chat_id: number;
  message_id: number;
  text: string;
}): Promise<void> {
  const supabase = getServerSupabase();
  const { error } = await supabase.from("messages").insert({
    user_id: args.user_id,
    channel: "telegram",
    external_message_id: String(args.message_id),
    external_chat_id: String(args.chat_id),
    role: "user",
    content: args.text,
  });
  if (error) console.error("recordInboundMessage", error);
}

export async function recordOutboundMessage(args: {
  user_id: string;
  chat_id: number;
  message_id: number;
  run_id: string;
  text: string;
}): Promise<void> {
  const supabase = getServerSupabase();
  const { error } = await supabase.from("messages").insert({
    user_id: args.user_id,
    channel: "telegram",
    external_message_id: String(args.message_id),
    external_chat_id: String(args.chat_id),
    run_id: args.run_id,
    role: "assistant",
    content: args.text,
  });
  if (error) console.error("recordOutboundMessage", error);
}

export async function createRun(args: {
  user_id: string;
  kind: string;
}): Promise<string> {
  const supabase = getServerSupabase();
  const { data, error } = await supabase
    .from("runs")
    .insert({ user_id: args.user_id, kind: args.kind, status: "queued" })
    .select("id")
    .single();
  if (error || !data) throw new Error(`createRun failed: ${error?.message}`);
  return data.id as string;
}

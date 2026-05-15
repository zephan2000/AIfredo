import { NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import {
  RUN_KINDS,
  TELEGRAM_EDIT_DEBOUNCE_MS,
  TelegramUpdateSchema,
} from "@aifredo/shared";
import type { BrainStreamEvent, TelegramUpdate } from "@aifredo/shared";
import { editMessage, sendMessage } from "@/lib/telegram";
import {
  createRun,
  ensureUserFromTelegram,
  recordInboundMessage,
  recordOutboundMessage,
} from "@/lib/users";
import { callBrain } from "@/lib/brain";
import { getHotSession, upsertHotSession } from "@/lib/sessions";
import {
  CAPABILITIES_SYSTEM_PROMPT,
  CAPABILITIES_TEXT,
} from "@/lib/capabilities";
import { getAdminConfig, listAdminConfig, setAdminConfig } from "@/lib/admin-config";
import { createPending } from "@/lib/oauth-pending";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<NextResponse> {
  if (
    req.headers.get("x-telegram-bot-api-secret-token") !==
    process.env.TELEGRAM_WEBHOOK_SECRET
  ) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = TelegramUpdateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ ok: true });

  const update = parsed.data;
  if (!update.message?.text) return NextResponse.json({ ok: true });

  const adminId = process.env.ADMIN_TELEGRAM_USER_ID;
  if (adminId && String(update.message.from.id) !== adminId) {
    return NextResponse.json({ ok: true });
  }

  waitUntil(handleUpdate(update));
  return NextResponse.json({ ok: true });
}

async function handleAdminCommand(args: string): Promise<string> {
  const parts = args.trim().split(/\s+/).filter(Boolean);
  const sub = parts[0];

  if (sub === "set") {
    const provider = parts[1];
    const key = parts[2];
    const value = parts.slice(3).join(" ");
    if (!provider || !key || !value) {
      return "Usage: /admin set <provider> <key> <value>";
    }
    try {
      await setAdminConfig(provider, key, value);
      return `Saved ${provider}.${key}. Tip: delete the message above — Telegram keeps it in your history.`;
    } catch (err) {
      return `⚠️ ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  if (sub === "show") {
    const provider = parts[1];
    if (!provider) return "Usage: /admin show <provider>";
    const keys = await listAdminConfig(provider);
    if (keys.length === 0) return `No config set for ${provider}.`;
    return `${provider}:\n` + keys.map((k) => `• ${k} ✓`).join("\n");
  }

  return "Unknown /admin command. Try: /admin set <provider> <key> <value> or /admin show <provider>.";
}

async function handleConnectCommand(
  prompt: string,
  userId: string,
): Promise<string> {
  const provider = prompt.trim().split(/\s+/)[1];
  if (!provider) return "Usage: /connect <provider> (supported: slack)";
  if (provider !== "slack") {
    return `Unsupported provider: ${provider}. Supported: slack.`;
  }

  const clientId = await getAdminConfig("slack", "client_id");
  if (!clientId) {
    return [
      "Slack client_id not set yet. First run:",
      "/admin set slack client_id <id>",
      "/admin set slack client_secret <secret>",
      "then /connect slack again.",
    ].join("\n");
  }

  const base = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (!base) {
    return "⚠️ Server misconfigured: VERCEL_PROJECT_PRODUCTION_URL is unset.";
  }

  const token = await createPending({ user_id: userId, provider: "slack" });
  return [
    "Connect Slack (link valid 5 minutes, single use):",
    `https://${base}/oauth/slack/start?token=${token}`,
  ].join("\n");
}

async function handleUpdate(update: TelegramUpdate): Promise<void> {
  const msg = update.message;
  if (!msg?.text) return;
  const chatId = msg.chat.id;

  let provider: "claude" | "codex" = "claude";
  let prompt = msg.text.trim();
  if (prompt.startsWith("/codex ")) {
    provider = "codex";
    prompt = prompt.slice("/codex ".length);
  } else if (prompt.startsWith("/claude ")) {
    prompt = prompt.slice("/claude ".length);
  } else if (prompt === "/start") {
    await sendMessage(
      chatId,
      "Hi. Send me a message. Use /info to see what I can do.",
    );
    return;
  } else if (prompt === "/info" || prompt === "/help") {
    await sendMessage(chatId, CAPABILITIES_TEXT);
    return;
  } else if (prompt.startsWith("/admin ") || prompt === "/admin") {
    const reply = await handleAdminCommand(prompt.replace(/^\/admin\s*/, ""));
    await sendMessage(chatId, reply);
    return;
  } else if (prompt.startsWith("/connect ") || prompt === "/connect") {
    const userCtx = await ensureUserFromTelegram(
      msg.from.id,
      chatId,
      msg.from.username ?? msg.from.first_name,
    );
    const reply = await handleConnectCommand(prompt, userCtx.user_id);
    await sendMessage(chatId, reply);
    return;
  }

  try {
    const userCtx = await ensureUserFromTelegram(
      msg.from.id,
      chatId,
      msg.from.username ?? msg.from.first_name,
    );

    // Don't store /admin set ... in messages — the value is a secret.
    const isAdminSet = msg.text.startsWith("/admin set ");
    await recordInboundMessage({
      user_id: userCtx.user_id,
      chat_id: chatId,
      message_id: msg.message_id,
      text: isAdminSet ? "/admin set <redacted>" : msg.text,
    });

    const placeholder = await sendMessage(chatId, "Working…");
    const runId = await createRun({
      user_id: userCtx.user_id,
      kind: RUN_KINDS.TELEGRAM_CHAT,
    });
    const hotSession = await getHotSession(chatId);

    let buffer = "";
    let lastEditAt = 0;
    let finalText = "";
    let resolvedSessionId: string | undefined;

    const flush = async (force = false): Promise<void> => {
      const now = Date.now();
      if (!force && now - lastEditAt < TELEGRAM_EDIT_DEBOUNCE_MS) return;
      if (!buffer.trim()) return;
      lastEditAt = now;
      await editMessage(chatId, placeholder.message_id, buffer);
    };

    const onEvent = async (event: BrainStreamEvent): Promise<void> => {
      switch (event.type) {
        case "delta":
          buffer += event.text;
          await flush();
          break;
        case "done":
          finalText = event.final;
          resolvedSessionId = event.session_id;
          await editMessage(
            chatId,
            placeholder.message_id,
            finalText || "(empty response)",
          );
          break;
        case "error":
          await editMessage(chatId, placeholder.message_id, `⚠️ ${event.message}`);
          break;
        case "rate_limit":
          console.log("brain rate_limit", event.info);
          break;
      }
    };

    await callBrain({
      run_id: runId,
      user_id: userCtx.user_id,
      provider,
      prompt,
      session_id: hotSession?.session_id,
      system: hotSession ? undefined : CAPABILITIES_SYSTEM_PROMPT,
      onEvent,
    });

    await flush(true);

    if (provider === "claude" && resolvedSessionId) {
      await upsertHotSession({
        telegram_chat_id: chatId,
        user_id: userCtx.user_id,
        session_id: resolvedSessionId,
      });
    }

    if (finalText) {
      await recordOutboundMessage({
        user_id: userCtx.user_id,
        chat_id: chatId,
        message_id: placeholder.message_id,
        run_id: runId,
        text: finalText,
      });
    }
  } catch (err) {
    console.error("handleUpdate failed", err);
    try {
      await sendMessage(
        chatId,
        `⚠️ Internal error: ${err instanceof Error ? err.message : String(err)}`,
      );
    } catch {
      // swallow
    }
  }
}

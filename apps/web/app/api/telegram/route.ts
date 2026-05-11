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
    await sendMessage(chatId, "Hi. Send me a message. Prefix with /codex to use Codex.");
    return;
  }

  try {
    const userCtx = await ensureUserFromTelegram(
      msg.from.id,
      chatId,
      msg.from.username ?? msg.from.first_name,
    );

    await recordInboundMessage({
      user_id: userCtx.user_id,
      chat_id: chatId,
      message_id: msg.message_id,
      text: msg.text,
    });

    const placeholder = await sendMessage(chatId, "Working…");
    const runId = await createRun({
      user_id: userCtx.user_id,
      kind: RUN_KINDS.TELEGRAM_CHAT,
    });

    let buffer = "";
    let lastEditAt = 0;
    let finalText = "";

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
      onEvent,
    });

    await flush(true);

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

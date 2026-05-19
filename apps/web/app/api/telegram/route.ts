import { NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import {
  RUN_KINDS,
  TELEGRAM_EDIT_DEBOUNCE_MS,
  TelegramUpdateSchema,
} from "@aifredo/shared";
import type { BrainStreamEvent, TelegramUpdate } from "@aifredo/shared";
import {
  editMessage,
  sendMessage,
  sendKeyboard,
  answerCallback,
  editTextClearKeyboard,
  type InlineKeyboard,
} from "@/lib/telegram";
import {
  createRun,
  ensureUserFromTelegram,
  recordInboundMessage,
  recordOutboundMessage,
} from "@/lib/users";
import { callBrain, fetchSlackDigest, tradeCheck, tradeExecute } from "@/lib/brain";
import { latestPendingTrade, abortTrade } from "@/lib/trade";
import {
  deleteDigest,
  ensureDefault,
  getDigest,
  listDigests,
  upsertDigest,
} from "@/lib/slack-digests";
import { buildSlackDigestPrompt } from "@aifredo/shared";
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
  const cb = update.callback_query;
  const fromId = cb ? cb.from.id : update.message?.from.id;
  if (!cb && !update.message?.text) return NextResponse.json({ ok: true });

  const adminId = process.env.ADMIN_TELEGRAM_USER_ID;
  if (adminId && String(fromId) !== adminId) {
    return NextResponse.json({ ok: true });
  }

  // Telegram always calls the registered (production) webhook URL, so the
  // request origin is the correct, stable base for building OAuth links.
  const baseUrl = new URL(req.url).origin;

  if (cb) {
    waitUntil(handleCallback(update, baseUrl));
  } else {
    waitUntil(handleUpdate(update, baseUrl));
  }
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
  baseUrl: string,
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

  const token = await createPending({ user_id: userId, provider: "slack" });
  return [
    "Connect Slack (link valid 5 minutes, single use):",
    `${baseUrl}/oauth/slack/start?token=${token}`,
  ].join("\n");
}

const DIGEST_USAGE = [
  "Slack digests:",
  "/digest list",
  "/digest new <name> #a #b",
  "/digest scope <name> #a #b   (or: all)",
  "/digest ignore <name> #x     (or: none)",
  "/digest run <name>",
  "/digest delete <name>",
].join("\n");

async function runDigest(
  userId: string,
  chatId: number,
  groupName: string,
): Promise<void> {
  const group =
    groupName === "default"
      ? await ensureDefault(userId)
      : await getDigest(userId, groupName);
  if (!group) {
    await sendMessage(chatId, `No digest group "${groupName}". /digest list`);
    return;
  }
  const placeholder = await sendMessage(chatId, `Building "${group.name}" digest…`);
  try {
    const data = await fetchSlackDigest({
      user_id: userId,
      include: group.include_channels,
      exclude: group.exclude_channels,
      since_hours: 24,
    });
    if (data.channels.length === 0) {
      await editMessage(
        chatId,
        placeholder.message_id,
        `Nothing in the last 24h for "${group.name}".` +
          (data.unresolved.length
            ? ` Unresolved: ${data.unresolved.map((u) => `#${u}`).join(", ")}`
            : ""),
      );
      return;
    }
    const prompt = buildSlackDigestPrompt(group.name, data.channels, data.unresolved);
    const runId = await createRun({
      user_id: userId,
      kind: RUN_KINDS.CRON_SLACK_DAILY,
    });
    let final = "";
    await callBrain({
      run_id: runId,
      user_id: userId,
      provider: "claude",
      prompt,
      onEvent: (e: BrainStreamEvent) => {
        if (e.type === "done") final = e.final;
        else if (e.type === "error") final = `⚠️ ${e.message}`;
      },
    });
    await editMessage(
      chatId,
      placeholder.message_id,
      final.trim() || "(empty digest)",
    );
  } catch (err) {
    await editMessage(
      chatId,
      placeholder.message_id,
      `⚠️ digest failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

async function handleDigestCommand(
  prompt: string,
  userId: string,
  chatId: number,
): Promise<void> {
  const parts = prompt.trim().split(/\s+/).filter(Boolean);
  const sub = parts[1];
  const name = parts[2];
  const rest = parts.slice(3);

  if (!sub || sub === "list") {
    await ensureDefault(userId);
    const groups = await listDigests(userId);
    const lines = groups.map((g) => {
      const scope = g.include_channels.length
        ? g.include_channels.map((c) => `#${c}`).join(" ")
        : "all member channels";
      const ex = g.exclude_channels.length
        ? ` — ignoring ${g.exclude_channels.map((c) => `#${c}`).join(" ")}`
        : "";
      return `• ${g.name}: ${scope}${ex}`;
    });
    await sendMessage(chatId, "Digest groups:\n" + lines.join("\n"));
    return;
  }

  if (sub === "run") {
    await runDigest(userId, chatId, name ?? "default");
    return;
  }

  if (sub === "delete") {
    if (!name) return void (await sendMessage(chatId, DIGEST_USAGE));
    const ok = await deleteDigest(userId, name);
    await sendMessage(
      chatId,
      ok ? `Deleted "${name}".` : `No group "${name}".`,
    );
    return;
  }

  if (sub === "new" || sub === "scope" || sub === "ignore") {
    if (!name) return void (await sendMessage(chatId, DIGEST_USAGE));
    const chans =
      rest.length === 1 && (rest[0] === "all" || rest[0] === "none")
        ? []
        : rest;
    try {
      if (sub === "ignore") {
        await upsertDigest(userId, name, { exclude: chans });
      } else {
        await upsertDigest(userId, name, { include: chans });
      }
      await sendMessage(
        chatId,
        `Saved "${name}". /digest run ${name} to preview.`,
      );
    } catch (err) {
      await sendMessage(
        chatId,
        `⚠️ ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return;
  }

  await sendMessage(chatId, DIGEST_USAGE);
}

const TRADE_USAGE =
  "Usage: /trade SYMBOL BUY|SELL QTY LIMIT|MARKET [PRICE] [#tag …] [thesis]\n" +
  "e.g. /trade BTCUSDT BUY 0.01 LIMIT 60000 #revenge win it back\n" +
  "Then reply CONFIRM (or OVERRIDE if warned) / ABORT. 5-min window.";

async function handleTradeCommand(
  prompt: string,
  userId: string,
  chatId: number,
): Promise<void> {
  const t = prompt.trim().split(/\s+/).slice(1);
  const symbol = (t[0] ?? "").toUpperCase();
  const side = (t[1] ?? "").toUpperCase();
  const qty = Number(t[2]);
  const orderType = (t[3] ?? "").toUpperCase();
  if (
    !symbol ||
    (side !== "BUY" && side !== "SELL") ||
    !Number.isFinite(qty) ||
    qty <= 0 ||
    (orderType !== "LIMIT" && orderType !== "MARKET")
  ) {
    await sendMessage(chatId, TRADE_USAGE);
    return;
  }
  let rest = t.slice(4);
  let limitPrice: number | null = null;
  if (orderType === "LIMIT") {
    limitPrice = Number(t[4]);
    if (!Number.isFinite(limitPrice) || limitPrice <= 0) {
      await sendMessage(chatId, "LIMIT needs a positive PRICE.\n" + TRADE_USAGE);
      return;
    }
    rest = t.slice(5);
  }
  const stateTags = rest
    .filter((x) => x.startsWith("#"))
    .map((x) => x.slice(1).toLowerCase())
    .filter(Boolean);
  const thesis = rest.filter((x) => !x.startsWith("#")).join(" ") || undefined;

  try {
    const r = await tradeCheck(userId, {
      symbol,
      side: side as "BUY" | "SELL",
      orderType: orderType as "LIMIT" | "MARKET",
      qty,
      limitPrice,
      stateTags,
      thesis,
    });
    const head =
      r.verdict === "clear"
        ? `✅ CLEAR — ${symbol} ${side} ${qty} ${orderType} (~${r.estNotional} USDT, ${r.mode})`
        : `⚠️ WARN — ${symbol} ${side} ${qty} ${orderType} (~${r.estNotional} USDT, ${r.mode})`;
    const ackLine =
      r.verdict === "warn"
        ? "Repeats a pattern. Override to place anyway, or abort."
        : "Tap to place, or abort.";
    const j = r.journalId;
    const proceed =
      r.verdict === "warn"
        ? { text: "⚠️ OVERRIDE", callback_data: `trade:override:${j}` }
        : { text: "✅ CONFIRM", callback_data: `trade:confirm:${j}` };
    await sendKeyboard(
      chatId,
      `${head}\n\n${r.reasons}\n\n${ackLine} (5-min window)`,
      [[proceed, { text: "✖ ABORT", callback_data: `trade:abort:${j}` }]],
    );
  } catch (err) {
    await sendMessage(
      chatId,
      `⚠️ check failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

async function handleTradeAck(
  word: "CONFIRM" | "OVERRIDE" | "ABORT",
  userId: string,
  chatId: number,
): Promise<void> {
  const pending = await latestPendingTrade(userId);
  if (!pending) {
    await sendMessage(chatId, "Nothing pending (or the 5-min window expired).");
    return;
  }
  if (word === "ABORT") {
    await abortTrade(pending.id);
    await sendMessage(chatId, `Aborted ${pending.symbol}.`);
    return;
  }
  if (pending.verdict === "warn" && word === "CONFIRM") {
    await sendMessage(
      chatId,
      `${pending.symbol} was WARNed — reply OVERRIDE to place it anyway, or ABORT.`,
    );
    return;
  }
  try {
    const r = await tradeExecute(
      userId,
      pending.id,
      word === "OVERRIDE" ? "override" : "confirm",
    );
    const icon = r.status === "filled" ? "✅" : "🛑";
    await sendMessage(chatId, `${icon} ${pending.symbol}: ${r.status} — ${r.detail}`);
  } catch (err) {
    await sendMessage(
      chatId,
      `⚠️ execute failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

const MENU_KEYBOARD: InlineKeyboard = [
  [
    { text: "📈 Trade", callback_data: "menu:trade" },
    { text: "📓 Trade review", callback_data: "menu:review" },
  ],
  [
    { text: "📨 Digests", callback_data: "menu:digests" },
    { text: "🔌 Connect", callback_data: "menu:connect" },
  ],
  [{ text: "❔ Help", callback_data: "menu:help" }],
];

async function handleTradeCallback(
  action: "confirm" | "override" | "abort",
  journalId: string,
  userId: string,
  chatId: number,
  messageId: number,
): Promise<void> {
  if (action === "abort") {
    await abortTrade(journalId);
    await editTextClearKeyboard(chatId, messageId, "✖ Aborted.");
    return;
  }
  try {
    const r = await tradeExecute(userId, journalId, action);
    const icon = r.status === "filled" ? "✅" : "🛑";
    await editTextClearKeyboard(
      chatId,
      messageId,
      `${icon} ${r.status} — ${r.detail}`,
    );
  } catch (err) {
    await editTextClearKeyboard(
      chatId,
      messageId,
      `⚠️ execute failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

async function handleCallback(
  update: TelegramUpdate,
  baseUrl: string,
): Promise<void> {
  const cb = update.callback_query;
  if (!cb) return;
  await answerCallback(cb.id);
  const data = cb.data;
  const chatId = cb.message?.chat.id;
  const messageId = cb.message?.message_id;
  if (!data || chatId == null || messageId == null) return;

  const userCtx = await ensureUserFromTelegram(
    cb.from.id,
    chatId,
    cb.from.username ?? cb.from.first_name,
  );

  if (data.startsWith("trade:")) {
    const [, action, journalId] = data.split(":");
    if (
      (action === "confirm" || action === "override" || action === "abort") &&
      journalId
    ) {
      await handleTradeCallback(
        action,
        journalId,
        userCtx.user_id,
        chatId,
        messageId,
      );
    }
    return;
  }

  switch (data) {
    case "menu:trade":
      await sendMessage(chatId, TRADE_USAGE);
      return;
    case "menu:review":
      await sendMessage(
        chatId,
        "📓 The daily trade review runs ~22:00 SGT (read-only): it summarises the day's /trade journal vs your anti-patterns. It never places orders.",
      );
      return;
    case "menu:digests":
      await handleDigestCommand("/digest list", userCtx.user_id, chatId);
      return;
    case "menu:connect":
      await sendMessage(chatId, "Link a third-party account: /connect slack");
      return;
    case "menu:help":
      await sendMessage(chatId, CAPABILITIES_TEXT);
      return;
    default:
      return;
  }
}

async function handleUpdate(
  update: TelegramUpdate,
  baseUrl: string,
): Promise<void> {
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
    await sendKeyboard(
      chatId,
      "Hi. Send me a message, or pick an action below. /info lists everything.",
      MENU_KEYBOARD,
    );
    return;
  } else if (prompt === "/menu") {
    await sendKeyboard(chatId, "📋 AIfredo — choose:", MENU_KEYBOARD);
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
    const reply = await handleConnectCommand(prompt, userCtx.user_id, baseUrl);
    await sendMessage(chatId, reply);
    return;
  } else if (prompt.startsWith("/digest") ) {
    const userCtx = await ensureUserFromTelegram(
      msg.from.id,
      chatId,
      msg.from.username ?? msg.from.first_name,
    );
    await handleDigestCommand(prompt, userCtx.user_id, chatId);
    return;
  } else if (prompt.startsWith("/trade") || prompt === "/trade") {
    const userCtx = await ensureUserFromTelegram(
      msg.from.id,
      chatId,
      msg.from.username ?? msg.from.first_name,
    );
    await handleTradeCommand(prompt, userCtx.user_id, chatId);
    return;
  } else if (/^(CONFIRM|OVERRIDE|ABORT)\b/i.test(prompt.trim())) {
    const word = prompt.trim().split(/\s+/)[0]!.toUpperCase() as
      | "CONFIRM"
      | "OVERRIDE"
      | "ABORT";
    const userCtx = await ensureUserFromTelegram(
      msg.from.id,
      chatId,
      msg.from.username ?? msg.from.first_name,
    );
    await handleTradeAck(word, userCtx.user_id, chatId);
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

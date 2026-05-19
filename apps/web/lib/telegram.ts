const TG_API = "https://api.telegram.org";

const token = (): string => {
  const t = process.env.TELEGRAM_BOT_TOKEN;
  if (!t) throw new Error("TELEGRAM_BOT_TOKEN required");
  return t;
};

export async function sendMessage(
  chat_id: number,
  text: string,
): Promise<{ message_id: number }> {
  const res = await fetch(`${TG_API}/bot${token()}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id, text }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`telegram sendMessage ${res.status}: ${body}`);
  }
  const json = (await res.json()) as {
    ok: boolean;
    result: { message_id: number };
  };
  return { message_id: json.result.message_id };
}

export async function editMessage(
  chat_id: number,
  message_id: number,
  text: string,
): Promise<void> {
  const truncated = text.length > 4000 ? text.slice(0, 4000) + "…" : text;
  const res = await fetch(`${TG_API}/bot${token()}/editMessageText`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id, message_id, text: truncated }),
  });
  if (!res.ok && res.status !== 400) {
    // 400 includes "message is not modified" — benign during rapid edits.
    const body = await res.text().catch(() => "");
    console.error("editMessage failed", res.status, body);
  }
}

export type InlineKeyboard = Array<
  Array<{ text: string; callback_data: string }>
>;

export async function sendKeyboard(
  chat_id: number,
  text: string,
  keyboard: InlineKeyboard,
): Promise<{ message_id: number }> {
  const res = await fetch(`${TG_API}/bot${token()}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id,
      text: text.length > 4000 ? text.slice(0, 4000) + "…" : text,
      reply_markup: { inline_keyboard: keyboard },
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`telegram sendKeyboard ${res.status}: ${body}`);
  }
  const json = (await res.json()) as { result: { message_id: number } };
  return { message_id: json.result.message_id };
}

// Telegram requires answering every callback_query (stops the client spinner).
export async function answerCallback(
  callback_query_id: string,
  text?: string,
): Promise<void> {
  await fetch(`${TG_API}/bot${token()}/answerCallbackQuery`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ callback_query_id, text }),
  }).catch(() => undefined);
}

// Replace a message's text + drop its buttons (used after a tap resolves).
export async function editTextClearKeyboard(
  chat_id: number,
  message_id: number,
  text: string,
): Promise<void> {
  const res = await fetch(`${TG_API}/bot${token()}/editMessageText`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id,
      message_id,
      text: text.length > 4000 ? text.slice(0, 4000) + "…" : text,
      reply_markup: { inline_keyboard: [] },
    }),
  });
  if (!res.ok && res.status !== 400) {
    const body = await res.text().catch(() => "");
    console.error("editTextClearKeyboard failed", res.status, body);
  }
}

const TG_API = "https://api.telegram.org";

export async function sendMessage(
  chat_id: number,
  text: string,
  opts: { disableWebPagePreview?: boolean } = {},
): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN required");

  const safe = text.length > 4000 ? text.slice(0, 4000) + "…" : text;

  const res = await fetch(`${TG_API}/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id,
      text: safe,
      disable_web_page_preview: opts.disableWebPagePreview ?? true,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`telegram sendMessage ${res.status}: ${body}`);
  }
}

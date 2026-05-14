import { XMLParser } from "fast-xml-parser";

export interface RSSItem {
  title: string;
  url: string;
  publishedAt: string | null;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  trimValues: true,
});

export async function fetchRSS(url: string): Promise<RSSItem[]> {
  const res = await fetch(url, { headers: { "user-agent": "AIfredo/1.0 (+https://github.com/zephan2000/AIfredo)" } });
  if (!res.ok) throw new Error(`fetchRSS ${url} → ${res.status}`);
  const xml = await res.text();
  const json = parser.parse(xml) as Record<string, unknown>;

  const channel = (json.rss as { channel?: Record<string, unknown> } | undefined)?.channel;
  const itemsRaw = channel?.item;
  if (!itemsRaw) return [];
  const arr = Array.isArray(itemsRaw) ? itemsRaw : [itemsRaw];

  return arr
    .map((it) => {
      const item = it as Record<string, unknown>;
      const title = extractText(item.title);
      const link = extractText(item.link);
      const pub = typeof item.pubDate === "string" ? item.pubDate : null;
      return { title: title.trim(), url: link.trim(), publishedAt: pub };
    })
    .filter((i) => i.title && i.url);
}

function extractText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "#text" in value) {
    const t = (value as { "#text": unknown })["#text"];
    return typeof t === "string" ? t : "";
  }
  return "";
}

import { XMLParser } from "fast-xml-parser";

export interface RSSItem {
  title: string;
  url: string;
  publishedAt: string | null;
  // Plain-text lede from <description>/<content:encoded>, HTML-stripped and
  // capped. Lets the digest summarise the actual article, not just the
  // headline. Paywalled posts (some Substacks) yield only their teaser here.
  snippet: string;
}

const SNIPPET_MAX = 400;

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
      const rawBody =
        extractText(item["content:encoded"]) || extractText(item.description);
      return {
        title: title.trim(),
        url: link.trim(),
        publishedAt: pub,
        snippet: toSnippet(rawBody),
      };
    })
    .filter((i) => i.title && i.url);
}

function toSnippet(html: string): string {
  const text = html
    .replace(/<[^>]+>/g, " ")
    .replace(/&(?:nbsp|#160);/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&(?:quot|#34);/g, '"')
    .replace(/&(?:#39|apos);/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => safeCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeCodePoint(parseInt(d, 10)))
    .replace(/\s+/g, " ")
    .trim();
  return text.length > SNIPPET_MAX
    ? text.slice(0, SNIPPET_MAX).trimEnd() + "…"
    : text;
}

function safeCodePoint(n: number): string {
  try {
    return Number.isFinite(n) ? String.fromCodePoint(n) : "";
  } catch {
    return "";
  }
}

function extractText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "#text" in value) {
    const t = (value as { "#text": unknown })["#text"];
    return typeof t === "string" ? t : "";
  }
  return "";
}

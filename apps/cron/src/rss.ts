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

// Kept tight: the snippet is only a relevance/why-it-matters cue for a
// one-line signal entry, not a briefing source. Smaller snippets keep each
// phased per-category prompt short enough that claude -p returns before the
// brain→tunnel→runner SSE connection times out (the Finance-phase failure).
const SNIPPET_MAX = 200;

const parser = new XMLParser({
  ignoreAttributes: false,
  trimValues: true,
});

export async function fetchRSS(url: string): Promise<RSSItem[]> {
  // Substack (and some others) 403 non-browser UAs / datacenter IPs on
  // /feed. A browser UA clears the UA-based block; if the block is purely
  // IP-based (GitHub runner range) this won't help — those feeds then fall
  // out via the per-feed catch and move to A2 capture.
  const res = await fetch(url, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      accept: "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8",
    },
  });
  if (!res.ok) throw new Error(`fetchRSS ${url} → ${res.status}`);
  const xml = await res.text();
  const json = parser.parse(xml) as Record<string, unknown>;

  const channel = (json.rss as { channel?: Record<string, unknown> } | undefined)?.channel;
  const itemsRaw = channel?.item;
  if (itemsRaw) {
    const arr = Array.isArray(itemsRaw) ? itemsRaw : [itemsRaw];
    return arr
      .map((it) => {
        const item = it as Record<string, unknown>;
        const rawBody =
          extractText(item["content:encoded"]) ||
          extractText(item.description);
        return {
          title: extractText(item.title).trim(),
          url: extractText(item.link).trim(),
          publishedAt: typeof item.pubDate === "string" ? item.pubDate : null,
          snippet: toSnippet(rawBody),
        };
      })
      .filter((i) => i.title && i.url);
  }

  // Atom (e.g. YouTube feeds: <feed><entry>…). Link is an attribute, not
  // text; YouTube puts the blurb in media:group/media:description.
  const entriesRaw = (json.feed as { entry?: unknown } | undefined)?.entry;
  if (entriesRaw) {
    const arr = Array.isArray(entriesRaw) ? entriesRaw : [entriesRaw];
    return arr
      .map((it) => {
        const e = it as Record<string, unknown>;
        const mediaGroup = e["media:group"] as
          | Record<string, unknown>
          | undefined;
        const rawBody =
          extractText(mediaGroup?.["media:description"]) ||
          extractText(e.summary) ||
          extractText(e.content);
        const pub =
          typeof e.published === "string"
            ? e.published
            : typeof e.updated === "string"
              ? e.updated
              : null;
        return {
          title: extractText(e.title).trim(),
          url: atomHref(e.link).trim(),
          publishedAt: pub,
          snippet: toSnippet(rawBody),
        };
      })
      .filter((i) => i.title && i.url);
  }

  return [];
}

function atomHref(link: unknown): string {
  const pick = (l: unknown): string => {
    if (l && typeof l === "object") {
      const o = l as Record<string, unknown>;
      const href = o["@_href"];
      return typeof href === "string" ? href : "";
    }
    return typeof l === "string" ? l : "";
  };
  if (Array.isArray(link)) {
    const alt = link.find(
      (l) =>
        l &&
        typeof l === "object" &&
        (l as Record<string, unknown>)["@_rel"] === "alternate",
    );
    return pick(alt ?? link[0]);
  }
  return pick(link);
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

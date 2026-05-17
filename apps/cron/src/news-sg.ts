import { randomUUID } from "node:crypto";
import { makeServiceClient, RUN_KINDS } from "@aifredo/shared";
import type { BrainStreamEvent } from "@aifredo/shared";
import { fetchRSS } from "./rss.js";
import type { RSSItem } from "./rss.js";
import { callBrain } from "./brain-client.js";
import { sendMessage } from "./telegram.js";

// Matches the row seeded by supabase/migrations/0004_admin_seed.sql.
const ADMIN_USER_UUID = "e6f02d30-ef47-4c54-b754-8dd5b5eae6e9";

interface Feed {
  kind: string; // dedupe discriminator (cron_seen_urls.kind)
  source: string; // human source label
  category: string; // digest section heading
  url: string;
  maxCandidates: number; // fetch cap into the candidate pool
  pick: number; // how many Claude surfaces for this category
}

// Feeds are trivially swappable: change a URL or add a row. Each is a single
// category here, but grouping is by `category` so a category could later span
// multiple feeds. World Cup uses the general BBC football feed (no stable
// WC-only feed exists) — the prompt filters it to 2026-WC-relevant items.
const FEEDS: Feed[] = [
  {
    kind: "cna",
    source: "CNA",
    category: "SG news",
    url: "https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml&category=10416",
    maxCandidates: 25,
    pick: 3,
  },
  {
    kind: "st-biz",
    source: "Straits Times Business",
    category: "SG finance",
    url: "https://www.straitstimes.com/news/business/rss.xml",
    maxCandidates: 15,
    pick: 2,
  },
  {
    kind: "lfc",
    source: "BBC Sport",
    category: "Liverpool FC",
    url: "http://feeds.bbci.co.uk/sport/football/teams/liverpool/rss.xml",
    maxCandidates: 15,
    pick: 2,
  },
  {
    kind: "worldcup",
    source: "BBC Sport",
    category: "World Cup",
    url: "http://feeds.bbci.co.uk/sport/football/rss.xml",
    maxCandidates: 25,
    pick: 2,
  },
  {
    kind: "mothership",
    source: "Mothership",
    category: "SG fun",
    url: "https://mothership.sg/feed/",
    maxCandidates: 15,
    pick: 2,
  },
];

interface CandidateItem extends RSSItem {
  kind: string;
  source: string;
  category: string;
}

async function main(): Promise<void> {
  const chatIdRaw =
    process.env.ADMIN_TELEGRAM_CHAT_ID ?? process.env.ADMIN_TELEGRAM_USER_ID;
  if (!chatIdRaw) {
    throw new Error("ADMIN_TELEGRAM_USER_ID or ADMIN_TELEGRAM_CHAT_ID required");
  }
  const chatId = Number(chatIdRaw);
  if (!Number.isFinite(chatId)) throw new Error("invalid admin chat id");

  const supabase = makeServiceClient();

  const fetched = await Promise.all(
    FEEDS.map(async (f): Promise<CandidateItem[]> => {
      try {
        const items = await fetchRSS(f.url);
        return items
          .slice(0, f.maxCandidates)
          .map((i) => ({
            ...i,
            kind: f.kind,
            source: f.source,
            category: f.category,
          }));
      } catch (err) {
        console.error(`fetch ${f.kind} failed:`, err);
        return [];
      }
    }),
  );
  const candidates = fetched.flat();
  if (candidates.length === 0) {
    console.log("no items fetched from any feed; exiting");
    return;
  }

  const urls = candidates.map((c) => c.url);
  const { data: seenRows, error: seenErr } = await supabase
    .from("cron_seen_urls")
    .select("url")
    .in("url", urls);
  if (seenErr) throw new Error(`select cron_seen_urls: ${seenErr.message}`);
  const seen = new Set((seenRows ?? []).map((r) => r.url as string));

  const fresh = candidates.filter((c) => !seen.has(c.url));
  if (fresh.length === 0) {
    console.log("no fresh items; exiting silently");
    return;
  }

  const pickByCategory = new Map(FEEDS.map((f) => [f.category, f.pick]));
  const categoryOrder = [...new Set(FEEDS.map((f) => f.category))];
  const groups: DigestGroup[] = categoryOrder
    .map((category) => ({
      category,
      pick: pickByCategory.get(category) ?? 1,
      items: fresh.filter((c) => c.category === category),
    }))
    .filter((g) => g.items.length > 0);
  if (groups.length === 0) return;

  const today = new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "Asia/Singapore",
  }).format(new Date());

  const prompt = buildPrompt(today, groups);

  const runId = randomUUID();
  const { error: runErr } = await supabase.from("runs").insert({
    id: runId,
    user_id: ADMIN_USER_UUID,
    kind: RUN_KINDS.CRON_NEWS_SG,
    status: "queued",
  });
  if (runErr) throw new Error(`insert run: ${runErr.message}`);

  let final = "";
  await callBrain({
    runId,
    userId: ADMIN_USER_UUID,
    provider: "claude",
    prompt,
    onEvent: (e: BrainStreamEvent) => {
      if (e.type === "done") final = e.final;
      else if (e.type === "error") {
        console.error("brain error event:", e.message);
      }
    },
  });

  if (!final.trim()) {
    console.error("brain returned empty final text; not sending");
    return;
  }

  await sendMessage(chatId, final);

  const seenInserts = fresh.map((c) => ({ url: c.url, kind: c.kind }));
  const { error: insErr } = await supabase
    .from("cron_seen_urls")
    .upsert(seenInserts, { onConflict: "url" });
  if (insErr) console.error("cron_seen_urls upsert failed:", insErr.message);
}

interface DigestGroup {
  category: string;
  pick: number;
  items: CandidateItem[];
}

function buildPrompt(today: string, groups: DigestGroup[]): string {
  const groupsJson = JSON.stringify(
    groups.map((g) => ({
      category: g.category,
      pick: g.pick,
      items: g.items.map((i) => ({ title: i.title, url: i.url })),
    })),
    null,
    2,
  );

  return `You are assembling the operator's single daily reading digest.

Output ONE plain-text Telegram message — no markdown, no commentary before or after. Format:

📰 Daily digest — ${today}

<Category>
• <title> — <one short sentence on what it is or why it matters>. <url>
• ...

<next Category>
• ...

Rules:
- Use the URLs verbatim from the JSON below.
- One section per category, in the order given; emit a section only if you select at least one item for it. Title each section exactly with the category name.
- Per category, pick at most its stated "pick" count; fewer is fine, never invent items.
- For the "World Cup" category, include only items about the 2026 FIFA World Cup (qualifiers, host nations, squads, build-up). If none qualify, omit that section.
- Keep each bullet under 200 characters.
- Prefer items genuinely worth a busy person's attention.

Categories (JSON: {category, pick, items:[{title,url}]}):
${groupsJson}`;
}

main().catch((err) => {
  console.error("news-sg failed:", err);
  process.exitCode = 1;
});

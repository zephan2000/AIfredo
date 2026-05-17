import { randomUUID } from "node:crypto";
import { makeServiceClient, RUN_KINDS } from "@aifredo/shared";
import type { BrainStreamEvent } from "@aifredo/shared";
import { fetchRSS } from "./rss.js";
import type { RSSItem } from "./rss.js";
import { callBrain } from "./brain-client.js";
import { sendMessage } from "./telegram.js";

// Matches the row seeded by supabase/migrations/0004_admin_seed.sql.
const ADMIN_USER_UUID = "e6f02d30-ef47-4c54-b754-8dd5b5eae6e9";

type Depth = "deep" | "brief";

interface Feed {
  kind: string; // dedupe discriminator (cron_seen_urls.kind)
  source: string; // human source label
  category: string; // digest section heading
  url: string;
  maxCandidates: number; // fetch cap into the candidate pool
  pick: number; // how many Claude surfaces (per category; same within one)
  depth: Depth; // "deep" = 2-3 sentence body-grounded; "brief" = one line
}

// Trivially swappable: edit a URL or add a row. Grouping is by `category`, so
// a category spans multiple feeds (Finance, Tech). All feeds are RSS 2.0
// (fetchRSS doesn't parse Atom — The Verge was dropped for that reason).
// World Cup uses the general BBC football feed (no stable WC-only feed
// exists) — the prompt filters it to 2026-WC-relevant items. Substack
// maxCandidates are low: they post infrequently and some are paywalled
// (RSS yields only a teaser), so a few recent items is enough.
const FEEDS: Feed[] = [
  {
    kind: "cna",
    source: "CNA",
    category: "SG news",
    url: "https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml&category=10416",
    maxCandidates: 12,
    pick: 2,
    depth: "deep",
  },
  {
    kind: "bbc-biz",
    source: "BBC Business",
    category: "Finance",
    url: "http://feeds.bbci.co.uk/news/business/rss.xml",
    maxCandidates: 12,
    pick: 3,
    depth: "deep",
  },
  {
    kind: "st-biz",
    source: "Straits Times Business",
    category: "Finance",
    url: "https://www.straitstimes.com/news/business/rss.xml",
    maxCandidates: 8,
    pick: 3,
    depth: "deep",
  },
  {
    kind: "netinterest",
    source: "Net Interest",
    category: "Finance",
    url: "https://netinterest.substack.com/feed",
    maxCandidates: 5,
    pick: 3,
    depth: "deep",
  },
  {
    kind: "ftblueprint",
    source: "Fintech Blueprint",
    category: "Finance",
    url: "https://lex.substack.com/feed",
    maxCandidates: 5,
    pick: 3,
    depth: "deep",
  },
  {
    kind: "fthood",
    source: "Fintech: Under the Hood",
    category: "Finance",
    url: "https://jasshah.substack.com/feed",
    maxCandidates: 5,
    pick: 3,
    depth: "deep",
  },
  {
    kind: "hn",
    source: "Hacker News",
    category: "Tech",
    url: "https://hnrss.org/frontpage",
    maxCandidates: 12,
    pick: 2,
    depth: "deep",
  },
  {
    kind: "pragmatic",
    source: "The Pragmatic Engineer",
    category: "Tech",
    url: "https://newsletter.pragmaticengineer.com/feed",
    maxCandidates: 5,
    pick: 2,
    depth: "deep",
  },
  {
    kind: "lfc",
    source: "BBC Sport",
    category: "Liverpool FC",
    url: "http://feeds.bbci.co.uk/sport/football/teams/liverpool/rss.xml",
    maxCandidates: 10,
    pick: 1,
    depth: "brief",
  },
  {
    kind: "worldcup",
    source: "BBC Sport",
    category: "World Cup",
    url: "http://feeds.bbci.co.uk/sport/football/rss.xml",
    maxCandidates: 20,
    pick: 1,
    depth: "brief",
  },
  {
    kind: "mothership",
    source: "Mothership",
    category: "SG fun",
    url: "https://mothership.sg/feed/",
    maxCandidates: 10,
    pick: 1,
    depth: "brief",
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
  const depthByCategory = new Map(FEEDS.map((f) => [f.category, f.depth]));
  const categoryOrder = [...new Set(FEEDS.map((f) => f.category))];
  const groups: DigestGroup[] = categoryOrder
    .map((category) => ({
      category,
      pick: pickByCategory.get(category) ?? 1,
      depth: depthByCategory.get(category) ?? "brief",
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
  depth: Depth;
  items: CandidateItem[];
}

function buildPrompt(today: string, groups: DigestGroup[]): string {
  const groupsJson = JSON.stringify(
    groups.map((g) => ({
      category: g.category,
      pick: g.pick,
      depth: g.depth,
      items: g.items.map((i) => ({
        title: i.title,
        url: i.url,
        snippet: i.snippet,
      })),
    })),
    null,
    2,
  );

  return `You are assembling the operator's single daily reading digest. The operator is ramping a client-delivery role in banking/fintech — bias selection toward items he could actually discuss or learn from, not routine wire copy.

Output ONE plain-text Telegram message — no markdown, no commentary before or after. Format:

📰 Daily digest — ${today}

<Category>
• <headline> — <summary>. <url>
• ...

<next Category>
• ...

Rules:
- Use each item's URL verbatim from the JSON; ground every summary in that item's "snippet" (the article lede), not just its title or your own assumptions. If a snippet is a paywalled teaser, summarise what it does say and don't invent the rest.
- One section per category, in the JSON order; emit a section only if you select ≥1 item for it. Title each section exactly with the category name.
- Per category, select at most its "pick" count of the most substantive items; fewer is fine, never invent items.
- depth "deep" (SG news, Finance, Tech): write 2–3 sentences per item — what happened, why it matters, and the one thing worth understanding (the angle that lets him talk to it). Up to ~400 characters per item.
- depth "brief" (Liverpool FC, World Cup, SG fun): one tight line per item, under 150 characters — just what happened.
- For "World Cup", include only items about the 2026 FIFA World Cup (qualifiers, hosts, squads, build-up); omit the section if none qualify.

Categories (JSON: {category, pick, depth, items:[{title,url,snippet}]}):
${groupsJson}`;
}

main().catch((err) => {
  console.error("news-sg failed:", err);
  process.exitCode = 1;
});

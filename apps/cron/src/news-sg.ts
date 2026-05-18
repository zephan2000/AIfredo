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
  depth: Depth; // "deep" = headline + one why-it-matters clause; "brief" = bare headline
}

// Trivially swappable: edit a URL or add a row. Grouping is by `category`, so
// a category spans multiple feeds (Finance, Tech). RSS 2.0 and Atom both
// parse (fetchRSS handles both — the YouTube feed is Atom). World Cup uses
// the general BBC football feed (no stable WC-only feed) — prompt-filtered
// to 2026-WC items. Paywalled feeds (Pragmatic Engineer, the Substacks)
// were removed: RSS yields only a teaser, so summaries are hollow — source
// those via A2 capture. "deep" categories get a one-clause why-it-matters;
// "brief" are bare pointers (sports/fun/video).
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
    kind: "finextra",
    source: "Finextra",
    category: "Finance",
    url: "https://www.finextra.com/rss/headlines.aspx",
    maxCandidates: 12,
    pick: 3,
    depth: "deep",
  },
  // Substacks (Net Interest / Fintech Blueprint / Fintech: Under the Hood)
  // and Pragmatic Engineer were removed — Substack IP-blocks CI runners and
  // PE is paywalled (teaser-only RSS). Sourced via A2 capture instead.
  {
    kind: "ars",
    source: "Ars Technica",
    category: "Tech",
    url: "http://feeds.arstechnica.com/arstechnica/index",
    maxCandidates: 10,
    pick: 2,
    depth: "deep",
  },
  {
    kind: "hn",
    source: "Hacker News",
    category: "Tech",
    url: "https://hnrss.org/frontpage",
    maxCandidates: 10,
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
  {
    kind: "11fs-explores",
    source: "11:FS Explores",
    category: "Watch",
    url: "https://www.youtube.com/feeds/videos.xml?playlist_id=PLETYuCAuWiG5bdZ_rFrbu8qABXlmAn_1W",
    maxCandidates: 6,
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

  // Phased: one SHORT claude call per category, run strictly sequentially
  // (cron awaits each before the next, so the brain never has two claude
  // subprocesses at once — respects the e2-micro serial-subprocess limit).
  // Small per-category prompts keep each brain SSE stream short enough to
  // finish before the tunnel/connection timeout — the failure mode the
  // single big-prompt call hit. Sections are concatenated into ONE Telegram
  // message. A failed/empty phase is skipped, never fails the whole digest.
  const sections: string[] = [];
  for (const group of groups) {
    const runId = randomUUID();
    const { error: runErr } = await supabase.from("runs").insert({
      id: runId,
      user_id: ADMIN_USER_UUID,
      kind: RUN_KINDS.CRON_NEWS_SG,
      status: "queued",
    });
    if (runErr) {
      console.error(`phase "${group.category}" run insert:`, runErr.message);
      continue;
    }

    let out = "";
    try {
      await callBrain({
        runId,
        userId: ADMIN_USER_UUID,
        provider: "claude",
        prompt: buildCategoryPrompt(group),
        onEvent: (e: BrainStreamEvent) => {
          if (e.type === "done") out = e.final;
          else if (e.type === "error")
            console.error(`phase "${group.category}" brain error:`, e.message);
        },
      });
    } catch (err) {
      console.error(`phase "${group.category}" failed:`, err);
      continue;
    }
    const trimmed = out.trim();
    if (trimmed && trimmed.toUpperCase() !== "SKIP") sections.push(trimmed);
  }

  if (sections.length === 0) {
    console.error("no phase produced output; not sending");
    return;
  }

  const header = `📰 Daily digest — ${today}`;
  let message = [header, ...sections].join("\n\n");
  if (message.length > 4000) message = message.slice(0, 3997).trimEnd() + "…";

  await sendMessage(chatId, message);

  // Dedupe by url: the same article can appear under two feeds/kinds (e.g.
  // a Liverpool story in both the LFC and general-football BBC feeds).
  // Duplicate urls in one upsert payload trip Postgres "ON CONFLICT ...
  // cannot affect row a second time".
  const seenInserts = [
    ...new Map(
      fresh.map((c) => [c.url, { url: c.url, kind: c.kind }]),
    ).values(),
  ];
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

// One category per call (phased). Output is ONLY this category's section —
// no date header, no preamble — so the cron can concatenate sections into a
// single Telegram message.
function buildCategoryPrompt(group: DigestGroup): string {
  const itemsJson = JSON.stringify(
    group.items.map((i) => ({ title: i.title, url: i.url, snippet: i.snippet })),
    null,
    2,
  );

  const lineRule =
    group.depth === "deep"
      ? `Each bullet: "• <headline> — <why it matters to a fintech/banking associate, ≤15 words>. <url>". Drop the "— …" clause entirely (just "• <headline> <url>") if the snippet gives no real basis for one — never pad or invent. Hard cap 180 characters per bullet.`
      : `Each bullet: "• <headline> <url>" — bare, no commentary. Under 120 characters.`;

  const wcRule =
    group.category === "World Cup"
      ? `\n- Include ONLY items about the 2026 FIFA World Cup (qualifiers, hosts, squads, build-up). If none qualify, output exactly: SKIP`
      : group.category === "Watch"
        ? `\n- Prefer the most recent video, and ones hosted by Simon Taylor. This is a watch-later pointer; do not summarise the video.`
        : `\n- If nothing here is genuinely worth attention, output exactly: SKIP`;

  return `You are writing ONE section of the operator's daily digest. He is ramping a client-delivery role in banking/fintech. This is a scannable signal list, NOT a briefing — terse, skimmable in seconds. He deep-dives on demand by opening the link.

Output plain text only — no markdown, no preamble, no closing. Output exactly this section and nothing else:

${group.category}
• ...

Rules:
- First line is exactly "${group.category}". Then one bullet ("• ") per selected item.
- Select at most ${group.pick} of the genuinely most useful items; fewer is better than filler; never invent items.
- Use each item's URL verbatim from the JSON. Base any clause only on the item's "snippet"; if the snippet is empty or boilerplate, give the bare headline + url.
- ${lineRule}${wcRule}

Items (JSON: [{title,url,snippet}]):
${itemsJson}`;
}

main().catch((err) => {
  console.error("news-sg failed:", err);
  process.exitCode = 1;
});

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
  kind: string;
  source: string;
  url: string;
  maxCandidates: number;
}

const FEEDS: Feed[] = [
  {
    kind: "cna",
    source: "CNA",
    url: "https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml&category=10416",
    maxCandidates: 25,
  },
  {
    kind: "mothership",
    source: "Mothership",
    url: "https://mothership.sg/feed/",
    maxCandidates: 15,
  },
];

interface CandidateItem extends RSSItem {
  kind: string;
  source: string;
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
          .map((i) => ({ ...i, kind: f.kind, source: f.source }));
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

  const hard = fresh.filter((c) => c.kind === "cna");
  const light = fresh.filter((c) => c.kind === "mothership");
  if (hard.length === 0 && light.length === 0) return;

  const today = new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "Asia/Singapore",
  }).format(new Date());

  const prompt = buildPrompt(today, hard, light);

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

function buildPrompt(
  today: string,
  hard: CandidateItem[],
  light: CandidateItem[],
): string {
  const hardJson = JSON.stringify(
    hard.map((i) => ({ title: i.title, url: i.url })),
    null,
    2,
  );
  const lightJson = JSON.stringify(
    light.map((i) => ({ title: i.title, url: i.url })),
    null,
    2,
  );

  return `You are picking Singapore reading material for today's coffee chat.

Pick exactly 3 items from "hard" and 2 items from "lighter". Output ONE plain-text Telegram message in this exact format — no markdown, no extra commentary before or after:

📰 Singapore — ${today}

Hard news
• <title> — <one short sentence on what it is or why it matters>. <url>
• ...
• ...

Lighter
• <title> — <one short sentence on what makes it interesting or shareable>. <url>
• ...

Rules:
- Use the URLs verbatim from the JSON below.
- Keep each bullet under 200 characters.
- If a section has fewer items than requested, fill what you can; do not invent items.
- Prefer items that a generally-informed Singapore resident would actually want to discuss.

Hard candidates (from CNA — policy, economy, security, civic issues):
${hardJson}

Lighter candidates (from Mothership.sg — culture, food, lifestyle, social trends):
${lightJson}`;
}

main().catch((err) => {
  console.error("news-sg failed:", err);
  process.exitCode = 1;
});

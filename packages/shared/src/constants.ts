export const BRAIN_PORT = 8080;

export const RUN_KINDS = {
  TELEGRAM_CHAT: "telegram.chat",
  MCP_PING: "mcp.ping",
  SLIDE_DECK: "slide.deck",
  CRON_NEWS_SG: "cron.news.sg",
  CRON_NEWS_DOMAIN: "cron.news.domain",
  CRON_VERSE: "cron.verse",
  CRON_SLACK_DAILY: "cron.slack.daily",
  CRON_TRADE_REVIEW: "cron.trade.review",
} as const;

export type RunKind = (typeof RUN_KINDS)[keyof typeof RUN_KINDS];

export const STREAM_HEARTBEAT_MS = 15_000;
export const TELEGRAM_EDIT_DEBOUNCE_MS = 750;
export const TELEGRAM_MESSAGE_MAX_LEN = 4096;

// Anti-pattern state tags the /trade discipline check reasons about. Kept
// here so the guided-flow toggle buttons and any prompt copy stay in sync;
// consistent spelling is what makes the WARN pattern-match across trades.
export const ANTIPATTERN_TAGS = [
  "revenge",
  "fomo",
  "averaging-down",
  "fear",
  "greed",
  "boredom",
] as const;

export type AntipatternTag = (typeof ANTIPATTERN_TAGS)[number];

// A guided /trade draft expires if untouched for this long.
export const TRADE_DRAFT_TTL_MS = 15 * 60_000;

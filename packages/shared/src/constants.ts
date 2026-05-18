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

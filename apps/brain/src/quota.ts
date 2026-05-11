import type { ClaudeRateLimitInfo } from "@aifredo/shared";

let last: ClaudeRateLimitInfo | null = null;

export function recordRateLimit(info: ClaudeRateLimitInfo): void {
  last = info;
}

export function getLastRateLimit(): ClaudeRateLimitInfo | null {
  return last;
}

export function canUseClaude(): boolean {
  if (!last) return true;
  if (last.status === "allowed") return true;
  if (last.isUsingOverage && last.overageStatus === "allowed") return true;
  if (last.resetsAt && Date.now() / 1000 > last.resetsAt) return true;
  return false;
}

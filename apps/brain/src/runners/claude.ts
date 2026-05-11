import { execa } from "execa";
import type { ClaudeStreamEvent, ClaudeRateLimitInfo } from "@aifredo/shared";

export interface ClaudeRunOptions {
  prompt: string;
  system?: string;
  sessionId?: string;
  onText: (text: string) => void;
  onRateLimit: (info: ClaudeRateLimitInfo) => void;
}

export interface ClaudeRunResult {
  text: string;
  cost_usd: number;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
  session_id: string;
}

const CLAUDE_BIN = process.env.CLAUDE_BIN ?? "claude";

export async function runClaude(opts: ClaudeRunOptions): Promise<ClaudeRunResult> {
  const args = ["-p", opts.prompt, "--output-format", "stream-json", "--verbose"];
  if (opts.sessionId) args.push("--session-id", opts.sessionId);
  if (opts.system) args.push("--system-prompt", opts.system);

  const child = execa(CLAUDE_BIN, args, {
    stdio: ["ignore", "pipe", "pipe"],
    reject: false,
  });

  if (!child.stdout) throw new Error("claude stdout unavailable");

  let buffered = "";
  let finalText = "";
  let cost = 0;
  let sessionId = opts.sessionId ?? "";
  let usage = { input_tokens: 0, output_tokens: 0 };

  const handleEvent = (event: ClaudeStreamEvent): void => {
    switch (event.type) {
      case "system":
        sessionId = event.session_id;
        break;
      case "rate_limit_event":
        opts.onRateLimit(event.rate_limit_info);
        break;
      case "assistant": {
        for (const block of event.message.content) {
          if (block.type === "text") {
            opts.onText(block.text);
            finalText += block.text;
          }
        }
        break;
      }
      case "result":
        finalText = event.result;
        cost = event.total_cost_usd ?? 0;
        usage = {
          input_tokens: event.usage.input_tokens,
          output_tokens: event.usage.output_tokens,
        };
        sessionId = event.session_id;
        break;
    }
  };

  for await (const chunk of child.stdout) {
    buffered += String(chunk);
    let nl: number;
    while ((nl = buffered.indexOf("\n")) >= 0) {
      const line = buffered.slice(0, nl).trim();
      buffered = buffered.slice(nl + 1);
      if (!line) continue;
      try {
        handleEvent(JSON.parse(line) as ClaudeStreamEvent);
      } catch {
        // Non-JSON line — claude is quiet on these, ignore.
      }
    }
  }

  const exit = await child;
  if (exit.exitCode !== 0) {
    const stderr = exit.stderr ? String(exit.stderr).slice(-500) : "";
    throw new Error(`claude exited ${exit.exitCode}: ${stderr}`);
  }

  return { text: finalText, cost_usd: cost, usage, session_id: sessionId };
}

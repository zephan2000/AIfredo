import { execa } from "execa";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CodexStreamEvent } from "@aifredo/shared";

export interface CodexRunOptions {
  prompt: string;
  scratchDir?: string;
  onText: (text: string) => void;
}

export interface CodexRunResult {
  text: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cached_input_tokens?: number;
  };
  thread_id: string;
}

const CODEX_BIN = process.env.CODEX_BIN ?? "codex";

export async function runCodex(opts: CodexRunOptions): Promise<CodexRunResult> {
  const scratch = opts.scratchDir ?? (await mkdtemp(join(tmpdir(), "aifredo-codex-")));
  const lastMessagePath = join(scratch, "last-message.txt");
  const cleanup = !opts.scratchDir;

  const args = [
    "exec",
    "--skip-git-repo-check",
    "--json",
    "--output-last-message",
    lastMessagePath,
    "-s",
    "workspace-write",
    "-C",
    scratch,
    "-",
  ];

  const child = execa(CODEX_BIN, args, {
    stdio: ["pipe", "pipe", "pipe"],
    reject: false,
    input: opts.prompt,
  });

  if (!child.stdout) throw new Error("codex stdout unavailable");

  let buffered = "";
  let threadId = "";
  let usage: CodexRunResult["usage"] = { input_tokens: 0, output_tokens: 0 };
  let finalText = "";

  const handleEvent = (event: CodexStreamEvent): void => {
    switch (event.type) {
      case "thread.started":
        threadId = event.thread_id;
        break;
      case "item.completed":
        if (event.item.type === "agent_message" && event.item.text) {
          opts.onText(event.item.text);
          finalText += event.item.text;
        }
        break;
      case "turn.completed":
        usage = event.usage;
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
        handleEvent(JSON.parse(line) as CodexStreamEvent);
      } catch {
        // ignore non-JSON
      }
    }
  }

  const exit = await child;
  if (exit.exitCode !== 0) {
    const stderr = exit.stderr ? String(exit.stderr).slice(-500) : "";
    if (cleanup) await rm(scratch, { recursive: true, force: true }).catch(() => {});
    throw new Error(`codex exited ${exit.exitCode}: ${stderr}`);
  }

  try {
    const last = await readFile(lastMessagePath, "utf8");
    if (last.trim()) finalText = last.trim();
  } catch {
    // ignore — fall back to streamed text
  }

  if (cleanup) await rm(scratch, { recursive: true, force: true }).catch(() => {});

  return { text: finalText, usage, thread_id: threadId };
}

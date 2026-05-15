import type { RunRequest, BrainStreamEvent, ProviderKind } from "@aifredo/shared";
import { runClaude } from "./runners/claude.js";
import { runCodex } from "./runners/codex.js";
import { canUseClaude, recordRateLimit } from "./quota.js";
import * as memory from "./memory.js";
import { snapshotCredsAfterRun } from "./snapshot.js";

export async function runOnce(
  req: RunRequest,
  send: (event: BrainStreamEvent) => void,
): Promise<void> {
  let provider: ProviderKind = req.provider;
  if (provider === "claude" && !canUseClaude()) {
    provider = "codex";
  }

  try {
    await memory.markRunStarted(req.run_id, provider);

    const onText = (text: string): void => {
      send({ type: "delta", run_id: req.run_id, step_idx: 0, text });
    };

    if (provider === "claude") {
      const result = await runClaude({
        prompt: req.prompt,
        system: req.system,
        resumeSessionId: req.session_id,
        onText,
        onRateLimit: (info) => {
          recordRateLimit(info);
          send({ type: "rate_limit", run_id: req.run_id, info });
        },
      });
      await memory.recordStep(req.run_id, {
        idx: 0,
        provider: "claude",
        prompt: req.prompt,
        output: result.text,
        tokens_in: result.usage.input_tokens,
        tokens_out: result.usage.output_tokens,
        cost_usd: result.cost_usd,
      });
      send({ type: "step_complete", run_id: req.run_id, step_idx: 0, output: result.text });
      send({
        type: "done",
        run_id: req.run_id,
        final: result.text,
        session_id: result.session_id || undefined,
      });
    } else {
      const result = await runCodex({
        prompt: req.prompt,
        scratchDir: req.scratch_dir,
        onText,
      });
      await memory.recordStep(req.run_id, {
        idx: 0,
        provider: "codex",
        prompt: req.prompt,
        output: result.text,
        tokens_in: result.usage.input_tokens,
        tokens_out: result.usage.output_tokens,
        cost_usd: null,
      });
      send({ type: "step_complete", run_id: req.run_id, step_idx: 0, output: result.text });
      send({ type: "done", run_id: req.run_id, final: result.text });
    }

    await memory.markRunDone(req.run_id);

    // A successful run rotated the CLI refresh token; capture it to GCS
    // before the next VM replacement can restore a spent one.
    snapshotCredsAfterRun();
  } catch (err) {
    await memory.markRunFailed(req.run_id);
    throw err;
  }
}

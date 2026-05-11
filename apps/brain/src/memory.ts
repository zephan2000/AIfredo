import { makeServiceClient } from "@aifredo/shared";
import type { ProviderKind } from "@aifredo/shared";

const supabase = makeServiceClient();

export async function markRunStarted(runId: string, _provider: ProviderKind): Promise<void> {
  const { error } = await supabase
    .from("runs")
    .update({ status: "running", started_at: new Date().toISOString() })
    .eq("id", runId);
  if (error) console.error("memory.markRunStarted", error);
}

export async function markRunDone(runId: string): Promise<void> {
  const { error } = await supabase
    .from("runs")
    .update({ status: "done", ended_at: new Date().toISOString() })
    .eq("id", runId);
  if (error) console.error("memory.markRunDone", error);
}

export async function markRunFailed(runId: string): Promise<void> {
  const { error } = await supabase
    .from("runs")
    .update({ status: "failed", ended_at: new Date().toISOString() })
    .eq("id", runId);
  if (error) console.error("memory.markRunFailed", error);
}

export interface StepRecord {
  idx: number;
  provider: ProviderKind;
  prompt: string;
  output: string;
  tokens_in: number | null;
  tokens_out: number | null;
  cost_usd: number | null;
}

export async function recordStep(runId: string, step: StepRecord): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await supabase.from("run_steps").insert({
    run_id: runId,
    idx: step.idx,
    provider: step.provider,
    status: "done",
    prompt: step.prompt,
    output: step.output,
    tokens_in: step.tokens_in,
    tokens_out: step.tokens_out,
    cost_usd: step.cost_usd,
    started_at: now,
    ended_at: now,
  });
  if (error) console.error("memory.recordStep", error);
}

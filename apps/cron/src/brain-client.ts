import { BrainStreamEventSchema } from "@aifredo/shared";
import type { BrainStreamEvent, ProviderKind } from "@aifredo/shared";

interface CallBrainArgs {
  runId: string;
  userId: string;
  provider: ProviderKind;
  prompt: string;
  onEvent: (event: BrainStreamEvent) => void | Promise<void>;
}

export async function callBrain(args: CallBrainArgs): Promise<void> {
  const url = process.env.BRAIN_URL;
  const token = process.env.BRAIN_BEARER_TOKEN;
  if (!url || !token) throw new Error("BRAIN_URL and BRAIN_BEARER_TOKEN required");

  const res = await fetch(`${url}/run`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      run_id: args.runId,
      user_id: args.userId,
      provider: args.provider,
      prompt: args.prompt,
    }),
  });
  if (!res.ok || !res.body) {
    const err = await res.text().catch(() => "");
    throw new Error(`brain /run ${res.status}: ${err}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffered += decoder.decode(value, { stream: true });

    let split: number;
    while ((split = buffered.indexOf("\n\n")) >= 0) {
      const frame = buffered.slice(0, split);
      buffered = buffered.slice(split + 2);
      const dataLines = frame
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trim());
      if (dataLines.length === 0) continue;
      try {
        const json = JSON.parse(dataLines.join("\n"));
        const parsed = BrainStreamEventSchema.safeParse(json);
        if (parsed.success) await args.onEvent(parsed.data);
      } catch {
        // ignore non-JSON frames
      }
    }
  }
}

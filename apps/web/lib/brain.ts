import { BrainStreamEventSchema } from "@aifredo/shared";
import type { BrainStreamEvent, ProviderKind } from "@aifredo/shared";

interface CallBrainArgs {
  run_id: string;
  user_id: string;
  provider: ProviderKind;
  prompt: string;
  system?: string;
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
      run_id: args.run_id,
      user_id: args.user_id,
      provider: args.provider,
      prompt: args.prompt,
      system: args.system,
    }),
  });
  if (!res.ok || !res.body) {
    const errText = await res.text().catch(() => "");
    throw new Error(`brain /run ${res.status}: ${errText}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";

  while (true) {
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
        // ignore non-JSON
      }
    }
  }
}

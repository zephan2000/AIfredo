import { z } from "zod";

export const RunStatusSchema = z.enum(["queued", "running", "done", "failed", "cancelled"]);
export const MessageChannelSchema = z.enum(["telegram", "web", "mcp"]);
export const MessageRoleSchema = z.enum(["user", "assistant", "system"]);
export const ProviderKindSchema = z.enum(["claude", "codex"]);

export const RunRequestSchema = z.object({
  run_id: z.string().uuid(),
  user_id: z.string().uuid(),
  provider: ProviderKindSchema,
  prompt: z.string().min(1),
  system: z.string().optional(),
  scratch_dir: z.string().optional(),
  external_message_id: z.string().optional(),
  external_chat_id: z.string().optional(),
  // When set, the brain calls `claude --resume <id>` to continue a thread.
  // Omit for one-shot runs (cron jobs, MCP tool calls).
  session_id: z.string().uuid().optional(),
});

export type RunRequest = z.infer<typeof RunRequestSchema>;

export const TelegramUpdateSchema = z.object({
  update_id: z.number(),
  message: z
    .object({
      message_id: z.number(),
      from: z.object({
        id: z.number(),
        username: z.string().optional(),
        first_name: z.string().optional(),
        is_bot: z.boolean().optional(),
      }),
      chat: z.object({ id: z.number(), type: z.string() }),
      text: z.string().optional(),
      date: z.number(),
    })
    .optional(),
});

export type TelegramUpdate = z.infer<typeof TelegramUpdateSchema>;

export const BrainStreamEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("delta"),
    run_id: z.string(),
    step_idx: z.number(),
    text: z.string(),
  }),
  z.object({
    type: z.literal("step_complete"),
    run_id: z.string(),
    step_idx: z.number(),
    output: z.string(),
  }),
  z.object({
    type: z.literal("rate_limit"),
    run_id: z.string(),
    info: z
      .object({
        status: z.string(),
        resetsAt: z.number(),
        rateLimitType: z.string(),
      })
      .passthrough(),
  }),
  z.object({
    type: z.literal("done"),
    run_id: z.string(),
    final: z.string(),
    // The Claude session_id this run was attached to. Web layer persists it
    // in chat_sessions so the next turn can resume the same thread.
    session_id: z.string().uuid().optional(),
  }),
  z.object({ type: z.literal("error"), run_id: z.string(), message: z.string() }),
]);

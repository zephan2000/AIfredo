export type RunStatus = "queued" | "running" | "done" | "failed" | "cancelled";
export type MessageChannel = "telegram" | "web" | "mcp";
export type MessageRole = "user" | "assistant" | "system";
export type ProviderKind = "claude" | "codex";

export interface User {
  id: string;
  clerk_id: string | null;
  display_name: string | null;
  created_at: string;
}

export interface TelegramLink {
  telegram_user_id: number;
  user_id: string;
  chat_id: number;
  registered_at: string;
}

export interface Run {
  id: string;
  user_id: string;
  kind: string;
  status: RunStatus;
  started_at: string;
  ended_at: string | null;
  source_doc_path: string | null;
  parent_step_id: string | null;
  metadata: Record<string, unknown>;
}

export interface RunStep {
  id: string;
  run_id: string;
  idx: number;
  provider: ProviderKind;
  status: RunStatus;
  started_at: string | null;
  ended_at: string | null;
  prompt: string | null;
  output: string | null;
  tokens_in: number | null;
  tokens_out: number | null;
  cost_usd: number | null;
  rate_limit_info: ClaudeRateLimitInfo | null;
  metadata: Record<string, unknown>;
}

export interface Message {
  id: string;
  user_id: string;
  channel: MessageChannel;
  external_message_id: string | null;
  external_chat_id: string | null;
  run_id: string | null;
  role: MessageRole;
  content: string;
  created_at: string;
}

// --- CLI stream event types ---

export interface ClaudeRateLimitInfo {
  status: "allowed" | "warning" | "exhausted" | string;
  resetsAt: number;
  rateLimitType: "five_hour" | "weekly" | string;
  overageStatus?: "allowed" | "exhausted" | string;
  overageResetsAt?: number;
  isUsingOverage?: boolean;
}

export type ClaudeStreamEvent =
  | { type: "system"; subtype: "init"; session_id: string; model: string }
  | { type: "rate_limit_event"; rate_limit_info: ClaudeRateLimitInfo; session_id: string }
  | {
      type: "assistant";
      message: { content: Array<{ type: "text"; text: string }>; usage?: unknown };
      session_id: string;
    }
  | {
      type: "result";
      subtype: string;
      is_error: boolean;
      result: string;
      total_cost_usd: number;
      session_id: string;
      usage: {
        input_tokens: number;
        output_tokens: number;
        cache_read_input_tokens?: number;
        cache_creation_input_tokens?: number;
      };
    };

export type CodexStreamEvent =
  | { type: "thread.started"; thread_id: string }
  | { type: "turn.started" }
  | { type: "item.completed"; item: { id: string; type: string; text?: string } }
  | {
      type: "turn.completed";
      usage: {
        input_tokens: number;
        cached_input_tokens?: number;
        output_tokens: number;
        reasoning_output_tokens?: number;
      };
    };

// --- Brain → web SSE event union ---

export type BrainStreamEvent =
  | { type: "delta"; run_id: string; step_idx: number; text: string }
  | { type: "step_complete"; run_id: string; step_idx: number; output: string }
  | { type: "rate_limit"; run_id: string; info: ClaudeRateLimitInfo }
  | { type: "done"; run_id: string; final: string; session_id?: string }
  | { type: "error"; run_id: string; message: string };

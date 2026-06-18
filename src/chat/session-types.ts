/**
 * Standalone types extracted from session.ts so modules with stricter import
 * boundaries (e.g. the projects store) can consume them without dragging in
 * the full ChatSession class — which transitively imports pptxgenjs.
 */
export type TranscriptEntry =
  | { kind: 'user'; id: string; text: string; images?: string[]; documents?: string[] }
  | { kind: 'assistant'; id: string; text: string; streaming: boolean }
  | { kind: 'tool'; id: string; tool: string; status: 'start' | 'done' | 'error'; detail?: string }
  | { kind: 'system'; id: string; text: string }
  | { kind: 'preview'; id: string; slideId: string; pngPath: string; pass: number }
  | { kind: 'context'; id: string; usage: ContextUsage; model: string };

/**
 * A snapshot of the GitHub Copilot context window, mirrored from the SDK's
 * `session.usage_info` event. `null` until the first one arrives (Copilot emits
 * it after the first turn). Optional fields are the server's own breakdown.
 */
export type ContextSnapshot = {
  /** Tokens currently occupying the context window. */
  currentTokens: number;
  /** The model's maximum context window, in tokens. */
  tokenLimit: number;
  /** Tokens from user/assistant/tool messages (excludes the system prompt). */
  conversationTokens?: number;
  /** Tokens from the system prompt. */
  systemTokens?: number;
  /** Tokens spent on tool definitions. */
  toolDefinitionsTokens?: number;
  /** Number of messages currently in the conversation. */
  messagesLength: number;
};

/** Cumulative LLM API-call usage for this session, summed from `assistant.usage`. */
export type UsageTotals = {
  apiCalls: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
};

/** The most recent single `assistant.usage` API call. */
export type UsageLast = {
  model: string;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  durationMs?: number;
} | null;

/** Everything the UI needs to render the context indicator and `/context` report. */
export type ContextUsage = {
  context: ContextSnapshot | null;
  totals: UsageTotals;
  last: UsageLast;
};

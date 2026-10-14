// Provider-agnostic AI contract (§191–200).
// Business logic depends on these types only — never on a specific vendor.

export type Role = "system" | "user" | "assistant";

export type Message = {
  role: Role;
  content: string;
};

/** Capability profiles instead of hardcoded model names (§194). */
export type Capability = "fast" | "strong" | "coding" | "reasoning";

export type ChatOptions = {
  temperature?: number;
  maxTokens?: number;
  /** Request structured JSON output (provider best-effort via response_format). */
  json?: boolean;
  signal?: AbortSignal;
  /**
   * Ask a reasoning model to skip its hidden chain-of-thought. Latency for
   * small structured tasks drops several-fold with no loss of output quality.
   */
  disableThinking?: boolean;
};

export type Usage = {
  promptTokens: number;
  completionTokens: number;
  reasoningTokens: number;
};

export type LLMResponse = {
  content: string;
  reasoning?: string;
  model: string;
  usage?: Usage;
};

export interface ProviderAdapter {
  readonly id: string;
  /** Run a single completion. Throws ProviderError on failure. */
  complete(messages: Message[], opts?: ChatOptions): Promise<LLMResponse>;
}

export class ProviderError extends Error {
  status?: number;
  retryable: boolean;
  constructor(message: string, opts?: { status?: number; retryable?: boolean }) {
    super(message);
    this.name = "ProviderError";
    this.status = opts?.status;
    this.retryable = opts?.retryable ?? true;
  }
}

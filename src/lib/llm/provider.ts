import type { ChatOptions, Message, ProviderAdapter, LLMResponse } from "./types";
import { ProviderError } from "./types";

/**
 * OpenAI-compatible adapter. Works with llm.azati.ai, OpenAI, vLLM, LiteLLM
 * and any gateway exposing `/chat/completions`. Provider-specific details
 * (base URL, key, model names, reasoning field) stay inside this adapter.
 */
export class OpenAICompatibleProvider implements ProviderAdapter {
  readonly id = "openai-compatible";

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly defaultModel: string,
  ) {}

  async complete(messages: Message[], opts: ChatOptions = {}): Promise<LLMResponse> {
    const url = `${this.baseUrl.replace(/\/$/, "")}/chat/completions`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120_000);
    const signal = opts.signal ?? controller.signal;

    const body: Record<string, unknown> = {
      model: this.defaultModel,
      messages,
      temperature: opts.temperature ?? 0.4,
      max_tokens: opts.maxTokens ?? 4096,
    };
    if (opts.json) body.response_format = { type: "json_object" };

    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal,
      });
    } catch (e) {
      clearTimeout(timeout);
      const aborted = (e as Error)?.name === "AbortError";
      throw new ProviderError(aborted ? "AI request timed out" : `AI request failed: ${(e as Error).message}`, {
        retryable: true,
      });
    }
    clearTimeout(timeout);

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const retryable = res.status === 429 || res.status >= 500;
      throw new ProviderError(`AI provider error ${res.status}: ${text.slice(0, 400)}`, {
        status: res.status,
        retryable,
      });
    }

    const data = (await res.json()) as {
      model?: string;
      choices?: {
        message?: {
          content?: string | null;
          reasoning_content?: string | null;
        };
      }[];
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        completion_tokens_details?: { reasoning_tokens?: number };
      };
    };

    const choice = data.choices?.[0]?.message;
    const content = choice?.content ?? "";
    if (!content && !choice?.reasoning_content) {
      throw new ProviderError("AI returned an empty response", { retryable: true });
    }

    return {
      content,
      reasoning: choice?.reasoning_content ?? undefined,
      model: data.model ?? this.defaultModel,
      usage: data.usage
        ? {
            promptTokens: data.usage.prompt_tokens ?? 0,
            completionTokens: data.usage.completion_tokens ?? 0,
            reasoningTokens: data.usage.completion_tokens_details?.reasoning_tokens ?? 0,
          }
        : undefined,
    };
  }
}

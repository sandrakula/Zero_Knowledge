import { OpenAICompatibleProvider } from "./provider";
import type { Capability, Message, ChatOptions, ProviderAdapter, LLMResponse } from "./types";
import { ProviderError } from "./types";

/**
 * Model router: maps a capability profile to a concrete adapter + model
 * from environment configuration (§194–199). Swapping providers or models
 * never touches educational business logic.
 */
export type RoutedProvider = {
  adapter: ProviderAdapter;
  model: string;
  baseUrl: string;
};

function resolveModel(capability: Capability): string {
  const map: Record<Capability, string> = {
    fast: process.env.LLM_MODEL_FAST ?? "",
    strong: process.env.LLM_MODEL_STRONG ?? "",
    coding: process.env.LLM_MODEL_CODING ?? "",
    reasoning: process.env.LLM_MODEL_STRONG ?? "",
  };
  return map[capability] || process.env.LLM_MODEL_FAST || process.env.LLM_MODEL_STRONG || "deepseek-v4-flash";
}

let cache: Map<Capability, RoutedProvider> | null = null;

export function route(capability: Capability = "strong"): RoutedProvider {
  if (!cache) cache = new Map();
  const hit = cache.get(capability);
  if (hit) return hit;

  const baseUrl = process.env.LLM_BASE_URL ?? "https://llm.azati.ai/v1";
  const apiKey = process.env.LLM_API_KEY ?? "";
  const model = resolveModel(capability);

  const adapter = new OpenAICompatibleProvider(baseUrl, apiKey, model);
  const routed = { adapter, model, baseUrl };
  cache.set(capability, routed);
  return routed;
}

let attempts = 0;
export function resetRouter() {
  cache = null;
  attempts = 0;
}

export async function complete(
  capability: Capability,
  messages: Message[],
  opts?: ChatOptions,
): Promise<LLMResponse> {
  const { adapter } = route(capability);
  const maxRetries = 3;
  let lastErr: ProviderError | null = null;
  for (let i = 0; i <= maxRetries; i++) {
    try {
      attempts++;
      return await adapter.complete(messages, opts);
    } catch (e) {
      lastErr = e instanceof ProviderError ? e : new ProviderError(String(e));
      if (!lastErr.retryable || i === maxRetries) throw lastErr;
      // simple backoff before retrying rate-limit / 5xx / timeouts / empty content
      await new Promise((r) => setTimeout(r, 800 * (i + 1)));
    }
  }
  throw lastErr ?? new ProviderError("AI unavailable");
}

export function isConfigured(): boolean {
  return Boolean(process.env.LLM_API_KEY);
}

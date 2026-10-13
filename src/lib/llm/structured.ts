import type { ZodType, ZodTypeDef } from "zod";
import { complete } from "./router";
import type { Capability } from "./types";
import { ProviderError } from "./types";

/**
 * Typed, schema-validated AI output (§200). Free-form model text can never
 * mutate critical state — only objects that pass a Zod schema do.
 */

/**
 * Robustly extract the outermost JSON object from a model response.
 * Handles: pure JSON, fenced JSON, leading prose, and code blocks / braces
 * inside string values (a common failure for task generation).
 */
function extractJsonObject(raw: string): string {
  let s = raw.trim();

  // Strip a *single* outer ```json fence only when the whole body is fenced.
  const fenced = s.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/);
  if (fenced) s = fenced[1].trim();

  // Otherwise, find the first `{` and scan to its balanced matching `}`,
  // respecting strings and escapes so braces inside code never mislead us.
  const start = s.indexOf("{");
  if (start === -1) return s;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return s.slice(start);
}

export async function generateObject<T>(
  schema: ZodType<T, ZodTypeDef, unknown>,
  capability: Capability,
  system: string,
  user: string,
  opts?: { temperature?: number; maxTokens?: number },
): Promise<T> {
  const res = await complete(
    capability,
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    { temperature: opts?.temperature ?? 0.3, maxTokens: opts?.maxTokens ?? 8192, json: true },
  );

  const text = extractJsonObject(res.content);

  try {
    const parsed = JSON.parse(text);
    return schema.parse(parsed);
  } catch (e) {
    const snippet = text.slice(0, 400).replace(/\n/g, " ");
    throw new ProviderError(
      `Structured output failed validation: ${(e as Error).message} — snippet: ${snippet}`,
      { retryable: false },
    );
  }
}

export async function generateText(
  capability: Capability,
  system: string,
  user: string,
  opts?: { temperature?: number; maxTokens?: number },
): Promise<string> {
  const res = await complete(
    capability,
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    { temperature: opts?.temperature ?? 0.5, maxTokens: opts?.maxTokens ?? 4096 },
  );
  return res.content.trim();
}

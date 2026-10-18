import Anthropic from "@anthropic-ai/sdk";
import type { Env } from "./env";

export const DEFAULT_MODEL = "claude-opus-5-5";

// Models whose requests accept server-side `fallbacks: "default"`: on a policy
// decline the API re-runs the request on Anthropic's recommended substitute.
const SERVER_FALLBACK_MODELS = new Set([
  "claude-opus-5-5",
  "claude-opus-5",
  "claude-sonnet-5-5",
  "claude-fable-5-1",
]);

export class ConfigError extends Error {}

export function modelFor(env: Env): string {
  return env.CLAUDE_MODEL?.trim() || DEFAULT_MODEL;
}

export function claudeClient(env: Env): Anthropic {
  if (!env.ANTHROPIC_API_KEY) throw new ConfigError("ANTHROPIC_API_KEY is not set");
  return new Anthropic({
    apiKey: env.ANTHROPIC_API_KEY,
    baseURL: env.ANTHROPIC_BASE_URL || undefined,
    maxRetries: 2,
  });
}

export function fallbackParams(model: string): {
  betas?: Anthropic.Beta.AnthropicBeta[];
  fallbacks?: Anthropic.Beta.Messages.BetaFallbacksParam;
} {
  return SERVER_FALLBACK_MODELS.has(model)
    ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" }
    : {};
}

// USD per million tokens: input, output, cache read, cache write (5 min TTL).
// Estimates for the dashboard only; the Anthropic Console is the bill.
const PRICES: Record<string, [number, number, number, number]> = {
  "claude-opus-5-5": [4, 20, 0.2, 5],
  "claude-sonnet-5-5": [2, 10, 0.2, 2.5],
  "claude-haiku-5-5": [0.1, 0.5, 0.01, 0.125],
  "claude-opus-5": [5, 25, 0.5, 6.25],
  "claude-opus-4-8": [5, 25, 0.5, 6.25],
};

export type UsageTotals = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  costUsd: number;
};

export const emptyUsage = (): UsageTotals => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0 });

type TokenCounts = {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
};

function add(totals: UsageTotals, u: TokenCounts, model: string) {
  const input = u.input_tokens ?? 0;
  const output = u.output_tokens ?? 0;
  const cacheRead = u.cache_read_input_tokens ?? 0;
  const cacheWrite = u.cache_creation_input_tokens ?? 0;
  const [pIn, pOut, pRead, pWrite] = PRICES[model] ?? [0, 0, 0, 0];
  totals.input += input;
  totals.output += output;
  totals.cacheRead += cacheRead;
  totals.cacheWrite += cacheWrite;
  totals.costUsd += (input * pIn + output * pOut + cacheRead * pRead + cacheWrite * pWrite) / 1e6;
}

/**
 * Adds one response's usage. With server-side fallbacks the top-level usage
 * covers only the attempt that produced the message, so per-attempt
 * `iterations` (each priced at the model that ran it) win when present.
 */
export function addUsage(totals: UsageTotals, usage: Anthropic.Beta.Messages.BetaUsage, model: string) {
  const iterations = usage.iterations ?? [];
  const attempts = iterations.filter(
    (it): it is Anthropic.Beta.Messages.BetaMessageIterationUsage | Anthropic.Beta.Messages.BetaFallbackMessageIterationUsage =>
      it.type === "message" || it.type === "fallback_message",
  );
  if (attempts.length === 0) {
    add(totals, usage, model);
    return;
  }
  for (const it of attempts) add(totals, it, it.model ?? model);
}

/**
 * Content to echo back on the next request. After a fallback, blocks the
 * declining model produced before the last `fallback` marker that are not
 * plain text (thinking, tool calls) must not be sent back.
 */
export function echoableContent(
  content: Anthropic.Beta.Messages.BetaContentBlock[],
): Anthropic.Beta.Messages.BetaContentBlockParam[] {
  const boundary = content.map((b) => b.type).lastIndexOf("fallback");
  if (boundary === -1) return content as Anthropic.Beta.Messages.BetaContentBlockParam[];
  return content.filter(
    (b, i) => i >= boundary || b.type === "text",
  ) as Anthropic.Beta.Messages.BetaContentBlockParam[];
}

export function usedFallback(content: Anthropic.Beta.Messages.BetaContentBlock[]): boolean {
  return content.some((b) => b.type === "fallback");
}

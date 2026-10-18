import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { addUsage, echoableContent, emptyUsage, fallbackParams } from "../src/claude";
import { RequestMetrics } from "../src/metrics";

type Usage = Anthropic.Beta.Messages.BetaUsage;
type Block = Anthropic.Beta.Messages.BetaContentBlock;

const usage = (u: Partial<Usage>) =>
  ({ input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, ...u }) as Usage;

describe("addUsage", () => {
  it("prices top-level usage at the request model", () => {
    const t = emptyUsage();
    addUsage(t, usage({ input_tokens: 1_000_000, output_tokens: 100_000, cache_read_input_tokens: 1_000_000 }), "claude-opus-5-5");
    expect(t.costUsd).toBeCloseTo(4 + 2 + 0.2, 6);
  });

  it("sums per-attempt iterations, each at its own model's price", () => {
    const t = emptyUsage();
    addUsage(
      t,
      usage({
        input_tokens: 999, // covers only the last attempt; must not be double counted
        iterations: [
          { type: "message", model: "claude-opus-5-5", input_tokens: 1_000_000, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
          { type: "fallback_message", model: "claude-opus-4-8", input_tokens: 1_000_000, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        ] as Usage["iterations"],
      }),
      "claude-opus-5-5",
    );
    expect(t.input).toBe(2_000_000);
    expect(t.costUsd).toBeCloseTo(4 + 5, 6);
  });
});

describe("echoableContent", () => {
  it("passes content through when there was no fallback", () => {
    const content = [{ type: "text", text: "hi", citations: null }] as Block[];
    expect(echoableContent(content)).toEqual(content);
  });

  it("drops non-text blocks from before the last fallback marker", () => {
    const content = [
      { type: "thinking", thinking: "", signature: "s" },
      { type: "text", text: "partial", citations: null },
      { type: "tool_use", id: "t1", name: "cari_wilayah", input: {} },
      { type: "fallback", from: { model: "claude-opus-5-5" }, to: { model: "claude-opus-4-8" } },
      { type: "tool_use", id: "t2", name: "cari_wilayah", input: {} },
    ] as unknown as Block[];
    expect(echoableContent(content).map((b) => b.type)).toEqual(["text", "fallback", "tool_use"]);
  });
});

describe("fallbackParams", () => {
  it("opts Opus 5.5 into server-side fallback but not Haiku 5.5", () => {
    expect(fallbackParams("claude-opus-5-5")).toEqual({ betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" });
    expect(fallbackParams("claude-haiku-5-5")).toEqual({});
  });
});

describe("RequestMetrics", () => {
  it("writes blobs and doubles in the documented column order", () => {
    const m = new RequestMetrics("chat", "ID", "CGK");
    m.model = "claude-opus-5-5";
    m.level = "kecamatan";
    m.tools.hitung_plts = 2;
    m.llmCalls = 3;
    m.usage = { input: 10, output: 20, cacheRead: 30, cacheWrite: 40, costUsd: 0.5 };
    m.fail("upstream_error", new TypeError("x"), 502);
    const p = m.toDataPoint(m.startedAt + 1234);
    expect(p.indexes).toEqual(["chat"]);
    expect(p.blobs).toEqual(["chat", "upstream_error", "claude-opus-5-5", "", "TypeError", "kecamatan", "ID", "CGK"]);
    expect(p.doubles).toEqual([502, 1234, 0, 10, 20, 30, 40, 0.5, 2, 3, 0, 2, 0]);
  });
});

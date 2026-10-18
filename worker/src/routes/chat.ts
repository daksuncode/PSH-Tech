// POST /api/chat — consultation assistant with region-data and PV-calculator
// tools, streamed to the browser as server-sent events.

import Anthropic from "@anthropic-ai/sdk";
import type { ChatRequest, StreamEvent } from "../../../shared/protocol";
import { addUsage, claudeClient, echoableContent, fallbackParams, modelFor, usedFallback } from "../claude";
import type { Env } from "../env";
import type { RequestMetrics } from "../metrics";
import { CHAT_SYSTEM } from "../prompts";
import { regionLabel } from "../regions";
import { TOOLS, TOOL_LABELS, isToolName, runTool } from "../tools";

/** Claude requests per user message (tool round trips included). */
const MAX_LLM_CALLS = 6;

type Send = (event: StreamEvent) => Promise<void>;
type BetaMessageParam = Anthropic.Beta.Messages.BetaMessageParam;

export async function runChat(env: Env, req: ChatRequest, m: RequestMetrics, send: Send): Promise<void> {
  const client = claudeClient(env);
  const model = modelFor(env);
  m.model = model;

  // The API needs the first message to come from the user; drop a leading
  // assistant greeting the UI may keep in its history.
  const firstUser = req.messages.findIndex((t) => t.role === "user");
  const messages: BetaMessageParam[] = req.messages.slice(firstUser).map((t) => ({ role: t.role, content: t.content }));

  if (req.region) {
    m.level = req.region.level;
    const label = await regionLabel(env, req.region);
    if (label) {
      // Mid-conversation system message: app context without touching the
      // cached system prompt.
      messages.push({
        role: "system",
        content: `Konteks aplikasi: pengguna sedang membuka ${label} di peta. Anggap pertanyaan merujuk ke wilayah ini bila tidak menyebut lokasi lain.`,
      });
    }
  }

  for (let call = 0; call < MAX_LLM_CALLS; call++) {
    const stream = client.beta.messages.stream({
      model,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      output_config: { effort: "medium" },
      system: [{ type: "text", text: CHAT_SYSTEM, cache_control: { type: "ephemeral" } }],
      tools: TOOLS,
      messages,
      ...fallbackParams(model),
    });

    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        m.markFirstText();
        await send({ type: "text", text: event.delta.text });
      }
    }
    // Text already reached the browser, so a failed turn is not re-issued
    // (that would duplicate it); errors propagate to the route handler.
    const message = await stream.finalMessage();
    m.llmCalls++;
    addUsage(m.usage, message.usage, model);
    m.stopReason = message.stop_reason ?? "";
    if (usedFallback(message.content)) m.fallbackUsed = true;

    // A refusal can cut a tool call off mid-input: never run that turn's tools.
    if (message.stop_reason === "refusal") {
      m.fail("refusal");
      await send({ type: "error", message: "Maaf, aku tidak bisa membantu permintaan itu." });
      return;
    }

    const content = echoableContent(message.content);
    if (message.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content });
      continue;
    }

    const toolUses = content.filter(
      (b): b is Anthropic.Beta.Messages.BetaToolUseBlockParam => b.type === "tool_use",
    );
    if (toolUses.length === 0) break;
    // A tool input cut off at max_tokens can still look valid; don't run it.
    if (message.stop_reason === "max_tokens") throw new Error("tool input truncated at max_tokens");

    messages.push({ role: "assistant", content });
    // Parallel calls are answered together in one user message.
    const results = await Promise.all(
      toolUses.map(async (tu): Promise<Anthropic.Beta.Messages.BetaToolResultBlockParam> => {
        if (isToolName(tu.name)) m.tools[tu.name]++;
        await send({ type: "tool", name: tu.name, label: isToolName(tu.name) ? TOOL_LABELS[tu.name] : tu.name });
        const out = await runTool(env, tu.name, tu.input);
        return { type: "tool_result", tool_use_id: tu.id, content: out.content, is_error: out.isError };
      }),
    );
    messages.push({ role: "user", content: results });

    if (call === MAX_LLM_CALLS - 1) {
      m.stopReason = "max_llm_calls";
      await send({ type: "text", text: "\n\n_(Dihentikan karena terlalu banyak langkah. Coba persempit pertanyaannya.)_" });
    }
  }

  await send({ type: "done", stopReason: m.stopReason || null });
}

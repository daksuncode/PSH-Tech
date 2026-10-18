// POST /api/explain — plain-language explanation of one region's numbers.

import type { ExplainRequest, StreamEvent } from "../../../shared/protocol";
import { addUsage, claudeClient, fallbackParams, modelFor, usedFallback } from "../claude";
import type { Env } from "../env";
import type { RequestMetrics } from "../metrics";
import { EXPLAIN_SYSTEM } from "../prompts";
import type { RegionSummary } from "../regions";
import { DAYS_PER_MONTH, DEFAULTS } from "../solar";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const SOURCE_LABEL = { nasa: "NASA POWER", gsa: "Global Solar Atlas", diff: "Selisih GSA − NASA" } as const;

type Send = (event: StreamEvent) => Promise<void>;

/** kWh per month from 1 kWp, computed here so the model only has to quote it. */
const kwhPerKwpMonth = (psh: number) => Math.round(psh * DEFAULTS.performanceRatio * DAYS_PER_MONTH);

export function explainPayload(region: RegionSummary, req: ExplainRequest) {
  return {
    wilayah: region,
    tampilan_peta: {
      sumber: SOURCE_LABEL[req.source],
      periode: req.period === 0 ? "rata-rata tahunan" : MONTHS[req.period - 1],
    },
    perkiraan_produksi_1_kwp_kwh_per_bulan: {
      nasa_power: kwhPerKwpMonth(region.nasa_power.psh_tahunan),
      global_solar_atlas: region.global_solar_atlas ? kwhPerKwpMonth(region.global_solar_atlas.psh_tahunan) : null,
      asumsi: `performance ratio ${DEFAULTS.performanceRatio}`,
    },
  };
}

export async function runExplain(
  env: Env,
  region: RegionSummary,
  req: ExplainRequest,
  m: RequestMetrics,
  send: Send,
): Promise<void> {
  const client = claudeClient(env);
  const model = modelFor(env);
  m.model = model;
  m.level = req.region.level;

  const stream = client.beta.messages.stream({
    model,
    max_tokens: 8000,
    thinking: { type: "adaptive" },
    output_config: { effort: "low" },
    system: [{ type: "text", text: EXPLAIN_SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: JSON.stringify(explainPayload(region, req)) }],
    ...fallbackParams(model),
  });
  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      m.markFirstText();
      await send({ type: "text", text: event.delta.text });
    }
  }
  const message = await stream.finalMessage();
  m.llmCalls++;
  addUsage(m.usage, message.usage, model);
  m.stopReason = message.stop_reason ?? "";
  if (usedFallback(message.content)) m.fallbackUsed = true;
  if (message.stop_reason === "refusal") {
    m.fail("refusal");
    await send({ type: "error", message: "Penjelasan untuk wilayah ini tidak tersedia." });
    return;
  }
  await send({ type: "done", stopReason: m.stopReason || null });
}

// POST /api/bill — read kWh usage from a photo of a PLN bill or token receipt.
// The image is only forwarded to Claude; nothing is stored.

import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { BillReading, BillRequest } from "../../../shared/protocol";
import { addUsage, claudeClient, fallbackParams, modelFor, usedFallback } from "../claude";
import type { Env } from "../env";
import type { RequestMetrics } from "../metrics";
import { BILL_SYSTEM } from "../prompts";
import { BillReadingSchema } from "../schemas";

export class UnreadableBillError extends Error {}

export async function readBill(env: Env, req: BillRequest, m: RequestMetrics): Promise<BillReading> {
  const client = claudeClient(env);
  const model = modelFor(env);
  m.model = model;

  const response = await client.beta.messages.parse({
    model,
    max_tokens: 4000,
    thinking: { type: "adaptive" },
    output_config: { effort: "low", format: betaZodOutputFormat(BillReadingSchema) },
    system: BILL_SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: req.mediaType, data: req.image } },
          { type: "text", text: "Baca dokumen listrik pada gambar ini." },
        ],
      },
    ],
    ...fallbackParams(model),
  });
  m.llmCalls++;
  addUsage(m.usage, response.usage, model);
  m.stopReason = response.stop_reason ?? "";
  if (usedFallback(response.content)) m.fallbackUsed = true;

  if (response.stop_reason === "refusal") {
    m.fail("refusal", undefined, 422);
    throw new UnreadableBillError("Gambar ini tidak bisa diproses.");
  }
  if (!response.parsed_output) {
    m.fail("upstream_error", undefined, 502);
    throw new UnreadableBillError("Isi tagihan tidak bisa dibaca. Coba foto yang lebih jelas.");
  }
  return response.parsed_output;
}

// One Workers Analytics Engine data point per API request, queried by the
// Grafana dashboard in monitoring/. Column positions are the schema: append
// new fields at the end and never reorder, or old rows change meaning.
//
//   index1   route
//   blob1    route            chat | explain | bill | health | other
//   blob2    outcome          ok | client_error | rate_limited | config_error |
//                             upstream_error | refusal | error
//   blob3    model
//   blob4    stop_reason      last Claude stop reason
//   blob5    error_type       error class name, if any
//   blob6    region_level     kabupaten | kecamatan | ""
//   blob7    country          from request.cf
//   blob8    colo             Cloudflare data centre
//   double1  http_status
//   double2  latency_ms       until the response (or stream) finished
//   double3  ttft_ms          time to first streamed text, 0 if none
//   double4  input_tokens     uncached input tokens
//   double5  output_tokens
//   double6  cache_read_tokens
//   double7  cache_write_tokens
//   double8  cost_usd         estimate from list prices
//   double9  tool_calls
//   double10 llm_calls        Claude requests made for this API request
//   double11 tool_cari_wilayah
//   double12 tool_hitung_plts
//   double13 fallback_used    1 if a server-side fallback model answered

import { type UsageTotals, emptyUsage } from "./claude";
import type { Env } from "./env";
import type { ToolName } from "./tools";

export type Route = "chat" | "explain" | "bill" | "health" | "other";
export type Outcome =
  | "ok"
  | "client_error"
  | "rate_limited"
  | "config_error"
  | "upstream_error"
  | "refusal"
  | "error";

export class RequestMetrics {
  readonly startedAt = Date.now();
  status = 200;
  outcome: Outcome = "ok";
  model = "";
  stopReason = "";
  errorType = "";
  level = "";
  firstTextAt: number | null = null;
  usage: UsageTotals = emptyUsage();
  llmCalls = 0;
  tools: Record<ToolName, number> = { cari_wilayah: 0, hitung_plts: 0 };
  fallbackUsed = false;
  private recorded = false;

  constructor(
    readonly route: Route,
    readonly country = "",
    readonly colo = "",
  ) {}

  static fromRequest(route: Route, request: Request): RequestMetrics {
    const cf = request.cf as { country?: string; colo?: string } | undefined;
    return new RequestMetrics(route, cf?.country ?? "", cf?.colo ?? "");
  }

  markFirstText() {
    this.firstTextAt ??= Date.now();
  }

  fail(outcome: Outcome, err?: unknown, status?: number) {
    this.outcome = outcome;
    if (status) this.status = status;
    if (err instanceof Error) this.errorType = err.constructor.name;
  }

  toDataPoint(now = Date.now()): AnalyticsEngineDataPoint {
    const toolCalls = Object.values(this.tools).reduce((a, b) => a + b, 0);
    return {
      indexes: [this.route],
      blobs: [
        this.route,
        this.outcome,
        this.model,
        this.stopReason,
        this.errorType,
        this.level,
        this.country,
        this.colo,
      ],
      doubles: [
        this.status,
        now - this.startedAt,
        this.firstTextAt ? this.firstTextAt - this.startedAt : 0,
        this.usage.input,
        this.usage.output,
        this.usage.cacheRead,
        this.usage.cacheWrite,
        this.usage.costUsd,
        toolCalls,
        this.llmCalls,
        this.tools.cari_wilayah,
        this.tools.hitung_plts,
        this.fallbackUsed ? 1 : 0,
      ],
    };
  }

  /** Writes the data point once; later calls are ignored. */
  record(env: Env) {
    if (this.recorded) return;
    this.recorded = true;
    const point = this.toDataPoint();
    env.METRICS?.writeDataPoint(point);
    // Same fields as a structured log line for Workers Logs / `wrangler tail`.
    const [status, latencyMs, ttftMs, input, output, cacheRead, cacheWrite, costUsd, toolCalls, llmCalls] =
      point.doubles ?? [];
    console.log(
      JSON.stringify({
        event: "api_request",
        route: this.route,
        outcome: this.outcome,
        status,
        latencyMs,
        ttftMs,
        model: this.model,
        stopReason: this.stopReason,
        errorType: this.errorType,
        tokens: { input, output, cacheRead, cacheWrite },
        costUsd: Number(costUsd?.toFixed(6)),
        toolCalls,
        llmCalls,
        fallbackUsed: this.fallbackUsed,
      }),
    );
  }
}

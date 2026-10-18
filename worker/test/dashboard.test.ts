import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RequestMetrics } from "../src/metrics";

// The Grafana dashboard queries Analytics Engine columns by position
// (blob1.., double1..); keep it in step with what the Worker writes.
const dashboard = JSON.parse(
  readFileSync(join(import.meta.dirname, "../../monitoring/grafana/dashboards/psh-api.json"), "utf8"),
);
const queries: string[] = dashboard.panels.flatMap((p: { targets?: { query: string }[] }) =>
  (p.targets ?? []).map((t) => t.query),
);

describe("Grafana dashboard", () => {
  const point = new RequestMetrics("chat").toDataPoint();

  it("only references columns the Worker writes", () => {
    expect(queries.length).toBeGreaterThan(10);
    for (const q of queries) {
      for (const [, kind, n] of q.matchAll(/\b(blob|double)(\d+)\b/g)) {
        const written = kind === "blob" ? point.blobs!.length : point.doubles!.length;
        expect(Number(n), `${kind}${n} in: ${q}`).toBeLessThanOrEqual(written);
      }
    }
  });

  it("weights every aggregate by the sample interval and filters by time", () => {
    for (const q of queries) {
      expect(q).toContain("FROM psh_api_metrics");
      expect(q).toContain("$timeFilter");
      expect(q).toContain("_sample_interval");
      expect(q).not.toMatch(/\bcount\(\)/i);
    }
  });

  it("uses the provisioned datasource everywhere", () => {
    for (const p of dashboard.panels.filter((p: { type: string }) => p.type !== "row")) {
      expect(p.datasource.uid).toBe("cf-analytics-engine");
    }
  });
});

// Cloudflare Worker: serves the built app (dist/) as static assets and the AI
// API under /api (wrangler.jsonc routes only /api/* to this code).

import { Hono, type Context, type Next } from "hono";
import { streamSSE } from "hono/streaming";
import type { StreamEvent } from "../../shared/protocol";
import { modelFor } from "./claude";
import type { Env } from "./env";
import { classifyError } from "./errors";
import { RequestMetrics, type Route } from "./metrics";
import { getRegion } from "./regions";
import { UnreadableBillError, readBill } from "./routes/bill";
import { runChat } from "./routes/chat";
import { runExplain } from "./routes/explain";
import { BillRequestSchema, ChatRequestSchema, ExplainRequestSchema, firstIssue } from "./schemas";

type Ctx = Context<{ Bindings: Env }>;

const app = new Hono<{ Bindings: Env }>();

const readJson = (c: Ctx) => c.req.json().catch(() => null);

/** 400 with metrics recorded. */
function badRequest(c: Ctx, m: RequestMetrics, message: string) {
  m.fail("client_error", undefined, 400);
  m.record(c.env);
  return c.json({ error: message }, 400);
}

/** Per-IP limit on the AI routes (binding configured in wrangler.jsonc). */
const rateLimit = (route: Route) => async (c: Ctx, next: Next) => {
  const limiter = c.env.AI_RATE_LIMITER;
  if (limiter) {
    const ip = c.req.header("cf-connecting-ip") ?? "local";
    const { success } = await limiter.limit({ key: `${route}:${ip}` });
    if (!success) {
      const m = RequestMetrics.fromRequest(route, c.req.raw);
      m.fail("rate_limited", undefined, 429);
      m.record(c.env);
      return c.json({ error: "Terlalu banyak permintaan. Coba lagi dalam satu menit." }, 429);
    }
  }
  await next();
};

/** Streams events from `run`; errors become an error event, metrics are always recorded. */
function sse(c: Ctx, m: RequestMetrics, run: (send: (e: StreamEvent) => Promise<void>) => Promise<void>) {
  return streamSSE(c, async (stream) => {
    const send = (event: StreamEvent) => stream.writeSSE({ data: JSON.stringify(event) });
    try {
      await run(send);
    } catch (err) {
      const e = classifyError(err);
      m.fail(e.outcome, err);
      console.error(JSON.stringify({ event: "api_error", route: m.route, error: String(err) }));
      await send({ type: "error", message: e.message }).catch(() => {});
    } finally {
      m.record(c.env);
    }
  });
}

app.get("/api/health", (c) => {
  const m = RequestMetrics.fromRequest("health", c.req.raw);
  m.record(c.env);
  return c.json({ ok: true, ai: Boolean(c.env.ANTHROPIC_API_KEY), model: modelFor(c.env) });
});

app.post("/api/chat", rateLimit("chat"), async (c) => {
  const m = RequestMetrics.fromRequest("chat", c.req.raw);
  const parsed = ChatRequestSchema.safeParse(await readJson(c));
  if (!parsed.success) return badRequest(c, m, firstIssue(parsed.error));
  return sse(c, m, (send) => runChat(c.env, parsed.data, m, send));
});

app.post("/api/explain", rateLimit("explain"), async (c) => {
  const m = RequestMetrics.fromRequest("explain", c.req.raw);
  const parsed = ExplainRequestSchema.safeParse(await readJson(c));
  if (!parsed.success) return badRequest(c, m, firstIssue(parsed.error));
  const region = await getRegion(c.env, parsed.data.region);
  if (!region) return badRequest(c, m, "Wilayah tidak ditemukan.");
  return sse(c, m, (send) => runExplain(c.env, region, parsed.data, m, send));
});

app.post("/api/bill", rateLimit("bill"), async (c) => {
  const m = RequestMetrics.fromRequest("bill", c.req.raw);
  const parsed = BillRequestSchema.safeParse(await readJson(c));
  if (!parsed.success) return badRequest(c, m, firstIssue(parsed.error));
  try {
    const reading = await readBill(c.env, parsed.data, m);
    return c.json({ reading });
  } catch (err) {
    if (err instanceof UnreadableBillError) return c.json({ error: err.message }, m.status as 422 | 502);
    const e = classifyError(err);
    m.fail(e.outcome, err, e.status);
    console.error(JSON.stringify({ event: "api_error", route: "bill", error: String(err) }));
    return c.json({ error: e.message }, e.status as 500 | 502 | 503);
  } finally {
    m.record(c.env);
  }
});

app.all("/api/*", (c) => {
  const m = RequestMetrics.fromRequest("other", c.req.raw);
  m.fail("client_error", undefined, 404);
  m.record(c.env);
  return c.json({ error: "Endpoint tidak ditemukan." }, 404);
});

// Only reached if routing ever sends a non-API path here.
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;

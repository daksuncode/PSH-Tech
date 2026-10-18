import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Env } from "../src/env";

const PUBLIC = join(import.meta.dirname, "../../public");

/** Env whose ASSETS binding serves public/ like the deployed Worker would. */
export function testEnv(overrides: Partial<Env> = {}): Env {
  const ASSETS = {
    async fetch(input: RequestInfo | URL) {
      const url = new URL(input instanceof Request ? input.url : String(input));
      const file = join(PUBLIC, decodeURIComponent(url.pathname));
      if (!existsSync(file)) {
        // Like not_found_handling: "single-page-application".
        return new Response("<!doctype html>", { headers: { "content-type": "text/html" } });
      }
      return new Response(readFileSync(file), { headers: { "content-type": "application/json" } });
    },
  } as unknown as Fetcher;
  return { ASSETS, ...overrides };
}

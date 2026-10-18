export interface Env {
  /** Static assets (the built app in dist/), also used to read data/index/*.json. */
  ASSETS: Fetcher;
  /** Workers Analytics Engine dataset with one data point per API request. */
  METRICS?: AnalyticsEngineDataset;
  /** Per-IP limiter for the AI endpoints. */
  AI_RATE_LIMITER?: RateLimit;
  /** Secret: `wrangler secret put ANTHROPIC_API_KEY` (or .dev.vars locally). */
  ANTHROPIC_API_KEY?: string;
  /** Only for local testing against a mock API. */
  ANTHROPIC_BASE_URL?: string;
  /** Overrides the default Claude model. */
  CLAUDE_MODEL?: string;
}

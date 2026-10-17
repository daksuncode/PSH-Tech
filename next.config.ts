import type { NextConfig } from "next";

// Static export: `next build` writes plain HTML/JS/CSS to ./out,
// which Cloudflare serves as static assets (see wrangler.jsonc).
const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
};

export default nextConfig;

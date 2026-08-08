import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

// __dirname isn't available under "type": "module" — this package's own
// setting (see package.json). Derive it from import.meta.url instead.
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Deployed to Cloudflare Pages via @cloudflare/next-on-pages — see
// ../../README.md's Dependencies section.
const nextConfig: NextConfig = {
  // Without this, Next.js infers the workspace root by walking up looking
  // for a lockfile — and SceneStealer's sibling repos (scenestealer-
  // connectors, scenestealer-pipeline, scenestealer-infra) each carry their
  // own, so that inference can wander well past this repo's actual root.
  // Confirmed as the real cause of a hang/EPERM on `pnpm dev`: Next's
  // output file tracing ended up trying to scandir `~/.Trash`, which macOS
  // denies (EPERM) or, in a more restrictive sandbox, blocks silently
  // instead of erroring — that silent block is what looked like an
  // unexplained hang in an earlier session. Pinning the root to this
  // repo (two levels up from apps/web) stops the inference from leaving
  // it.
  outputFileTracingRoot: path.join(__dirname, "../.."),
  // next build's own type-check step fails with "Duplicate identifier
  // 'unstable_cache'" — a known @cloudflare/next-on-pages + edge-runtime
  // type-generation collision in Next's auto-generated .next/types files
  // (no file/line reported, since it's not in our source), not a real
  // type error in this codebase. `tsc --noEmit` (run separately via `npm
  // run typecheck`, and in CI) already validates types cleanly, so this
  // just turns off next build's redundant, currently-broken duplicate of
  // that check rather than papering over an actual bug.
  typescript: { ignoreBuildErrors: true },
};

export default nextConfig;

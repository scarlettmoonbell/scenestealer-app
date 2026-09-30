// neon-http, not neon-serverless: every consumer of this package
// (apps/api and apps/web, both Cloudflare Workers; apps/worker, a
// disposable one-job-per-Machine Fly process) is a short-lived,
// one-request/one-job execution context with nothing to gain from a
// pooled WebSocket connection — and neon-serverless's Pool broke
// outright inside apps/web's OpenNext/Node-compat runtime ("Network
// connection lost" on every authenticated query, confirmed 2026-09-18
// by reproducing it live against the dev Worker while a standalone
// script using the plain HTTP client succeeded against the same DB).
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema.js";

export * from "./schema.js";

export function createDb(connectionString: string) {
  return drizzle(connectionString, { schema });
}

export type Database = ReturnType<typeof createDb>;

import { Hono } from "hono";

export interface Env {
  DATABASE_URL: string;
  CLERK_SECRET_KEY: string;
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  POSTIZ_API_URL: string;
  POSTIZ_API_KEY: string;
}

const app = new Hono<{ Bindings: Env }>();

app.get("/healthz", (c) => c.json({ status: "ok" }));

// Phase 2+: storage/social OAuth callbacks, Stripe webhook receiver,
// job-enqueue endpoints. See ../../README.md Status section.

export default app;

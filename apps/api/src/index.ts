import { Hono } from "hono";
import { uploads } from "./routes/uploads.js";

export interface Env {
  DATABASE_URL: string;
  CLERK_SECRET_KEY: string;
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  POSTIZ_API_URL: string;
  POSTIZ_API_KEY: string;
  R2_ACCOUNT_ID: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  R2_BUCKET_NAME: string;
}

const app = new Hono<{ Bindings: Env }>();

app.get("/healthz", (c) => c.json({ status: "ok" }));

app.route("/uploads", uploads);

// Phase 2+: storage/social OAuth callbacks, Stripe webhook receiver.
// See ../../README.md Status section.

export default app;

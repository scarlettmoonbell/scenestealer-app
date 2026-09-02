import { Hono } from "hono";
import { cors } from "hono/cors";
import { clerkMiddleware } from "@clerk/hono";
import { uploads } from "./routes/uploads.js";
import { webhooks } from "./routes/webhooks.js";
import { videos } from "./routes/videos.js";
import { clipsRoute } from "./routes/clips.js";
import { social } from "./routes/social.js";
import { templatesRoute } from "./routes/templates.js";
import type { Variables } from "./auth.js";

export interface Env {
  DATABASE_URL: string;
  CLERK_SECRET_KEY: string;
  CLERK_PUBLISHABLE_KEY: string;
  CLERK_WEBHOOK_SIGNING_SECRET: string;
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  POSTIZ_API_URL: string;
  POSTIZ_API_KEY: string;
  R2_ACCOUNT_ID: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  R2_BUCKET_NAME: string;
  WEB_ORIGIN: string;
  WORKER_URL: string;
  WORKER_SHARED_SECRET: string;
}

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.get("/healthz", (c) => c.json({ status: "ok" }));

// apps/web calls this API cross-origin (different port in dev, different
// subdomain in prod), sending the Clerk session as an Authorization
// header — the browser preflights that, so this has to run before
// anything else and needs to actually allow the Authorization header.
app.use(
  "*",
  cors({
    origin: (_origin, c) => c.env.WEB_ORIGIN,
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PATCH", "DELETE"],
  }),
);

// Attaches Clerk auth state to the context; doesn't reject unauthenticated
// requests itself (that's for routes/middleware that call requireTenant to
// decide) — see auth.ts.
app.use("*", clerkMiddleware());

app.route("/uploads", uploads);
app.route("/webhooks", webhooks);
app.route("/videos", videos);
app.route("/clips", clipsRoute);
app.route("/social", social);
app.route("/templates", templatesRoute);

// Phase 2+: publish action, Stripe webhook receiver.
// See ../../README.md Status section.

export default app;

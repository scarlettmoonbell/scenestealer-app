import { Hono } from "hono";
import { cors } from "hono/cors";
import { clerkMiddleware } from "@clerk/hono";
import { uploads } from "./routes/uploads.js";
import { webhooks } from "./routes/webhooks.js";
import { videos, runAnalyzeJob } from "./routes/videos.js";
import { clipsRoute } from "./routes/clips.js";
import { postsRoute } from "./routes/posts.js";
import { social } from "./routes/social.js";
import { templatesRoute } from "./routes/templates.js";
import { internalRoute } from "./routes/internal.js";
import { mediaRoute } from "./routes/media.js";
import type { Variables } from "./auth.js";

// The only job type so far — the discriminated `type` field leaves
// room for the other jobTypeEnum values (packages/db's schema.ts:
// ingest/transcribe/render/publish) to share this same queue later
// without a breaking message-shape change.
export interface AnalyzeJobMessage {
  type: "analyze";
  sourceVideoId: string;
}

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
  // This Worker's own public origin — needed to build the /media proxy
  // URL (see routes/media.ts, media-url.ts) that Postiz/the social
  // platforms fetch directly, unlike WEB_ORIGIN above which points at
  // the Next.js app instead.
  API_ORIGIN: string;
  // Signs/verifies /media proxy URLs (media-url.ts) — a plain R2
  // presigned URL can't work there since it's strictly bound to one
  // HTTP method (confirmed live 2026-09-08: GET-signed 403s on HEAD and
  // vice versa), but Postiz's YouTube provider needs both HEAD (to size
  // the upload) and ranged GET (to stream it) against the same URL.
  MEDIA_URL_SECRET: string;
  // Verifies the inbound completion-notify callback from a spawned
  // worker Machine (routes/internal.ts) — the only direction this
  // secret is used for now; apps/api no longer calls the worker over
  // HTTP itself (see FLY_API_TOKEN below).
  WORKER_SHARED_SECRET: string;
  JOBS_QUEUE: Queue<AnalyzeJobMessage>;
  // Dispatch, as of 2026-09-07: apps/api spawns a fresh, disposable Fly
  // Machine per analyze/render job via Fly's Machines API (see
  // fly-machines.ts) instead of calling an always-on worker app over
  // HTTP. FLY_API_TOKEN is a narrowly-scoped Fly deploy token for the
  // scenestealer-worker app specifically — a separate credential from
  // the CI-only FLY_API_TOKEN GitHub Actions secret used for `flyctl
  // deploy`, not a reuse of it. WORKER_IMAGE_REF is set automatically by
  // .github/workflows/deploy.yml's deploy-worker job after each deploy,
  // so dispatch always targets whatever image is actually live.
  FLY_API_TOKEN: string;
  WORKER_IMAGE_REF: string;
  // Optional on purpose — not provisioned everywhere yet (needs a
  // verified sending domain). routes/internal.ts skips the completion
  // email quietly when unset rather than erroring. See ROADMAP.md.
  RESEND_API_KEY?: string;
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
app.route("/posts", postsRoute);
app.route("/internal", internalRoute);
app.route("/media", mediaRoute);

// Phase 2+: publish action, Stripe webhook receiver.
// See ../../README.md Status section.

export default {
  fetch: app.fetch,
  // Runs each analyze job outside any HTTP request's own lifecycle —
  // see wrangler.toml's comment on why POST /videos/:id/analyze can't
  // just await this itself anymore. max_batch_size = 1 (wrangler.toml)
  // keeps this to one job per invocation; runAnalyzeJob already
  // catches its own failures and writes them to sourceVideos rather
  // than throwing, so every message acks regardless of outcome —
  // there's nothing here Cloudflare's own retry-on-failure behavior
  // should act on.
  async queue(batch: MessageBatch<AnalyzeJobMessage>, env: Env) {
    for (const message of batch.messages) {
      await runAnalyzeJob(env, message.body.sourceVideoId);
      message.ack();
    }
  },
} satisfies ExportedHandler<Env, AnalyzeJobMessage>;

import {
  pgTable,
  text,
  timestamp,
  uuid,
  real,
  jsonb,
  pgEnum,
  boolean,
} from "drizzle-orm/pg-core";

// --- Tenancy -----------------------------------------------------------

export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Maps 1:1 to a Clerk Organization ID — Clerk owns membership/roles UI,
  // this table is just the billing/domain-object anchor other tables hang off.
  clerkOrgId: text("clerk_org_id").notNull().unique(),
  name: text("name").notNull(),
  // Where publish-failure notifications go (Settings page) — null means
  // "no address on file yet", not "notifications off"; notifyOnPublishFailure
  // is the actual on/off switch, kept separate so toggling it back on
  // later doesn't require re-entering the address.
  notificationEmail: text("notification_email"),
  notifyOnPublishFailure: boolean("notify_on_publish_failure")
    .notNull()
    .default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// --- Storage -------------------------------------------------------------

export const storageProviderEnum = pgEnum("storage_provider", [
  "google-drive",
  "dropbox",
  "onedrive",
  "box",
  "s3",
  "azure-blob",
  "gcs",
]);

export const storageConnections = pgTable("storage_connections", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id),
  provider: storageProviderEnum("provider").notNull(),
  // OAuth-consent providers vs. credential-based object storage store
  // different shapes here — see scenestealer-connectors' StorageConfig
  // union type, which this column's contents must satisfy.
  config: jsonb("config").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// --- Social publishing -----------------------------------------------------

export const socialPlatformEnum = pgEnum("social_platform", [
  "youtube",
  "instagram",
  "facebook",
]);

export const socialConnections = pgTable("social_connections", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id),
  platform: socialPlatformEnum("platform").notNull(),
  // The Postiz-side integration ID for this tenant's connected account.
  postizIntegrationId: text("postiz_integration_id").notNull(),
  // "HH:mm" (24h), nullable — prefills the Scheduler's time field when
  // this connection is selected. Entirely our own convenience feature,
  // not synced with Postiz's own per-integration postingTimes: that
  // field lives behind Postiz's session-authenticated app API (not the
  // API-key-based public one this app otherwise uses), so exposing it
  // in our own UI isn't possible without a real Postiz user session —
  // see ROADMAP.md's "Postiz settings in our own UI" entry.
  defaultPostingTime: text("default_posting_time"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// --- Source video & clips --------------------------------------------------

// pending: uploaded, analyze never triggered. analyzing: the (currently
// synchronous — see routes/videos.ts) worker call is in flight. Tracked
// in the DB rather than only client-side state so the status survives a
// page reload/different tab while analysis is still running, and so a
// failure has somewhere to persist for display.
export const analysisStatusEnum = pgEnum("analysis_status", [
  "pending",
  "analyzing",
  "analyzed",
  "failed",
]);

export const sourceVideos = pgTable("source_videos", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id),
  // Nullable: direct uploads have no StorageConnection at all.
  storageConnectionId: uuid("storage_connection_id").references(
    () => storageConnections.id,
  ),
  r2Key: text("r2_key").notNull(),
  // Precomputed wavesurfer.js peaks (JSON: { peaks: number[]; duration:
  // number }), set by analyze alongside the other derived R2 assets.
  // Null for videos analyzed before this existed, or if extraction
  // failed (best-effort, non-fatal — see apps/worker/src/analyze.ts) —
  // either way the clip editor must not fall back to letting
  // wavesurfer.js decode the raw video itself: that's what crashed iOS
  // Safari's content process repeatedly on a 1.24GB upload (see
  // ROADMAP.md, 2026-09-06).
  waveformR2Key: text("waveform_r2_key"),
  // Read from ffprobe's own `format.duration` during analyze (see
  // apps/worker/src/metadata.ts) — was defined but never actually
  // written anywhere until the 2026-09-07 completion-reliability +
  // ETA work; null for videos analyzed before that.
  durationSec: real("duration_sec"),
  title: text("title"),
  status: analysisStatusEnum("status").notNull().default("pending"),
  analysisError: text("analysis_error"),
  // Clerk user id of whoever clicked "Analyze" — set server-side from
  // the authenticated session in POST /:id/analyze, never client-
  // supplied. Nullable for videos analyzed before this existed. Exists
  // solely to email the right person when the job finishes (see
  // apps/api/src/routes/videos.ts's completion-notify route) — Clerk
  // itself is still the only place a user's email is stored, this just
  // remembers *which* Clerk user to look it up for.
  triggeredByClerkUserId: text("triggered_by_clerk_user_id"),
  // Below: read from the uploaded file's own metadata (ffprobe) during
  // analyze, when present — most uploads won't have all of these, some
  // will have none. venueName/cityName come from reverse-geocoding
  // gpsLat/gpsLon (OpenStreetMap Nominatim, alpha-phase choice — see
  // ROADMAP.md); venueName only gets set when the coordinate resolves
  // to an actual tagged business/POI, never a raw street address.
  recordedAt: timestamp("recorded_at"),
  deviceModel: text("device_model"),
  venueName: text("venue_name"),
  cityName: text("city_name"),
  gpsLat: real("gps_lat"),
  gpsLon: real("gps_lon"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const clipStatusEnum = pgEnum("clip_status", [
  "suggested",
  "accepted",
  "rendering",
  "ready",
  "rejected",
]);

export const clips = pgTable("clips", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Nullable — a rendered clip (status "ready", a real renderedR2Key)
  // survives its source video being deleted, decoupled by setting this
  // to null rather than cascading the delete onto it (see DELETE
  // /videos/:id, 2026-09-07: users asked to be able to free up a
  // source video's storage cost without losing the promo clips they'd
  // already chosen to keep). A non-rendered clip has nothing worth
  // keeping without its source and is deleted outright instead.
  sourceVideoId: uuid("source_video_id").references(() => sourceVideos.id),
  // Ownership used to be derived entirely through sourceVideoId's own
  // join to sourceVideos.tenantId — that stopped being reliable the
  // moment sourceVideoId could be null, so this is now the real,
  // direct source of truth for who owns a clip, checked instead of
  // (not in addition to) the old join. Backfilled from that same join
  // for every clip that existed before this column did (see the
  // migration + one-off backfill this shipped with).
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id),
  startSec: real("start_sec").notNull(),
  endSec: real("end_sec").notNull(),
  status: clipStatusEnum("status").notNull().default("suggested"),
  // User-editable label — null until a tenant sets one, e.g. from the
  // Scheduling page's "Rendered clips" table. Falls back to the source
  // video's own title in the UI when unset, which stops working once a
  // clip is decoupled from a deleted source (see sourceVideoId's own
  // comment) — this is what lets a tenant give a kept clip an identity
  // of its own instead of "Untitled recording" forever. Named "title"
  // to match sourceVideos.title's own naming for the same concept.
  title: text("title"),
  // AI-suggested clips carry a score/reason from the highlight scorer;
  // manually-drawn clips leave these null.
  aiScore: real("ai_score"),
  aiReason: text("ai_reason"),
  renderedR2Key: text("rendered_r2_key"),
  // Mirrors sourceVideos.analysisError — added when render moved to a
  // dispatch-and-poll model (per-job Fly Machine, 2026-09-07), same as
  // analyze earlier. Before that, a failed render just silently reverted
  // status to "accepted" with no error message stored anywhere; the
  // synchronous HTTP response used to carry the error text directly to
  // the frontend, which no longer exists once rendering isn't awaited.
  renderError: text("render_error"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// --- Templates & posts -------------------------------------------------

export const templates = pgTable("templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id),
  name: text("name").notNull(),
  // e.g. "{{show_title}} closes {{date}} at {{venue}} — grab tickets 🎭"
  captionTemplate: text("caption_template").notNull(),
  platform: socialPlatformEnum("platform"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const postStatusEnum = pgEnum("post_status", [
  "scheduled",
  // Handed off to Postiz (a "publish now" request accepted) but not yet
  // confirmed delivered — Postiz's own Post.state starts at "QUEUE"
  // regardless of immediate-vs-scheduled, so "published" was previously
  // written the instant Postiz *accepted* the request, not once it
  // actually posted. Confirmed for real (2026-09-07): a stuck Postiz
  // orchestrator left posts in this state indefinitely with our own DB
  // still claiming "published" and no error anywhere.
  "queued",
  "published",
  "failed",
  "cancelled",
]);

export const posts = pgTable("posts", {
  id: uuid("id").primaryKey().defaultRandom(),
  clipId: uuid("clip_id").references(() => clips.id),
  sourceVideoId: uuid("source_video_id").references(() => sourceVideos.id),
  // Nullable: disconnecting an account (DELETE /social/connections/:id)
  // deletes any non-"published" post tied to it outright (queued/
  // scheduled/failed/cancelled — nothing of value survives the
  // connection going away) but nulls this column instead for a genuinely
  // "published" one, preserving real publish history rather than either
  // destroying it or leaving a dangling reference that blocks the
  // connection's own deletion. Confirmed for real (2026-09-10): this was
  // a NOT NULL FK before, and any connection with post history — success
  // or failure — could never be disconnected at all, failing with a raw
  // foreign-key-violation the UI only ever showed as a generic
  // "Failed to disconnect account".
  socialConnectionId: uuid("social_connection_id").references(
    () => socialConnections.id,
  ),
  templateId: uuid("template_id").references(() => templates.id),
  status: postStatusEnum("status").notNull().default("scheduled"),
  scheduledAt: timestamp("scheduled_at"),
  publishedAt: timestamp("published_at"),
  externalPostId: text("external_post_id"),
  error: text("error"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// --- Background jobs & billing ------------------------------------------

export const jobTypeEnum = pgEnum("job_type", [
  "ingest",
  "transcribe",
  "analyze",
  "render",
  "publish",
]);

export const jobStatusEnum = pgEnum("job_status", [
  "pending",
  "running",
  "succeeded",
  "failed",
]);

export const jobs = pgTable("jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id),
  type: jobTypeEnum("type").notNull(),
  status: jobStatusEnum("status").notNull().default("pending"),
  payload: jsonb("payload").notNull(),
  error: text("error"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  finishedAt: timestamp("finished_at"),
});

export const subscriptions = pgTable("subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id)
    .unique(),
  stripeCustomerId: text("stripe_customer_id").notNull(),
  stripeSubscriptionId: text("stripe_subscription_id"),
  plan: text("plan").notNull().default("trial"),
  currentPeriodEnd: timestamp("current_period_end"),
});

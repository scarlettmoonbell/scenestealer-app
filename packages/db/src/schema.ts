import {
  pgTable,
  text,
  timestamp,
  uuid,
  real,
  jsonb,
  pgEnum,
} from "drizzle-orm/pg-core";

// --- Tenancy -----------------------------------------------------------

export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Maps 1:1 to a Clerk Organization ID — Clerk owns membership/roles UI,
  // this table is just the billing/domain-object anchor other tables hang off.
  clerkOrgId: text("clerk_org_id").notNull().unique(),
  name: text("name").notNull(),
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
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// --- Source video & clips --------------------------------------------------

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
  durationSec: real("duration_sec"),
  title: text("title"),
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
  sourceVideoId: uuid("source_video_id")
    .notNull()
    .references(() => sourceVideos.id),
  startSec: real("start_sec").notNull(),
  endSec: real("end_sec").notNull(),
  status: clipStatusEnum("status").notNull().default("suggested"),
  // AI-suggested clips carry a score/reason from the highlight scorer;
  // manually-drawn clips leave these null.
  aiScore: real("ai_score"),
  aiReason: text("ai_reason"),
  renderedR2Key: text("rendered_r2_key"),
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
  "published",
  "failed",
]);

export const posts = pgTable("posts", {
  id: uuid("id").primaryKey().defaultRandom(),
  clipId: uuid("clip_id").references(() => clips.id),
  sourceVideoId: uuid("source_video_id").references(() => sourceVideos.id),
  socialConnectionId: uuid("social_connection_id")
    .notNull()
    .references(() => socialConnections.id),
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

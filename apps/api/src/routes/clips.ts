import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import {
  clips,
  createDb,
  posts,
  socialConnections,
  sourceVideos,
  tenants,
} from "@scenestealer/db";
import { createPresignedGetUrl, deleteR2Object } from "../r2.js";
import { signMediaUrl } from "../media-url.js";
import { requireTenant } from "../auth.js";
import { createPost } from "../postiz.js";
import { spawnWorkerMachine } from "../fly-machines.js";
import type { Env } from "../index.js";
import type { Variables } from "../auth.js";

export const clipsRoute = new Hono<{ Bindings: Env; Variables: Variables }>();

// Duration a platform will actually accept for a post — mirrors
// scenestealer-pipeline's own PLATFORM_SPECS.instagram-reels (not a
// shared import — apps/api has no dependency on that package, and this
// is the only platform-format detail it needs), which cites its
// sourcing in the parent project's PLAN.md "Platform constraints"
// section. Deliberately checked here, not at render time: confirmed
// for real (2026-09-07) that gating the *render* step on this meant a
// legitimate longer highlight couldn't be rendered at all, not even to
// look at or post to a platform this limit doesn't apply to.
// youtube/facebook aren't listed — this app only ever renders in the
// vertical Reels format, and Instagram is the only platform that
// format has a researched duration ceiling for; don't add another
// platform here without the same real research backing it.
const PLATFORM_DURATION_LIMITS_SEC: Partial<
  Record<
    (typeof socialConnections.$inferSelect)["platform"],
    { min: number; max: number }
  >
> = {
  instagram: { min: 5, max: 90 },
};

clipsRoute.use("*", requireTenant);

// clips.tenantId (not a join through sourceVideoId) is the real source
// of truth for ownership — a rendered clip can outlive its source
// video (see the schema comment), so the old join-based check would
// incorrectly report a decoupled clip as unowned/not-found.
async function getOwnedClip(
  db: ReturnType<typeof createDb>,
  tenantId: string,
  clipId: string,
) {
  const [clip] = await db
    .select()
    .from(clips)
    .where(and(eq(clips.id, clipId), eq(clips.tenantId, tenantId)))
    .limit(1);
  return clip;
}

// Lists every "ready" clip across the tenant's videos — the picker
// list for the dedicated Scheduling page, which needs to see clips
// from any video in one place rather than digging through each
// video's own clip table. organizationName is returned once, not
// per-clip, since it's the same for every row here.
clipsRoute.get("/", async (c) => {
  const tenantId = c.get("tenantId");
  const db = createDb(c.env.DATABASE_URL);

  const [tenant] = await db
    .select({ name: tenants.name })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);

  const rows = await db
    .select({
      id: clips.id,
      sourceVideoId: clips.sourceVideoId,
      title: clips.title,
      startSec: clips.startSec,
      endSec: clips.endSec,
      aiReason: clips.aiReason,
      renderedR2Key: clips.renderedR2Key,
      videoTitle: sourceVideos.title,
      recordedAt: sourceVideos.recordedAt,
      deviceModel: sourceVideos.deviceModel,
      venueName: sourceVideos.venueName,
      cityName: sourceVideos.cityName,
    })
    .from(clips)
    // Left, not inner — a rendered clip whose source video was deleted
    // to save storage still shows up here (with videoTitle etc. as
    // null), which is the whole point of decoupling it instead of
    // deleting it. Ownership is clips.tenantId directly, not derived
    // through this join, for the same reason.
    .leftJoin(sourceVideos, eq(clips.sourceVideoId, sourceVideos.id))
    .where(and(eq(clips.tenantId, tenantId), eq(clips.status, "ready")))
    .orderBy(desc(clips.createdAt));

  return c.json({
    organizationName: tenant?.name ?? "",
    clips: rows.map((row) => ({
      ...row,
      clipDurationSec: row.endSec - row.startSec,
    })),
  });
});

clipsRoute.patch("/:id", async (c) => {
  const tenantId = c.get("tenantId");
  const clipId = c.req.param("id");
  const body = await c.req.json<{
    startSec?: number;
    endSec?: number;
    status?: (typeof clips.$inferSelect)["status"];
    title?: string;
  }>();

  const db = createDb(c.env.DATABASE_URL);

  const existing = await getOwnedClip(db, tenantId, clipId);
  if (!existing) {
    return c.json({ error: "Clip not found" }, 404);
  }

  if (
    body.startSec !== undefined &&
    body.endSec !== undefined &&
    body.startSec >= body.endSec
  ) {
    return c.json({ error: "startSec must be before endSec" }, 400);
  }

  const [updated] = await db
    .update(clips)
    .set({
      ...(body.startSec !== undefined ? { startSec: body.startSec } : {}),
      ...(body.endSec !== undefined ? { endSec: body.endSec } : {}),
      ...(body.status !== undefined ? { status: body.status } : {}),
      // A blank string clears the title back to null (falls back to
      // the source video's own title, or "Untitled recording") rather
      // than storing an empty string as if it were a real title.
      ...(body.title !== undefined ? { title: body.title.trim() || null } : {}),
    })
    .where(eq(clips.id, clipId))
    .returning();

  return c.json({ clip: updated });
});

// Lets a tenant clean up a clip they've decided they don't want to
// keep — most relevantly a rendered clip that's outlived its source
// video (see schema.ts's sourceVideoId comment): retention there is
// deliberately not automatic, so this is the actual "I'm done with
// this one" action to pair with it. Same pattern as DELETE
// /videos/:id: storage first, so a failed R2 delete leaves the DB row
// intact for a retry rather than a row pointing at nothing.
clipsRoute.delete("/:id", async (c) => {
  const tenantId = c.get("tenantId");
  const clipId = c.req.param("id");
  const db = createDb(c.env.DATABASE_URL);

  const clip = await getOwnedClip(db, tenantId, clipId);
  if (!clip) {
    return c.json({ error: "Clip not found" }, 404);
  }

  if (clip.renderedR2Key) {
    await deleteR2Object(
      {
        accountId: c.env.R2_ACCOUNT_ID,
        accessKeyId: c.env.R2_ACCESS_KEY_ID,
        secretAccessKey: c.env.R2_SECRET_ACCESS_KEY,
        bucket: c.env.R2_BUCKET_NAME,
      },
      clip.renderedR2Key,
    );
  }

  await db.transaction(async (tx) => {
    await tx
      .update(posts)
      .set({ clipId: null })
      .where(eq(posts.clipId, clipId));
    await tx.delete(clips).where(eq(clips.id, clipId));
  });

  return c.json({ deleted: true });
});

// Spawns a fresh, disposable Fly Machine to render the clip (see
// fly-machines.ts) and returns as soon as it's dispatched — same
// dispatch-and-poll shape as videos.ts's POST /:id/analyze, moved to
// this pattern 2026-09-07 alongside analyze (previously synchronous:
// this route awaited apps/worker's own HTTP response for the whole
// render, which was the same class of risk analyze already hit for
// real, just not yet observed on the shorter render path — see
// ROADMAP.md). The spawned Machine owns writing the clip's own final
// status directly to Postgres (render.ts, unchanged) — GET
// /:id/status below is what the frontend now polls to find out when a
// render actually finishes, the same way analyze-control.tsx already
// does for analyze.
clipsRoute.post("/:id/render", async (c) => {
  const tenantId = c.get("tenantId");
  const clipId = c.req.param("id");
  const db = createDb(c.env.DATABASE_URL);

  const clip = await getOwnedClip(db, tenantId, clipId);
  if (!clip) {
    return c.json({ error: "Clip not found" }, 404);
  }

  // Set immediately (not left to the spawned Machine) so the frontend's
  // own optimistic "Rendering…" state is backed by the real row the
  // moment this call returns, matching POST /:id/analyze's
  // status: "analyzing" write.
  await db
    .update(clips)
    .set({ status: "rendering", renderError: null })
    .where(eq(clips.id, clipId));

  // clipId doubles as the correlation key tying this dispatch to
  // render.ts's own step-level logs on the spawned Machine — same
  // pattern as videos.ts's runAnalyzeJob/analyze.ts using
  // sourceVideoId, extended here to close the same gap on the render
  // path (previously silent end-to-end; see claude-docs-conventions'
  // Logging & observability section, 2026-09-07).
  console.log(`[render] dispatching clipId=${clipId}`);
  const result = await spawnWorkerMachine(c.env, {
    JOB_TYPE: "render",
    CLIP_ID: clipId,
  });

  if (!result.ok) {
    console.log(
      `[render] Machine spawn rejected for clipId=${clipId}: status=${result.status} body=${result.body}`,
    );
    const renderError = `Failed to start render (Fly status ${result.status})`;
    await db
      .update(clips)
      .set({ status: "accepted", renderError })
      .where(eq(clips.id, clipId));
    return c.json({ error: renderError }, 502);
  }
  console.log(`[render] Machine spawned for clipId=${clipId}`);

  const [updated] = await db
    .select()
    .from(clips)
    .where(eq(clips.id, clipId))
    .limit(1);
  return c.json({ clip: updated });
});

// Lightweight status check the clip editor polls while a render is in
// flight — same role as videos.ts's GET /:id/status for analyze.
clipsRoute.get("/:id/status", async (c) => {
  const tenantId = c.get("tenantId");
  const clipId = c.req.param("id");
  const db = createDb(c.env.DATABASE_URL);

  const clip = await getOwnedClip(db, tenantId, clipId);
  if (!clip) {
    return c.json({ error: "Clip not found" }, 404);
  }

  return c.json({
    status: clip.status,
    renderError: clip.renderError,
    renderedR2Key: clip.renderedR2Key,
  });
});

// Publishes a rendered clip to a connected account via Postiz. `settings`
// is whatever the frontend's schema-driven form collected against that
// connection's real GET /integration-settings/:id requirements (e.g.
// YouTube needs title+type, confirmed for real — not hardcoded here).
clipsRoute.post("/:id/publish", async (c) => {
  const tenantId = c.get("tenantId");
  const clipId = c.req.param("id");
  const body = await c.req.json<{
    socialConnectionId: string;
    caption: string;
    templateId?: string;
    settings?: Record<string, unknown>;
    // ISO date string, must be in the future. Present -> schedules
    // instead of publishing immediately.
    scheduledFor?: string;
  }>();
  if (body.scheduledFor && new Date(body.scheduledFor) <= new Date()) {
    return c.json({ error: "scheduledFor must be in the future" }, 400);
  }

  const db = createDb(c.env.DATABASE_URL);

  const clip = await getOwnedClip(db, tenantId, clipId);
  if (!clip || clip.status !== "ready" || !clip.renderedR2Key) {
    return c.json({ error: "Clip is not ready to publish" }, 400);
  }

  const [connection] = await db
    .select()
    .from(socialConnections)
    .where(
      and(
        eq(socialConnections.id, body.socialConnectionId),
        eq(socialConnections.tenantId, tenantId),
      ),
    )
    .limit(1);
  if (!connection) {
    return c.json({ error: "Connection not found" }, 404);
  }

  const durationLimit = PLATFORM_DURATION_LIMITS_SEC[connection.platform];
  if (durationLimit) {
    const duration = clip.endSec - clip.startSec;
    if (duration < durationLimit.min || duration > durationLimit.max) {
      return c.json(
        {
          error: `${connection.platform} requires a ${durationLimit.min}-${durationLimit.max}s clip, this one is ${duration.toFixed(1)}s`,
        },
        400,
      );
    }
  }

  // Not createPresignedGetUrl: confirmed live 2026-09-08 that a plain R2
  // presigned URL is strictly bound to one HTTP method (GET-signed 403s
  // on HEAD, no Content-Length either), but Postiz's YouTube provider
  // does a HEAD to size the upload and ranged GETs to stream it against
  // the *same* URL — no single presigned URL can satisfy both. This
  // signs a URL to our own /media proxy instead, which live-signs a
  // fresh, real per-method R2 request on every call. See media-url.ts.
  const mediaUrl = await signMediaUrl(c.env, clip.renderedR2Key);

  try {
    const results = await createPost(c.env, {
      integrationId: connection.postizIntegrationId,
      platform: connection.platform,
      content: body.caption,
      mediaUrl,
      settings: body.settings ?? {},
      scheduledFor: body.scheduledFor,
    });
    // Postiz accepting this request only means it queued the post —
    // its own Post.state starts at "QUEUE" regardless of immediate vs.
    // scheduled, and actual delivery happens later, asynchronously, via
    // its own orchestrator. Writing "published" here was a real bug
    // (confirmed for real 2026-09-07): a stuck orchestrator left posts
    // that never actually reached Facebook/YouTube/Instagram permanently
    // marked "published" in our own DB with no error anywhere. A
    // "scheduled" request is genuinely scheduled the moment Postiz
    // accepts it, so that status is accurate as-is; an immediate request
    // is "queued" until GET /posts/:id/status (posts.ts) confirms real
    // delivery against Postiz's own per-post state.
    const [post] = await db
      .insert(posts)
      .values({
        clipId: clip.id,
        socialConnectionId: connection.id,
        templateId: body.templateId ?? null,
        status: body.scheduledFor ? "scheduled" : "queued",
        scheduledAt: body.scheduledFor ? new Date(body.scheduledFor) : null,
        publishedAt: null,
        externalPostId: results[0]?.postId,
      })
      .returning();
    return c.json({ post });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    const [post] = await db
      .insert(posts)
      .values({
        clipId: clip.id,
        socialConnectionId: connection.id,
        templateId: body.templateId ?? null,
        status: "failed",
        error: message,
      })
      .returning();
    return c.json({ post, error: message }, 502);
  }
});

clipsRoute.get("/:id/playback-url", async (c) => {
  const tenantId = c.get("tenantId");
  const clipId = c.req.param("id");
  const db = createDb(c.env.DATABASE_URL);

  const clip = await getOwnedClip(db, tenantId, clipId);
  if (!clip || !clip.renderedR2Key) {
    return c.json({ error: "Rendered clip not found" }, 404);
  }

  const playbackUrl = await createPresignedGetUrl(
    {
      accountId: c.env.R2_ACCOUNT_ID,
      accessKeyId: c.env.R2_ACCESS_KEY_ID,
      secretAccessKey: c.env.R2_SECRET_ACCESS_KEY,
      bucket: c.env.R2_BUCKET_NAME,
    },
    clip.renderedR2Key,
  );

  return c.json({ playbackUrl });
});

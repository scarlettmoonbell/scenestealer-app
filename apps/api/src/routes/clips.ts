import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { clips, createDb, posts, socialConnections } from "@scenestealer/db";
import { createPresignedGetUrl } from "../r2.js";
import { requireTenant } from "../auth.js";
import { createPost } from "../postiz.js";
import { getOwnedSourceVideo } from "./videos.js";
import type { Env } from "../index.js";
import type { Variables } from "../auth.js";

export const clipsRoute = new Hono<{ Bindings: Env; Variables: Variables }>();

clipsRoute.use("*", requireTenant);

// Clips don't carry tenantId themselves — ownership is checked through
// the parent source video, same as the PATCH handler below.
async function getOwnedClip(
  db: ReturnType<typeof createDb>,
  tenantId: string,
  clipId: string,
) {
  const [clip] = await db
    .select()
    .from(clips)
    .where(eq(clips.id, clipId))
    .limit(1);
  if (!clip) return undefined;
  const owningVideo = await getOwnedSourceVideo(
    db,
    tenantId,
    clip.sourceVideoId,
  );
  if (!owningVideo) return undefined;
  return clip;
}

clipsRoute.patch("/:id", async (c) => {
  const tenantId = c.get("tenantId");
  const clipId = c.req.param("id");
  const body = await c.req.json<{
    startSec?: number;
    endSec?: number;
    status?: (typeof clips.$inferSelect)["status"];
  }>();

  const db = createDb(c.env.DATABASE_URL);

  const [existing] = await db
    .select({ sourceVideoId: clips.sourceVideoId })
    .from(clips)
    .where(eq(clips.id, clipId))
    .limit(1);
  if (!existing) {
    return c.json({ error: "Clip not found" }, 404);
  }
  // Clips don't carry tenantId themselves — ownership is checked through
  // the parent source video, same as the videos routes.
  const owningVideo = await getOwnedSourceVideo(
    db,
    tenantId,
    existing.sourceVideoId,
  );
  if (!owningVideo) {
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
    })
    .where(eq(clips.id, clipId))
    .returning();

  return c.json({ clip: updated });
});

// Proxies to apps/worker's /render route — same shape as
// videos.ts's POST /:id/analyze. Synchronous for now, matching analyze.
clipsRoute.post("/:id/render", async (c) => {
  const tenantId = c.get("tenantId");
  const clipId = c.req.param("id");
  const db = createDb(c.env.DATABASE_URL);

  const clip = await getOwnedClip(db, tenantId, clipId);
  if (!clip) {
    return c.json({ error: "Clip not found" }, 404);
  }

  const workerRes = await fetch(`${c.env.WORKER_URL}/render`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${c.env.WORKER_SHARED_SECRET}`,
    },
    body: JSON.stringify({ clipId: clip.id }),
  });

  if (!workerRes.ok) {
    const body = await workerRes.json();
    return c.json(body, workerRes.status as 400 | 401 | 500);
  }

  // The worker returns { renderedR2Key }, not the full row — re-read it
  // so the response shape matches PATCH /:id's { clip }, which the
  // clip editor already knows how to fold into its local state.
  const [updated] = await db
    .select()
    .from(clips)
    .where(eq(clips.id, clip.id))
    .limit(1);
  return c.json({ clip: updated });
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
  }>();

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

  const mediaUrl = await createPresignedGetUrl(
    {
      accountId: c.env.R2_ACCOUNT_ID,
      accessKeyId: c.env.R2_ACCESS_KEY_ID,
      secretAccessKey: c.env.R2_SECRET_ACCESS_KEY,
      bucket: c.env.R2_BUCKET_NAME,
    },
    clip.renderedR2Key,
  );

  try {
    const results = await createPost(c.env, {
      integrationId: connection.postizIntegrationId,
      platform: connection.platform,
      content: body.caption,
      mediaUrl,
      settings: body.settings ?? {},
    });
    const [post] = await db
      .insert(posts)
      .values({
        clipId: clip.id,
        socialConnectionId: connection.id,
        templateId: body.templateId ?? null,
        status: "published",
        publishedAt: new Date(),
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

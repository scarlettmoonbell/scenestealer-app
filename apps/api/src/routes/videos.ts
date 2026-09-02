import { and, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { clips, createDb, posts, sourceVideos } from "@scenestealer/db";
import { createPresignedGetUrl, deleteR2Object } from "../r2.js";
import { requireTenant } from "../auth.js";
import type { Env } from "../index.js";
import type { Variables } from "../auth.js";

export const videos = new Hono<{ Bindings: Env; Variables: Variables }>();

videos.use("*", requireTenant);

// Scopes a source video to the caller's tenant — shared with routes/clips.ts,
// since clip ownership is checked through the parent source video.
export async function getOwnedSourceVideo(
  db: ReturnType<typeof createDb>,
  tenantId: string,
  sourceVideoId: string,
) {
  const [row] = await db
    .select()
    .from(sourceVideos)
    .where(
      and(
        eq(sourceVideos.id, sourceVideoId),
        eq(sourceVideos.tenantId, tenantId),
      ),
    )
    .limit(1);
  return row;
}

videos.get("/:id/playback-url", async (c) => {
  const tenantId = c.get("tenantId");
  const db = createDb(c.env.DATABASE_URL);

  const video = await getOwnedSourceVideo(db, tenantId, c.req.param("id"));
  if (!video) {
    return c.json({ error: "Source video not found" }, 404);
  }

  const playbackUrl = await createPresignedGetUrl(
    {
      accountId: c.env.R2_ACCOUNT_ID,
      accessKeyId: c.env.R2_ACCESS_KEY_ID,
      secretAccessKey: c.env.R2_SECRET_ACCESS_KEY,
      bucket: c.env.R2_BUCKET_NAME,
    },
    video.r2Key,
  );

  return c.json({ playbackUrl });
});

// Proxies to apps/worker's own /analyze route (a small always-on Fly
// app — see apps/worker/fly.toml) rather than running the pipeline
// here: this Worker can't spawn the ffmpeg/scenedetect subprocesses the
// pipeline functions need. Synchronous for now — no queue, no job
// status polling — see ROADMAP.md for the deferred Cloudflare Queue /
// Fly Machines API architecture this stands in for.
videos.post("/:id/analyze", async (c) => {
  const tenantId = c.get("tenantId");
  const db = createDb(c.env.DATABASE_URL);

  const video = await getOwnedSourceVideo(db, tenantId, c.req.param("id"));
  if (!video) {
    return c.json({ error: "Source video not found" }, 404);
  }

  const workerRes = await fetch(`${c.env.WORKER_URL}/analyze`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${c.env.WORKER_SHARED_SECRET}`,
    },
    body: JSON.stringify({ sourceVideoId: video.id }),
  });

  const body = await workerRes.json();
  return c.json(body, workerRes.status as 200 | 400 | 401 | 500);
});

// Deletes the video, every clip rendered from it, and the underlying R2
// objects. Storage first: if an R2 delete fails partway through, the DB
// rows survive and the request can just be retried, rather than leaving
// DB rows pointing at nothing. Any posts published from this video/its
// clips keep their history — clipId/sourceVideoId are nullable on
// `posts` specifically so a deleted video doesn't have to drag its
// publish record down with it.
videos.delete("/:id", async (c) => {
  const tenantId = c.get("tenantId");
  const db = createDb(c.env.DATABASE_URL);

  const video = await getOwnedSourceVideo(db, tenantId, c.req.param("id"));
  if (!video) {
    return c.json({ error: "Source video not found" }, 404);
  }

  const r2Config = {
    accountId: c.env.R2_ACCOUNT_ID,
    accessKeyId: c.env.R2_ACCESS_KEY_ID,
    secretAccessKey: c.env.R2_SECRET_ACCESS_KEY,
    bucket: c.env.R2_BUCKET_NAME,
  };

  const videoClips = await db
    .select({ id: clips.id, renderedR2Key: clips.renderedR2Key })
    .from(clips)
    .where(eq(clips.sourceVideoId, video.id));

  for (const clip of videoClips) {
    if (clip.renderedR2Key) {
      await deleteR2Object(r2Config, clip.renderedR2Key);
    }
  }
  await deleteR2Object(r2Config, video.r2Key);

  await db.transaction(async (tx) => {
    const clipIds = videoClips.map((clip) => clip.id);
    if (clipIds.length > 0) {
      await tx
        .update(posts)
        .set({ clipId: null })
        .where(inArray(posts.clipId, clipIds));
    }
    await tx
      .update(posts)
      .set({ sourceVideoId: null })
      .where(eq(posts.sourceVideoId, video.id));
    await tx.delete(clips).where(eq(clips.sourceVideoId, video.id));
    await tx.delete(sourceVideos).where(eq(sourceVideos.id, video.id));
  });

  return c.json({ deleted: true });
});

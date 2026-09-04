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
// Fly Machines API architecture this stands in for. `status` is
// written to the DB before the (potentially long) worker call, not
// just tracked client-side, so it survives a page reload/different tab
// while analysis is still running.
videos.post("/:id/analyze", async (c) => {
  const tenantId = c.get("tenantId");
  const db = createDb(c.env.DATABASE_URL);

  const video = await getOwnedSourceVideo(db, tenantId, c.req.param("id"));
  if (!video) {
    return c.json({ error: "Source video not found" }, 404);
  }
  if (video.status === "analyzing") {
    return c.json({ error: "Already analyzing" }, 400);
  }

  await db
    .update(sourceVideos)
    .set({ status: "analyzing", analysisError: null })
    .where(eq(sourceVideos.id, video.id));

  // Wrapped so status always lands on "failed" rather than getting
  // stuck on "analyzing" forever — the route above refuses a new
  // attempt while already analyzing, so an unhandled throw here (a
  // network-level fetch failure, a non-JSON response) would otherwise
  // leave the tenant with no way to retry at all.
  try {
    const workerRes = await fetch(`${c.env.WORKER_URL}/analyze`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${c.env.WORKER_SHARED_SECRET}`,
      },
      body: JSON.stringify({ sourceVideoId: video.id }),
    });

    const body = (await workerRes.json()) as { error?: string };

    await db
      .update(sourceVideos)
      .set(
        workerRes.ok
          ? { status: "analyzed" }
          : {
              status: "failed",
              analysisError: body.error ?? "Analysis failed",
            },
      )
      .where(eq(sourceVideos.id, video.id));

    return c.json(body, workerRes.status as 200 | 400 | 401 | 500);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Analysis failed";
    await db
      .update(sourceVideos)
      .set({ status: "failed", analysisError: message })
      .where(eq(sourceVideos.id, video.id));
    return c.json({ error: message }, 500);
  }
});

// Lightweight status check for the frontend to poll when a tenant
// returns to a video whose analysis is already in flight (e.g. reload,
// different tab) — avoids re-fetching the full video + clips payload
// just to check whether it's still running.
videos.get("/:id/status", async (c) => {
  const tenantId = c.get("tenantId");
  const db = createDb(c.env.DATABASE_URL);

  const video = await getOwnedSourceVideo(db, tenantId, c.req.param("id"));
  if (!video) {
    return c.json({ error: "Source video not found" }, 404);
  }

  return c.json({
    status: video.status,
    analysisError: video.analysisError,
  });
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

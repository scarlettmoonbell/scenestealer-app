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

// Presigned GET for the small precomputed waveform-peaks JSON analyze
// writes to R2 (see apps/worker/src/analyze.ts's extractWaveformPeaks) —
// separate from playback-url above because the clip editor needs to know
// whether one exists at all: `waveformUrl: null` means either this video
// predates waveform support or extraction failed, and the clip editor
// must not fall back to decoding the raw video itself for a waveform
// (that's the client-side crash this column exists to avoid — see
// schema.ts's comment on sourceVideos.waveformR2Key).
videos.get("/:id/waveform-url", async (c) => {
  const tenantId = c.get("tenantId");
  const db = createDb(c.env.DATABASE_URL);

  const video = await getOwnedSourceVideo(db, tenantId, c.req.param("id"));
  if (!video) {
    return c.json({ error: "Source video not found" }, 404);
  }
  if (!video.waveformR2Key) {
    return c.json({ waveformUrl: null });
  }

  const waveformUrl = await createPresignedGetUrl(
    {
      accountId: c.env.R2_ACCOUNT_ID,
      accessKeyId: c.env.R2_ACCESS_KEY_ID,
      secretAccessKey: c.env.R2_SECRET_ACCESS_KEY,
      bucket: c.env.R2_BUCKET_NAME,
    },
    video.waveformR2Key,
  );

  return c.json({ waveformUrl });
});

// Manually-defined clip — the clip editor's drag-selection scrubber on
// the waveform lands here, alongside the AI-suggested ones from
// runAnalyze. Starts "suggested" like those do, so it goes through the
// exact same accept/reject/render flow rather than needing a separate
// status branch anywhere downstream.
videos.post("/:id/clips", async (c) => {
  const tenantId = c.get("tenantId");
  const db = createDb(c.env.DATABASE_URL);

  const video = await getOwnedSourceVideo(db, tenantId, c.req.param("id"));
  if (!video) {
    return c.json({ error: "Source video not found" }, 404);
  }

  const body = await c.req.json<{ startSec?: number; endSec?: number }>();
  if (
    typeof body.startSec !== "number" ||
    typeof body.endSec !== "number" ||
    body.startSec < 0 ||
    body.startSec >= body.endSec
  ) {
    return c.json({ error: "Invalid clip bounds" }, 400);
  }

  const [clip] = await db
    .insert(clips)
    .values({
      sourceVideoId: video.id,
      startSec: body.startSec,
      endSec: body.endSec,
      status: "suggested",
    })
    .returning();

  return c.json({ clip });
});

// The actual Fly call + resulting status update, run from the queue
// consumer (index.ts) rather than inside POST /:id/analyze's own
// request/response cycle — that HTTP route only enqueues and returns,
// since apps/api sits behind a Cloudflare Custom Domain whose edge
// proxy times out a response at ~100s regardless of the Workers
// runtime's own execution limits, and this can run for several
// minutes on a large upload (confirmed for real 2026-09-05, a 1.24GB
// file). A Queue consumer invocation isn't behind that same edge-proxy
// path and gets a 15-minute wall-time ceiling instead. Proxies to
// apps/worker's own /analyze route (a small always-on Fly app — see
// apps/worker/fly.toml) rather than running the pipeline here: this
// Worker can't spawn the ffmpeg/scenedetect subprocesses the pipeline
// functions need.
//
// Always resolves (never throws) — every failure path writes "failed"
// to sourceVideos rather than propagating, since the caller (the queue
// consumer) has no HTTP response to report a failure through; the
// tenant finds out via the same status column /:id/status already
// polls.
export async function runAnalyzeJob(
  env: Env,
  sourceVideoId: string,
): Promise<void> {
  // Logging kept deliberately (not a temporary debug leftover): this
  // is genuinely the only visibility into what apps/worker actually
  // returned and whether the DB write landed — wrangler tail's own
  // "Queue ... - Ok" for a successful consumer invocation says nothing
  // about either, which was the whole reason a real, live discrepancy
  // (client showing a Cloudflare-flavored failure, every server-side
  // log for the same request window showing a clean success) took
  // this many rounds to actually pin down on 2026-09-05/06 — see
  // ROADMAP.md for the full writeup.
  console.log(`[runAnalyzeJob] starting for sourceVideoId=${sourceVideoId}`);
  const db = createDb(env.DATABASE_URL);
  try {
    const workerRes = await fetch(`${env.WORKER_URL}/analyze`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.WORKER_SHARED_SECRET}`,
      },
      body: JSON.stringify({ sourceVideoId }),
    });

    const rawBody = await workerRes.text();
    console.log(
      `[runAnalyzeJob] worker responded status=${workerRes.status} ok=${workerRes.ok} body=${rawBody.slice(0, 500)}`,
    );

    let body: { error?: string; skipped?: boolean } = {};
    // Tracked separately from `body` staying `{}` on a parse failure —
    // confirmed for real (2026-09-06, see ROADMAP.md) that a truncated
    // response (the worker's connection cut off mid-job, e.g. by a
    // Cloudflare Queue redelivery abandoning this very invocation) came
    // back as `workerRes.ok === true` with an empty/whitespace body:
    // JSON.parse throwing left `body.error` merely `undefined`, which
    // read identically to a genuine success and got the video marked
    // "analyzed" despite the job never actually finishing.
    let parsedOk = true;
    try {
      body = JSON.parse(rawBody) as { error?: string; skipped?: boolean };
    } catch (parseErr) {
      parsedOk = false;
      console.log(
        `[runAnalyzeJob] worker response body was not valid JSON: ${String(parseErr)}`,
      );
    }

    // The worker skips a duplicate concurrent request for a video
    // that's already being analyzed on the same machine (see analyze.ts's
    // inFlightAnalyses guard) rather than doing redundant work — the
    // run that's actually still in flight is the one responsible for
    // this video's final status, so this invocation must not touch it
    // either way (neither "analyzed" nor "failed" would be accurate).
    if (body.skipped === true) {
      console.log(
        `[runAnalyzeJob] worker skipped sourceVideoId=${sourceVideoId} (already in flight on that machine) — leaving status untouched`,
      );
      return;
    }

    // apps/worker's /analyze now always responds 200 once it commits
    // to streaming a keepalive-padded body (see server.ts) — a real
    // failure only shows up as this `error` field, not the HTTP
    // status, so that has to be checked regardless of workerRes.ok. A
    // non-JSON body (an infra-level failure before the app ever wrote
    // anything, e.g. Fly's own proxy 524ing a dead machine, or this
    // invocation's own connection to the worker being cut off) also
    // counts as failed now, not just a missing `error` field.
    const failed = !workerRes.ok || !parsedOk || body.error != null;

    const [updated] = await db
      .update(sourceVideos)
      .set(
        failed
          ? {
              status: "failed",
              analysisError:
                body.error ??
                (!parsedOk
                  ? `Worker response was truncated or malformed (worker status ${workerRes.status})`
                  : `Analysis failed (worker status ${workerRes.status})`),
            }
          : { status: "analyzed" },
      )
      .where(eq(sourceVideos.id, sourceVideoId))
      .returning({ status: sourceVideos.status });
    console.log(
      `[runAnalyzeJob] DB updated for sourceVideoId=${sourceVideoId}, new status=${updated?.status}`,
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : "Analysis failed";
    console.log(
      `[runAnalyzeJob] caught exception for sourceVideoId=${sourceVideoId}: ${message}`,
    );
    const [updated] = await db
      .update(sourceVideos)
      .set({ status: "failed", analysisError: message })
      .where(eq(sourceVideos.id, sourceVideoId))
      .returning({ status: sourceVideos.status });
    console.log(
      `[runAnalyzeJob] DB updated (catch path) for sourceVideoId=${sourceVideoId}, new status=${updated?.status}`,
    );
  }
}

// `status` is written to the DB before enqueueing, not just tracked
// client-side, so it survives a page reload/different tab while
// analysis is still running — /:id/status below is what the frontend
// polls to find out when runAnalyzeJob (above) finishes.
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

  await c.env.JOBS_QUEUE.send({ type: "analyze", sourceVideoId: video.id });

  return c.json({ status: "analyzing" });
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

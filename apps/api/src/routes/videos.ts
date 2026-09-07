import { and, desc, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { clips, createDb, jobs, posts, sourceVideos } from "@scenestealer/db";
import { createPresignedGetUrl, deleteR2Object } from "../r2.js";
import { requireTenant } from "../auth.js";
import { spawnWorkerMachine } from "../fly-machines.js";
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

// Spawns a fresh, disposable Fly Machine to run the job (see
// fly-machines.ts) and returns as soon as the Machine is *created* — run
// from the queue consumer (index.ts) rather than inside POST
// /:id/analyze's own request/response cycle, since apps/api sits behind
// a Cloudflare Custom Domain whose edge proxy times out a response at
// ~100s (confirmed for real 2026-09-05, a 1.24GB file).
//
// Deliberately does NOT wait for the job to finish, and does NOT write
// sourceVideos.status on success — analyze.ts owns writing its own final
// status directly to Postgres once it actually knows the outcome (see
// that file's own comment). This used to call an always-on worker app
// over HTTP and infer success/failure from the response, which was the
// root cause of two real incidents in turn (see ROADMAP.md,
// 2026-09-05 through 09-07): a Cloudflare Queue consumer invocation
// waiting on a job past its own ~15-minute wall-time ceiling abandoning
// the connection, and — once that was fixed by dispatching quickly
// instead — the always-on machine it was calling turning out to throttle
// hard under sustained load. Spawning a dedicated-CPU Machine per job
// fixes both: Machine-create returns in a few seconds regardless of how
// long the job itself takes, and the spawned Machine gets real,
// non-throttled CPU only while it's actually running, not 24/7.
//
// The only case this function still reports itself is a fast, structural
// dispatch failure (bad image ref, Fly outage, bad token) — that's a
// real, known-now failure this invocation is the last one able to
// record, unlike the job's real outcome, which now belongs entirely to
// analyze.ts.
export async function runAnalyzeJob(
  env: Env,
  sourceVideoId: string,
): Promise<void> {
  console.log(`[runAnalyzeJob] dispatching sourceVideoId=${sourceVideoId}`);
  const db = createDb(env.DATABASE_URL);
  try {
    const result = await spawnWorkerMachine(env, {
      JOB_TYPE: "analyze",
      SOURCE_VIDEO_ID: sourceVideoId,
    });

    if (!result.ok) {
      console.log(
        `[runAnalyzeJob] Machine spawn rejected for sourceVideoId=${sourceVideoId}: status=${result.status} body=${result.body}`,
      );
      await db
        .update(sourceVideos)
        .set({
          status: "failed",
          analysisError: `Failed to start analysis (Fly status ${result.status})`,
        })
        .where(eq(sourceVideos.id, sourceVideoId));
      return;
    }

    console.log(
      `[runAnalyzeJob] Machine spawned for sourceVideoId=${sourceVideoId}`,
    );
  } catch (e) {
    const message =
      e instanceof Error ? e.message : "Failed to dispatch analysis";
    console.log(
      `[runAnalyzeJob] caught exception dispatching sourceVideoId=${sourceVideoId}: ${message}`,
    );
    await db
      .update(sourceVideos)
      .set({ status: "failed", analysisError: message })
      .where(eq(sourceVideos.id, sourceVideoId));
  }
}

// `status` is written to the DB before enqueueing, not just tracked
// client-side, so it survives a page reload/different tab while
// analysis is still running — /:id/status below is what the frontend
// polls to find out when runAnalyzeJob (above) finishes.
videos.post("/:id/analyze", async (c) => {
  const tenantId = c.get("tenantId");
  const userId = c.get("userId");
  const db = createDb(c.env.DATABASE_URL);

  const video = await getOwnedSourceVideo(db, tenantId, c.req.param("id"));
  if (!video) {
    return c.json({ error: "Source video not found" }, 404);
  }
  if (video.status === "analyzing") {
    return c.json({ error: "Already analyzing" }, 400);
  }

  // Recorded so the completion-email step (see routes/internal.ts) knows
  // who to notify — set from the authenticated session, never trusted
  // from the client.
  await db
    .update(sourceVideos)
    .set({
      status: "analyzing",
      analysisError: null,
      triggeredByClerkUserId: userId,
    })
    .where(eq(sourceVideos.id, video.id));

  await c.env.JOBS_QUEUE.send({ type: "analyze", sourceVideoId: video.id });

  return c.json({ status: "analyzing" });
});

// Below this many real samples, an average is more likely to mislead
// than help (one unusually long or short video could otherwise drive
// the whole estimate) — better to show nothing than false precision.
const MIN_SAMPLES_FOR_ESTIMATE = 3;

// Rolling throughput estimate (seconds of real processing per second of
// video) from recently succeeded `analyze` jobs — the `jobs` table was
// defined in schema.ts but never actually used anywhere until analyze.ts
// started writing real per-run telemetry to it (2026-09-07). Returns
// null until enough real data exists to average, rather than falling
// back to a hardcoded guess: at the time this was built there was
// exactly one real timing data point for a large video, and it never
// even finished (see ROADMAP.md) — no multiplier from that would be
// trustworthy.
async function estimateSecondsPerVideoSecond(
  db: ReturnType<typeof createDb>,
): Promise<number | null> {
  const recent = await db
    .select({
      payload: jobs.payload,
      createdAt: jobs.createdAt,
      finishedAt: jobs.finishedAt,
    })
    .from(jobs)
    .where(and(eq(jobs.type, "analyze"), eq(jobs.status, "succeeded")))
    .orderBy(desc(jobs.createdAt))
    .limit(20);

  const ratios: number[] = [];
  for (const row of recent) {
    if (!row.finishedAt) continue;
    const durationSec = (row.payload as { durationSec?: number } | null)
      ?.durationSec;
    if (!durationSec || durationSec <= 0) continue;
    const wallSeconds =
      (row.finishedAt.getTime() - row.createdAt.getTime()) / 1000;
    if (wallSeconds <= 0) continue;
    ratios.push(wallSeconds / durationSec);
  }

  if (ratios.length < MIN_SAMPLES_FOR_ESTIMATE) return null;
  return ratios.reduce((a, b) => a + b, 0) / ratios.length;
}

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

  // Only worth computing once the video's own duration is known (set
  // partway through the pipeline — see analyze.ts) and while a run is
  // actually in flight; a null here just means "not enough information
  // yet" and the frontend shows a generic in-progress state instead of
  // false precision.
  let estimatedTotalSeconds: number | null = null;
  if (video.status === "analyzing" && video.durationSec != null) {
    const secondsPerVideoSecond = await estimateSecondsPerVideoSecond(db);
    if (secondsPerVideoSecond != null) {
      estimatedTotalSeconds = Math.round(
        video.durationSec * secondsPerVideoSecond,
      );
    }
  }

  return c.json({
    status: video.status,
    analysisError: video.analysisError,
    durationSec: video.durationSec,
    estimatedTotalSeconds,
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

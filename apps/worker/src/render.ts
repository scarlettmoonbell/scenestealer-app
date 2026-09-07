import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { clips, createDb, sourceVideos } from "@scenestealer/db";
import { FfmpegRenderer } from "@scenestealer/pipeline";
import { downloadFromR2ToFile, uploadToR2 } from "./r2.js";

const renderer = new FfmpegRenderer();

// clipId tags every line so it can be tied back to apps/api's own
// `[render] dispatching clipId=...` log for the same job — the render
// path had no logging at all before this (unlike analyze.ts's
// logStep), leaving nothing to correlate across the api -> Fly-worker
// boundary; see claude-docs-conventions' Logging & observability
// section, 2026-09-07. Elapsed time only, no memory stats — render
// jobs have no OOM history the way analyze's did (see ROADMAP.md), so
// RSS/heap tracking isn't warranted here.
function logStep(clipId: string, startedAt: number, step: string) {
  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(
    `[runRender] clipId=${clipId} step=${step} elapsedSec=${elapsedSec}`,
  );
}

/**
 * Accepted clip -> encoded file on R2. "instagram-reels" is the only
 * portrait render target today; "youtube-full" describes the original
 * upload's own aspect ratio, not something a clip gets rendered *into*.
 */
export async function runRender(
  clipId: string,
): Promise<{ renderedR2Key: string }> {
  const startedAt = Date.now();
  logStep(clipId, startedAt, "start");
  const db = createDb(process.env.DATABASE_URL!);

  const [clip] = await db
    .select()
    .from(clips)
    .where(eq(clips.id, clipId))
    .limit(1);
  if (!clip) {
    throw new Error(`clip ${clipId} not found`);
  }

  const [video] = await db
    .select()
    .from(sourceVideos)
    .where(eq(sourceVideos.id, clip.sourceVideoId))
    .limit(1);
  if (!video) {
    throw new Error(`source video ${clip.sourceVideoId} not found`);
  }

  const r2Config = {
    accountId: process.env.R2_ACCOUNT_ID!,
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    bucket: process.env.R2_BUCKET!,
  };

  const tmpDir = await mkdtemp(join(tmpdir(), "scenestealer-render-"));
  const sourcePath = join(tmpDir, video.r2Key.split("/").pop()!);
  const outputPath = join(tmpDir, `${clipId}.mp4`);

  try {
    await db
      .update(clips)
      .set({ status: "rendering", renderError: null })
      .where(eq(clips.id, clipId));

    await downloadFromR2ToFile(r2Config, video.r2Key, sourcePath);
    logStep(clipId, startedAt, "source-downloaded");

    await renderer.render({
      sourcePath,
      startSec: clip.startSec,
      endSec: clip.endSec,
      target: "instagram-reels",
      outputPath,
      smartReframe: false,
    });
    logStep(clipId, startedAt, "rendered");

    const renderedR2Key = `${video.tenantId}/renders/${clipId}.mp4`;
    const output = await readFile(outputPath);
    await uploadToR2(r2Config, renderedR2Key, output);
    logStep(clipId, startedAt, "uploaded");

    await db
      .update(clips)
      .set({ status: "ready", renderedR2Key })
      .where(eq(clips.id, clipId));

    logStep(clipId, startedAt, "done");
    return { renderedR2Key };
  } catch (err) {
    // renderError persisted so the frontend has something real to show
    // — before render moved to a dispatch-and-poll model (per-job Fly
    // Machine, 2026-09-07), the synchronous HTTP response carried this
    // text directly; nothing was ever stored on the row itself.
    const message = err instanceof Error ? err.message : "Render failed";
    console.error(
      `[runRender] clipId=${clipId} failed after ${((Date.now() - startedAt) / 1000).toFixed(1)}s: ${message}`,
    );
    await db
      .update(clips)
      .set({ status: "accepted", renderError: message })
      .where(eq(clips.id, clipId));
    throw err;
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

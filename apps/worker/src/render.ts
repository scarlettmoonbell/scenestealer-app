import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { clips, createDb, sourceVideos } from "@scenestealer/db";
import { FfmpegRenderer } from "@scenestealer/pipeline";
import { downloadFromR2, uploadToR2 } from "./r2.js";

const renderer = new FfmpegRenderer();

/**
 * Accepted clip -> encoded file on R2. "instagram-reels" is the only
 * portrait render target today; "youtube-full" describes the original
 * upload's own aspect ratio, not something a clip gets rendered *into*.
 */
export async function runRender(
  clipId: string,
): Promise<{ renderedR2Key: string }> {
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
      .set({ status: "rendering" })
      .where(eq(clips.id, clipId));

    const bytes = await downloadFromR2(r2Config, video.r2Key);
    await writeFile(sourcePath, Buffer.from(bytes));

    await renderer.render({
      sourcePath,
      startSec: clip.startSec,
      endSec: clip.endSec,
      target: "instagram-reels",
      outputPath,
      smartReframe: false,
    });

    const renderedR2Key = `${video.tenantId}/renders/${clipId}.mp4`;
    const output = await readFile(outputPath);
    await uploadToR2(r2Config, renderedR2Key, output);

    await db
      .update(clips)
      .set({ status: "ready", renderedR2Key })
      .where(eq(clips.id, clipId));

    return { renderedR2Key };
  } catch (err) {
    await db
      .update(clips)
      .set({ status: "accepted" })
      .where(eq(clips.id, clipId));
    throw err;
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

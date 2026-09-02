import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { and, eq } from "drizzle-orm";
import { clips, createDb, sourceVideos } from "@scenestealer/db";
import {
  ClaudeHighlightScorer,
  detectAudioEnergyEvents,
  GroqTranscriber,
  PySceneDetectDetector,
} from "@scenestealer/pipeline";
import { extractVideoMetadata, reverseGeocode } from "./metadata.js";
import { downloadFromR2 } from "./r2.js";

const execFileAsync = promisify(execFile);

/**
 * Groq's transcription endpoint rejects a full raw video file as too
 * large (confirmed for real: a 413 "Request Entity Too Large" against a
 * short phone-recorded test clip) — video containers are dominated by
 * the video track, which transcription never needs. Extracts a small,
 * compressed, mono audio-only file instead. detectAudioEnergyEvents and
 * PySceneDetectDetector both still take the original video path — no
 * size constraint there, it's all local subprocess work, not an
 * uploaded API request.
 *
 * 64kbps mono is more than sufficient for speech and keeps file size
 * trivial for anything up to a full show-length recording; not chunked
 * for anything longer than that (unhandled for now).
 */
async function extractAudio(videoPath: string, audioPath: string) {
  await execFileAsync("ffmpeg", [
    "-i",
    videoPath,
    "-vn",
    "-acodec",
    "libmp3lame",
    "-b:a",
    "64k",
    "-ac",
    "1",
    audioPath,
  ]);
}

/**
 * Ingest -> transcribe -> detect scenes -> detect audio energy -> score
 * highlights -> write suggested Clip rows — the Phase 4 pipeline
 * functions wired together for the first time, against a real video
 * rather than mocked fetch/execFile calls. See PLAN.md's "Video
 * pipeline" section (step 2, "Analyze").
 */
export async function runAnalyze(
  sourceVideoId: string,
): Promise<{ clipsCreated: number }> {
  const db = createDb(process.env.DATABASE_URL!);

  const [video] = await db
    .select()
    .from(sourceVideos)
    .where(eq(sourceVideos.id, sourceVideoId))
    .limit(1);
  if (!video) {
    throw new Error(`source video ${sourceVideoId} not found`);
  }

  const tmpDir = await mkdtemp(join(tmpdir(), "scenestealer-analyze-"));
  const videoPath = join(tmpDir, video.r2Key.split("/").pop()!);

  try {
    const bytes = await downloadFromR2(
      {
        accountId: process.env.R2_ACCOUNT_ID!,
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
        bucket: process.env.R2_BUCKET!,
      },
      video.r2Key,
    );
    await writeFile(videoPath, Buffer.from(bytes));

    // Best-effort — a video with no useful tags, or a transient
    // ffprobe/geocoding hiccup, shouldn't fail the actual analysis
    // this job exists for.
    try {
      const meta = await extractVideoMetadata(videoPath);
      const geocode =
        meta.gpsLat != null && meta.gpsLon != null
          ? await reverseGeocode(meta.gpsLat, meta.gpsLon)
          : { venue: null, city: null };
      await db
        .update(sourceVideos)
        .set({
          recordedAt: meta.recordedAt,
          deviceModel: meta.deviceModel,
          gpsLat: meta.gpsLat,
          gpsLon: meta.gpsLon,
          venueName: geocode.venue,
          cityName: geocode.city,
        })
        .where(eq(sourceVideos.id, sourceVideoId));
    } catch (e) {
      console.error("Video metadata extraction failed (non-fatal):", e);
    }

    const audioPath = join(tmpDir, "audio.mp3");
    await extractAudio(videoPath, audioPath);

    const sceneDetector = new PySceneDetectDetector();
    const transcriber = new GroqTranscriber(process.env.GROQ_API_KEY!);
    const scorer = new ClaudeHighlightScorer(process.env.ANTHROPIC_API_KEY!);

    const [scenes, transcript, audioEvents] = await Promise.all([
      sceneDetector.detectScenes(videoPath),
      transcriber.transcribe(audioPath),
      detectAudioEnergyEvents(videoPath),
    ]);

    const highlights = await scorer.scoreHighlights(
      transcript,
      audioEvents,
      scenes,
    );

    // Re-running analysis on the same video (retry after a failure, or
    // just triggered twice) shouldn't pile up duplicate suggestions —
    // confirmed for real, this created two identical clips for the same
    // ~5s window on a short test video. Only "suggested" (not yet
    // reviewed) clips are replaced; accepted/rejected/rendering/ready
    // clips reflect a real decision already made and are left alone.
    await db
      .delete(clips)
      .where(
        and(
          eq(clips.sourceVideoId, sourceVideoId),
          eq(clips.status, "suggested"),
        ),
      );

    if (highlights.length === 0) return { clipsCreated: 0 };

    const rows = highlights.map((h) => {
      const snapped = sceneDetector.snapToScenes(
        { startSec: h.startSec, endSec: h.endSec },
        scenes,
      );
      return {
        sourceVideoId,
        startSec: snapped.startSec,
        endSec: snapped.endSec,
        aiScore: h.score,
        aiReason: h.reason,
      };
    });
    await db.insert(clips).values(rows);

    return { clipsCreated: rows.length };
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

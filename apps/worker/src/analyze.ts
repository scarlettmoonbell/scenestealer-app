import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
import { downloadFromR2, uploadToR2, type R2Config } from "./r2.js";

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

const WAVEFORM_SAMPLE_RATE = 8000;
const WAVEFORM_PEAK_COUNT = 4000;

/**
 * Precomputed waveform peaks for wavesurfer.js's `peaks`/`duration`
 * options, decoded from the small mono audio file extractAudio already
 * produced above — not the original video, so this adds no extra
 * download and only a few seconds of CPU even for a long recording (one
 * more ffmpeg pass plus a single linear scan of the resulting PCM).
 *
 * This exists because the clip editor previously handed wavesurfer.js
 * the raw video directly (its `media` option, no `peaks`), so wavesurfer
 * did its own full-file fetch + decodeAudioData to compute the waveform
 * client-side. Confirmed for real (2026-09-06, a 1.24GB upload): that
 * repeatedly crashed iOS Safari's content process ("A problem repeatedly
 * occurred") — its per-tab memory ceiling is nowhere near enough to hold
 * both the raw bytes and the fully decoded PCM. Precomputing a tiny
 * peaks array server-side means the browser never touches the full file
 * for anything but ordinary <video> playback.
 *
 * If ffmpeg's raw-PCM-plus-manual-downsample approach here ever turns
 * out to be a bottleneck (e.g. a much longer recording than tested), the
 * dedicated `audiowaveform` CLI (github.com/bbc/audiowaveform, apt
 * package `audiowaveform`) is built exactly for this — it streams the
 * input once and writes a peaks JSON directly, without the intermediate
 * raw-PCM file this function writes to disk. Not needed yet; noted here
 * as the documented fallback.
 */
async function extractWaveformPeaks(
  audioPath: string,
  pcmPath: string,
): Promise<{ peaks: number[]; duration: number }> {
  await execFileAsync("ffmpeg", [
    "-i",
    audioPath,
    "-ac",
    "1",
    "-ar",
    String(WAVEFORM_SAMPLE_RATE),
    "-f",
    "s16le",
    "-acodec",
    "pcm_s16le",
    pcmPath,
  ]);

  const pcm = await readFile(pcmPath);
  const sampleCount = Math.floor(pcm.length / 2); // 16-bit samples
  const duration = sampleCount / WAVEFORM_SAMPLE_RATE;

  const bucketSize = Math.max(
    1,
    Math.floor(sampleCount / WAVEFORM_PEAK_COUNT),
  );
  const peaks: number[] = [];
  for (let start = 0; start < sampleCount; start += bucketSize) {
    const end = Math.min(start + bucketSize, sampleCount);
    let max = 0;
    for (let i = start; i < end; i++) {
      const amplitude = Math.abs(pcm.readInt16LE(i * 2)) / 32768;
      if (amplitude > max) max = amplitude;
    }
    peaks.push(max);
  }

  return { peaks, duration };
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

  const r2Config: R2Config = {
    accountId: process.env.R2_ACCOUNT_ID!,
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    bucket: process.env.R2_BUCKET!,
  };

  try {
    const bytes = await downloadFromR2(r2Config, video.r2Key);
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

    // Best-effort, same rationale as the metadata block above — a
    // waveform extraction failure shouldn't fail the analysis this job
    // exists for. The clip editor treats a null waveformR2Key as "no
    // waveform to show", never as "fall back to decoding the raw video
    // client-side" (see schema.ts's comment on this column for why).
    try {
      const pcmPath = join(tmpDir, "audio.pcm");
      const { peaks, duration } = await extractWaveformPeaks(
        audioPath,
        pcmPath,
      );
      const waveformR2Key = `${video.tenantId}/waveforms/${sourceVideoId}.json`;
      await uploadToR2(
        r2Config,
        waveformR2Key,
        new TextEncoder().encode(JSON.stringify({ peaks, duration })),
        "application/json",
      );
      await db
        .update(sourceVideos)
        .set({ waveformR2Key })
        .where(eq(sourceVideos.id, sourceVideoId));
    } catch (e) {
      console.error("Waveform peak extraction failed (non-fatal):", e);
    }

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

import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { and, eq } from "drizzle-orm";
import { clips, createDb, jobs, sourceVideos } from "@scenestealer/db";
import {
  ClaudeHighlightScorer,
  detectAudioEnergyEvents,
  GroqTranscriber,
  PySceneDetectDetector,
} from "@scenestealer/pipeline";
import { extractVideoMetadata, reverseGeocode } from "./metadata.js";
import { downloadFromR2ToFile, uploadToR2, type R2Config } from "./r2.js";

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
 * A lightweight 8-bit H.264 proxy of the source video, used only for
 * scene detection and audio-energy detection — neither needs full
 * quality/resolution, but both currently pay the full decode cost of
 * the ORIGINAL video's codec every time they run, since they take
 * `videoPath` directly. Confirmed for real (2026-09-07, see
 * ROADMAP.md): a real upload came back as 10-bit HEVC with Dolby Vision
 * (not unusual for a modern iPhone recording), which is extremely
 * expensive to software-decode with no hardware acceleration — Fly
 * Machines have none, and PySceneDetect's own CLI only exposes a plain
 * `opencv` backend (confirmed via `scenedetect --help`), so there's no
 * hardware-decode flag to flip on either. Scene detection alone ran for
 * over an hour on a 17-minute recording before this existed.
 *
 * Transcoding once to a cheap, easy-to-decode proxy and pointing both
 * of those tools at it instead cuts their *combined* decode cost far
 * more than tuning either tool's own options would, since it fixes the
 * actual bottleneck (decode) once rather than working around it twice.
 * `-c:v libx264` matches render.ts's own FfmpegRenderer, which already
 * proves this exact ffmpeg build supports it in production. Downscaled
 * to 480p height — motion/cut/energy detection doesn't need more, and
 * a smaller frame is itself cheaper to decode on top of the codec
 * switch. No audio track (`-an`): extractAudio already produced a
 * separate audio file this doesn't need to duplicate. The original
 * videoPath is untouched — waveform peaks, final clip renders, and
 * playback all still use the real master.
 */
async function createVideoProxy(videoPath: string, proxyPath: string) {
  await execFileAsync("ffmpeg", [
    "-i",
    videoPath,
    "-vf",
    "scale=-2:480",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "28",
    "-an",
    proxyPath,
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
 * Logs elapsed time and current RSS at each pipeline checkpoint below —
 * added after a real OOM (2026-09-06, a high-res .MOV) killed the
 * process mid-job with no way to tell which step was responsible:
 * runAnalyze had almost no logging of its own (unlike routes/videos.ts's
 * runAnalyzeJob, which already logs for the same reason — see that
 * file's comment). An OOM SIGKILLs the process instantly, so nothing
 * after the fact can log the failure itself; the last checkpoint logged
 * before a run's log output stops *is* the answer. Useful for
 * observability generally, not just crash forensics — e.g. spotting
 * that a step is slow well before it's large enough to OOM.
 */
function logStep(sourceVideoId: string, startedAt: number, step: string) {
  const mem = process.memoryUsage();
  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(
    `[runAnalyze] sourceVideoId=${sourceVideoId} step=${step} ` +
      `elapsedSec=${elapsedSec} rssMB=${(mem.rss / 1024 / 1024).toFixed(0)} ` +
      `heapUsedMB=${(mem.heapUsed / 1024 / 1024).toFixed(0)}`,
  );
}

/**
 * Best-effort notification to apps/api that this job finished, purely to
 * trigger emailing the tenant who kicked it off (see routes/videos.ts's
 * POST /internal/analysis-complete) — NOT for status reporting.
 * sourceVideos.status is now written directly by this file (see
 * runAnalyze below), so apps/api's own queue consumer no longer needs to
 * infer the outcome from any HTTP response; this call exists solely
 * because apps/api (not this worker) holds the Clerk credentials needed
 * to look up an email address. A failure here is logged and swallowed —
 * the analysis itself already succeeded or failed for real regardless of
 * whether this notification lands.
 */
async function notifyApiOfCompletion(
  sourceVideoId: string,
  status: "analyzed" | "failed",
  errorMessage?: string,
): Promise<void> {
  const apiUrl = process.env.API_URL;
  const sharedSecret = process.env.WORKER_SHARED_SECRET;
  if (!apiUrl || !sharedSecret) return;
  try {
    await fetch(`${apiUrl}/internal/analysis-complete`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${sharedSecret}`,
      },
      body: JSON.stringify({ sourceVideoId, status, error: errorMessage }),
    });
  } catch (e) {
    console.error(
      `[runAnalyze] completion-notify callback failed for sourceVideoId=${sourceVideoId} (non-fatal):`,
      e,
    );
  }
}

// sourceVideoIds currently mid-pipeline on this machine — see the guard
// at the top of runAnalyze for why this exists.
const inFlightAnalyses = new Set<string>();

/**
 * Ingest -> transcribe -> detect scenes -> detect audio energy -> score
 * highlights -> write suggested Clip rows — the Phase 4 pipeline
 * functions wired together for the first time, against a real video
 * rather than mocked fetch/execFile calls. See PLAN.md's "Video
 * pipeline" section (step 2, "Analyze").
 *
 * Owns writing sourceVideos.status/analysisError itself (both on success
 * and failure), rather than leaving that to apps/api's HTTP caller —
 * confirmed for real (2026-09-06/07, see ROADMAP.md) that relying on an
 * HTTP round-trip surviving this function's entire duration was the root
 * cause of a real incident: a Cloudflare Queue consumer invocation timed
 * out mid-job, abandoning its connection, which Fly's own idle-connection
 * `auto_stop_machines` then read as "nothing to do" and killed the
 * machine mid-run. Status is now authoritative the moment this function
 * itself decides the outcome, independent of any caller still being
 * around to hear about it.
 */
export async function runAnalyze(
  sourceVideoId: string,
): Promise<{ clipsCreated: number; skipped?: true }> {
  // Guards against a real failure mode (confirmed 2026-09-06, see
  // ROADMAP.md): a Cloudflare Queue consumer invocation still waiting
  // on a long analyze job past its own ~15-minute wall-time ceiling
  // gets its message redelivered, so a second /analyze POST for the
  // *same* video can land on this same machine while the first is
  // still genuinely running. Without this guard, both ran full
  // pipelines concurrently — two video downloads, two scene-detection
  // subprocesses — and OOM'd. This is a single-process in-memory
  // guard, not a durable lock: it only protects against duplicates
  // landing on *this* machine, which is the case that actually
  // happened (scenestealer-worker runs as one shared
  // always-on-when-warm Fly app, not a fresh Machine per job — see
  // fly.toml). Much less likely to trigger at all now that apps/api's
  // queue consumer dispatches and returns quickly instead of waiting
  // out the job (see routes/videos.ts's runAnalyzeJob) — kept as cheap
  // defense-in-depth regardless.
  if (inFlightAnalyses.has(sourceVideoId)) {
    console.log(
      `[runAnalyze] sourceVideoId=${sourceVideoId} skipped: already in flight on this machine`,
    );
    return { clipsCreated: 0, skipped: true };
  }
  inFlightAnalyses.add(sourceVideoId);

  // Everything below is wrapped so inFlightAnalyses.delete() always
  // runs, even if something throws before the inner try/finally (tmpDir
  // cleanup) below even starts — e.g. the video lookup or mkdtemp
  // itself failing. Leaving a sourceVideoId stuck in the set would
  // permanently block every future analyze attempt on this machine for
  // that video, which would be worse than the bug this guard exists to
  // fix.
  try {
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

    const startedAt = Date.now();
    logStep(sourceVideoId, startedAt, "start");

    // Real per-run telemetry — `jobs` was defined in schema.ts but never
    // actually used anywhere in the codebase until now. finishedAt minus
    // this row's own createdAt gives real wall-clock processing time,
    // keyed by the video's real duration (payload, updated below once
    // known) — the data apps/api's completion-time estimate is built
    // from (see GET /:id/status). Best-effort: telemetry must never fail
    // the actual analysis.
    let jobId: string | undefined;
    try {
      const [job] = await db
        .insert(jobs)
        .values({
          tenantId: video.tenantId,
          type: "analyze",
          status: "running",
          payload: { sourceVideoId },
        })
        .returning({ id: jobs.id });
      jobId = job?.id;
    } catch (e) {
      console.error("Job telemetry insert failed (non-fatal):", e);
    }

    try {
      try {
        await downloadFromR2ToFile(r2Config, video.r2Key, videoPath);
        logStep(sourceVideoId, startedAt, "video-downloaded");

        // Best-effort — a video with no useful tags, or a transient
        // ffprobe/geocoding hiccup, shouldn't fail the actual analysis
        // this job exists for.
        let durationSec: number | null = null;
        try {
          const meta = await extractVideoMetadata(videoPath);
          durationSec = meta.durationSec;
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
              durationSec: meta.durationSec,
            })
            .where(eq(sourceVideos.id, sourceVideoId));
        } catch (e) {
          console.error("Video metadata extraction failed (non-fatal):", e);
        }
        logStep(sourceVideoId, startedAt, "metadata-extracted");

        if (jobId && durationSec != null) {
          try {
            await db
              .update(jobs)
              .set({ payload: { sourceVideoId, durationSec } })
              .where(eq(jobs.id, jobId));
          } catch (e) {
            console.error(
              "Job telemetry duration update failed (non-fatal):",
              e,
            );
          }
        }

        const audioPath = join(tmpDir, "audio.mp3");
        await extractAudio(videoPath, audioPath);
        logStep(sourceVideoId, startedAt, "audio-extracted");

        // Best-effort, same rationale as the metadata block above — a
        // waveform extraction failure shouldn't fail the analysis this
        // job exists for. The clip editor treats a null waveformR2Key
        // as "no waveform to show", never as "fall back to decoding the
        // raw video client-side" (see schema.ts's comment on this
        // column for why).
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
        logStep(sourceVideoId, startedAt, "waveform-peaks-done");

        // Best-effort: a proxy failure shouldn't fail the analysis this
        // job exists for — falls back to the original videoPath (slower,
        // but correct) rather than skipping detection outright. See
        // createVideoProxy's own comment for why this exists at all.
        let sceneDetectPath = videoPath;
        try {
          const proxyPath = join(tmpDir, "proxy.mp4");
          await createVideoProxy(videoPath, proxyPath);
          sceneDetectPath = proxyPath;
        } catch (e) {
          console.error(
            "Video proxy creation failed (non-fatal, falling back to source video):",
            e,
          );
        }
        logStep(sourceVideoId, startedAt, "proxy-created");

        const sceneDetector = new PySceneDetectDetector();
        const transcriber = new GroqTranscriber(process.env.GROQ_API_KEY!);
        const scorer = new ClaudeHighlightScorer(
          process.env.ANTHROPIC_API_KEY!,
        );

        // Logged individually, not just once after Promise.all — these
        // three run concurrently, so their peak memory usage adds up
        // rather than one replacing another; knowing which one is still
        // in flight when a crash happens (or which finishes last)
        // matters as much as knowing it happened somewhere in this
        // block. detectScenes/detectAudioEnergyEvents run against the
        // proxy (or the original videoPath if that failed), not the
        // original master directly — see createVideoProxy's comment.
        const [scenes, transcript, audioEvents] = await Promise.all([
          sceneDetector.detectScenes(sceneDetectPath).then((result) => {
            logStep(sourceVideoId, startedAt, "scenes-detected");
            return result;
          }),
          transcriber.transcribe(audioPath).then((result) => {
            logStep(sourceVideoId, startedAt, "transcribed");
            return result;
          }),
          detectAudioEnergyEvents(sceneDetectPath).then((result) => {
            logStep(sourceVideoId, startedAt, "audio-energy-detected");
            return result;
          }),
        ]);

        const highlights = await scorer.scoreHighlights(
          transcript,
          audioEvents,
          scenes,
        );
        logStep(sourceVideoId, startedAt, "highlights-scored");

        // Re-running analysis on the same video (retry after a failure,
        // or just triggered twice) shouldn't pile up duplicate
        // suggestions — confirmed for real, this created two identical
        // clips for the same ~5s window on a short test video. Only
        // "suggested" (not yet reviewed) clips are replaced; accepted/
        // rejected/rendering/ready clips reflect a real decision already
        // made and are left alone.
        await db
          .delete(clips)
          .where(
            and(
              eq(clips.sourceVideoId, sourceVideoId),
              eq(clips.status, "suggested"),
            ),
          );

        let clipsCreated = 0;
        if (highlights.length > 0) {
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
          clipsCreated = rows.length;
        }
        logStep(sourceVideoId, startedAt, `done-clips-created=${clipsCreated}`);

        await db
          .update(sourceVideos)
          .set({ status: "analyzed", analysisError: null })
          .where(eq(sourceVideos.id, sourceVideoId));
        if (jobId) {
          await db
            .update(jobs)
            .set({ status: "succeeded", finishedAt: new Date() })
            .where(eq(jobs.id, jobId))
            .catch((e) =>
              console.error("Job telemetry completion update failed:", e),
            );
        }
        void notifyApiOfCompletion(sourceVideoId, "analyzed");

        return { clipsCreated };
      } finally {
        await rm(tmpDir, { recursive: true, force: true });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Analysis failed";
      await db
        .update(sourceVideos)
        .set({ status: "failed", analysisError: message })
        .where(eq(sourceVideos.id, sourceVideoId))
        .catch((e) =>
          console.error("Failed to write failure status (non-fatal):", e),
        );
      if (jobId) {
        await db
          .update(jobs)
          .set({ status: "failed", error: message, finishedAt: new Date() })
          .where(eq(jobs.id, jobId))
          .catch((e) =>
            console.error("Job telemetry failure update failed:", e),
          );
      }
      void notifyApiOfCompletion(sourceVideoId, "failed", message);
      throw err;
    }
  } finally {
    inFlightAnalyses.delete(sourceVideoId);
  }
}

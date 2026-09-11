"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import type WaveSurferType from "wavesurfer.js";
import type { Region } from "wavesurfer.js/dist/plugins/regions.js";
import type { clips as clipsTable } from "@scenestealer/db";
import Link from "next/link";
import { describeFetchError } from "../../fetch-error";
import { useAuthedFetch } from "../../use-authed-fetch";
import { TABLE_HEADER_STYLE } from "../../table-header-style";

type Clip = typeof clipsTable.$inferSelect;

const REGION_COLOR: Record<Clip["status"], string> = {
  suggested: "rgba(90, 140, 255, 0.3)",
  accepted: "rgba(60, 200, 120, 0.35)",
  rejected: "rgba(140, 140, 140, 0.2)",
  rendering: "rgba(230, 180, 40, 0.35)",
  ready: "rgba(60, 200, 120, 0.35)",
};

// A drag-selected region the user hasn't confirmed as a real clip yet
// — distinct amber so it doesn't read as any existing clip status.
const REGION_COLOR_PENDING = "rgba(245, 179, 66, 0.35)";

const CELL_STYLE: CSSProperties = {
  padding: "0.5rem 0.75rem",
  textAlign: "left",
  verticalAlign: "middle",
};

const HEADER_CELL_STYLE: CSSProperties = {
  ...CELL_STYLE,
  ...TABLE_HEADER_STYLE,
};

const RENDER_POLL_INTERVAL_MS = 5000;

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = (sec % 60).toFixed(1);
  return `${m}:${s.padStart(4, "0")}`;
}

// Inverse of formatTime — "M:SS" or "M:SS.S" (whole minutes, seconds
// 0-59.9) back to a plain seconds float. Confirmed for real
// (2026-09-07): the Adjust column's boundary inputs used to show raw
// seconds ("1836.8"), which a tenant read as frame numbers — nothing
// else in this editor (the Play column, the waveform, native <video>
// controls) shows time that way, so it couldn't be compared against
// anything. Also accepts a bare number as a lenient fallback (typing
// or pasting a raw seconds value still works), but the field always
// *displays* timecode via formatTime, matching the rest of the UI.
function parseTimecode(text: string): number | null {
  const trimmed = text.trim();
  const match = /^(\d+):(\d{1,2}(?:\.\d+)?)$/.exec(trimmed);
  if (match) {
    const minutes = Number(match[1]);
    const seconds = Number(match[2]);
    if (seconds >= 60) return null;
    return minutes * 60 + seconds;
  }
  const plain = Number(trimmed);
  return Number.isFinite(plain) ? plain : null;
}

// Rendered/rendering/rejected clips are done being edited — matches
// the waveform regions' own drag/resize lock so the boundary inputs
// and the waveform never disagree about whether a clip is editable.
function isLocked(status: Clip["status"]): boolean {
  return status === "rejected" || status === "ready" || status === "rendering";
}

export function ClipEditor({
  sourceVideoId,
  initialClips,
}: {
  sourceVideoId: string;
  initialClips: Clip[];
}) {
  const [clipList, setClipList] = useState<Clip[]>(initialClips);
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null);
  // Precomputed peaks (from apps/worker's analyze step) that wavesurfer.js
  // renders directly, instead of fetching + decodeAudioData-ing the raw
  // video itself — the latter is what used to crash iOS Safari
  // repeatedly on a large upload (see the wavesurfer effect below).
  // waveformUnavailable (no peaks exist — analyzed before this shipped,
  // or extraction failed) is a distinct state from "still loading":
  // it's the only case the waveform is deliberately skipped rather than
  // rendered, since falling back to raw-video decoding would reintroduce
  // the crash.
  const [waveformPeaks, setWaveformPeaks] = useState<{
    peaks: number[];
    duration: number;
  } | null>(null);
  const [waveformUnavailable, setWaveformUnavailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A region the user drag-selected on the waveform but hasn't
  // confirmed as a real clip yet — holds the live wavesurfer Region
  // object itself (not just its start/end) so accepting it can
  // retarget the same visual region to the new clip's real id/color
  // instead of destroying and recreating it.
  const [pendingNewClip, setPendingNewClip] = useState<Region | null>(null);
  // Plain numbers driving the pending clip's editable start/end fields
  // below — pendingNewClip itself is a mutable wavesurfer Region, and
  // React won't re-render on mutating it (e.g. via setOptions), so
  // these are what the inputs actually read from; setOptions on the
  // region is still called alongside, purely to keep the visual region
  // on the waveform in sync with what's typed. Added 2026-09-11: the
  // pending region has drag/resize deliberately off (see
  // enablePendingDragSelection's own comment), so before this, typing
  // a more precise boundary wasn't possible at all — only re-dragging
  // the whole selection from scratch was.
  const [pendingStart, setPendingStart] = useState(0);
  const [pendingEnd, setPendingEnd] = useState(0);
  const [creatingClip, setCreatingClip] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const waveformRef = useRef<HTMLDivElement>(null);
  const waveSurferRef = useRef<WaveSurferType | null>(null);
  const regionsPluginRef = useRef<
    import("wavesurfer.js/dist/plugins/regions.js").default | null
  >(null);
  const disableDragSelectionRef = useRef<(() => void) | null>(null);

  // Arms drag-selection once, for the life of the wavesurfer instance
  // (the effect below calls this exactly once, and cleans it up on
  // unmount) — drawing a new selection while one is already pending
  // replaces it (see region-created below) rather than being blocked,
  // so unlike an earlier version of this, there's no disable/re-enable
  // dance needed around Create/Cancel any more.
  const enablePendingDragSelection = useCallback(() => {
    const regions = regionsPluginRef.current;
    if (!regions) return;
    disableDragSelectionRef.current = regions.enableDragSelection({
      color: REGION_COLOR_PENDING,
      drag: false,
      resize: false,
    });
  }, []);

  const authedFetch = useAuthedFetch();

  // Fetch the presigned playback URL — R2 credentials only live in
  // apps/api, so this can't be resolved directly from the Server Component.
  useEffect(() => {
    authedFetch(`/videos/${sourceVideoId}/playback-url`)
      .then(async (res) => {
        if (!res.ok) throw new Error("Failed to load video playback URL");
        const { playbackUrl: url } = (await res.json()) as {
          playbackUrl: string;
        };
        setPlaybackUrl(url);
      })
      .catch((e) => setError(`Failed to load video: ${describeFetchError(e)}`));
  }, [authedFetch, sourceVideoId]);

  // Fetches the precomputed waveform peaks, separately from the video
  // itself — a missing/failed waveform (waveformUrl: null) is a
  // degraded-but-fine state, not a page-level error, so it's tracked via
  // waveformUnavailable rather than setError.
  useEffect(() => {
    authedFetch(`/videos/${sourceVideoId}/waveform-url`)
      .then(async (res) => {
        if (!res.ok) throw new Error("Failed to load waveform URL");
        const { waveformUrl } = (await res.json()) as {
          waveformUrl: string | null;
        };
        if (!waveformUrl) {
          setWaveformUnavailable(true);
          return;
        }
        // Direct presigned R2 fetch, not through authedFetch — same as
        // <video src={playbackUrl}> below, this URL is already
        // pre-authorized and doesn't go through apps/api again.
        const peaksRes = await fetch(waveformUrl);
        if (!peaksRes.ok) throw new Error("Failed to load waveform data");
        const data = (await peaksRes.json()) as {
          peaks: number[];
          duration: number;
        };
        setWaveformPeaks(data);
      })
      .catch(() => setWaveformUnavailable(true));
  }, [authedFetch, sourceVideoId]);

  // Tracks the timeupdate listener for whichever clip is currently
  // playing, so starting a new clip's playback cleans up the old
  // listener rather than leaving it watching a stale endSec (which
  // could pause the video early once currentTime crosses that old
  // boundary during the new clip's playback).
  const activePlaybackCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => activePlaybackCleanupRef.current?.();
  }, []);

  // Takes plain start/end rather than a Clip so the same playback logic
  // covers both a saved clip's Play button and the pending (not yet
  // created) selection below, which has no Clip row to pass in.
  const playRange = useCallback((startSec: number, endSec: number) => {
    const videoEl = videoRef.current;
    if (!videoEl) return;

    activePlaybackCleanupRef.current?.();

    videoEl.currentTime = startSec;
    void videoEl.play();

    const onTimeUpdate = () => {
      if (videoEl.currentTime >= endSec) {
        videoEl.pause();
        cleanup();
      }
    };
    const cleanup = () => {
      videoEl.removeEventListener("timeupdate", onTimeUpdate);
      activePlaybackCleanupRef.current = null;
    };
    videoEl.addEventListener("timeupdate", onTimeUpdate);
    activePlaybackCleanupRef.current = cleanup;
  }, []);

  const [renderedUrls, setRenderedUrls] = useState<Record<string, string>>({});
  const [renderingIds, setRenderingIds] = useState<Set<string>>(new Set());

  const renderClip = useCallback(
    async (clipId: string) => {
      setRenderingIds((prev) => new Set(prev).add(clipId));
      setError(null);
      try {
        const res = await authedFetch(`/clips/${clipId}/render`, {
          method: "POST",
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as {
            error?: string;
          } | null;
          setError(body?.error ?? "Failed to render clip");
          return;
        }
        // Dispatched, not finished — this now reflects status:
        // "rendering", not the finished render (apps/api spawns a Fly
        // Machine to do the actual work — see fly-machines.ts). The
        // polling effect below picks up the real outcome.
        const { clip } = (await res.json()) as { clip: Clip };
        setClipList((prev) => prev.map((c) => (c.id === clip.id ? clip : c)));
      } catch (e) {
        setError(`Failed to render clip: ${describeFetchError(e)}`);
      } finally {
        setRenderingIds((prev) => {
          const next = new Set(prev);
          next.delete(clipId);
          return next;
        });
      }
    },
    [authedFetch],
  );

  // Polls every clip currently showing status "rendering" until it
  // resolves to something else — same role as analyze-control.tsx's own
  // polling effect for analyze, needed here because POST /:id/render no
  // longer waits for the render to actually finish (see renderClip
  // above). A single persistent interval, not one keyed to clipList
  // changing: reads the latest clip list via a ref on each tick instead
  // of restarting the interval on every unrelated edit (a drag, a
  // boundary-field change, etc.).
  const clipListRef = useRef(clipList);
  useEffect(() => {
    clipListRef.current = clipList;
  }, [clipList]);

  useEffect(() => {
    const interval = setInterval(() => {
      const renderingClipIds = clipListRef.current
        .filter((c) => c.status === "rendering")
        .map((c) => c.id);
      for (const clipId of renderingClipIds) {
        void authedFetch(`/clips/${clipId}/status`)
          .then((res) => (res.ok ? res.json() : null))
          .then(
            (
              body: {
                status: Clip["status"];
                renderError: string | null;
                renderedR2Key: string | null;
              } | null,
            ) => {
              if (!body || body.status === "rendering") return;
              setClipList((prev) =>
                prev.map((c) =>
                  c.id === clipId
                    ? {
                        ...c,
                        status: body.status,
                        renderError: body.renderError,
                        renderedR2Key: body.renderedR2Key,
                      }
                    : c,
                ),
              );
            },
          )
          .catch(() => {
            // Transient — keep polling.
          });
      }
    }, RENDER_POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [authedFetch]);

  const fetchRenderedUrl = useCallback(
    async (clipId: string) => {
      try {
        const res = await authedFetch(`/clips/${clipId}/playback-url`);
        if (!res.ok) {
          setError("Failed to load rendered clip");
          return;
        }
        const { playbackUrl: url } = (await res.json()) as {
          playbackUrl: string;
        };
        setRenderedUrls((prev) => ({ ...prev, [clipId]: url }));
      } catch (e) {
        setError(`Failed to load rendered clip: ${describeFetchError(e)}`);
      }
    },
    [authedFetch],
  );

  // Fetches a ready clip's download URL automatically the moment it
  // becomes ready, instead of waiting for the user to click a "Get
  // rendered clip" button first — Download below is then a real,
  // one-click <a href> from the moment it appears, not a two-step
  // fetch-then-click flow.
  useEffect(() => {
    for (const clip of clipList) {
      if (
        clip.status === "ready" &&
        clip.renderedR2Key &&
        !renderedUrls[clip.id]
      ) {
        void fetchRenderedUrl(clip.id);
      }
    }
  }, [clipList, renderedUrls, fetchRenderedUrl]);

  const updateClip = useCallback(
    async (
      clipId: string,
      patch: Partial<Pick<Clip, "startSec" | "endSec" | "status" | "fitMode">>,
    ) => {
      try {
        const res = await authedFetch(`/clips/${clipId}`, {
          method: "PATCH",
          body: JSON.stringify(patch),
        });
        if (!res.ok) {
          setError("Failed to save clip change");
          return;
        }
        const { clip } = (await res.json()) as { clip: Clip };
        setClipList((prev) => prev.map((c) => (c.id === clip.id ? clip : c)));

        // Keep the waveform region in sync when the edit came from the
        // boundary inputs below rather than a drag on the region itself
        // — dragging already updates the region directly (that's what
        // triggers this function in the first place, via
        // region-updated), so re-setting it there would just echo back
        // the same values. Look the region up by id rather than closing
        // over one, since the region this function was called for isn't
        // always the one the caller has a reference to.
        if (patch.startSec != null || patch.endSec != null) {
          const region = regionsPluginRef.current
            ?.getRegions()
            .find((r) => r.id === clip.id);
          region?.setOptions({ start: clip.startSec, end: clip.endSec });
        }
      } catch (e) {
        setError(`Failed to save clip change: ${describeFetchError(e)}`);
      }
    },
    [authedFetch],
  );

  const createClip = useCallback(
    async (start: number, end: number, region: Region) => {
      setCreatingClip(true);
      setError(null);
      try {
        const res = await authedFetch(`/videos/${sourceVideoId}/clips`, {
          method: "POST",
          body: JSON.stringify({ startSec: start, endSec: end }),
        });
        if (!res.ok) {
          setError("Failed to create clip");
          return;
        }
        const { clip } = (await res.json()) as { clip: Clip };
        setClipList((prev) => [...prev, clip]);
        // Retarget the same drag-selected region to the real clip
        // instead of destroying and recreating it — keeps it visually
        // in place through the transition from "pending" to
        // "suggested". drag/resize re-enabled here since the pending
        // region is created with both off (see enableDragSelection's
        // own comment for why) — a "suggested" clip should be exactly
        // as draggable as any other.
        region.setOptions({
          id: clip.id,
          color: REGION_COLOR.suggested,
          drag: true,
          resize: true,
        });
        setPendingNewClip(null);
      } catch (e) {
        setError(`Failed to create clip: ${describeFetchError(e)}`);
      } finally {
        setCreatingClip(false);
      }
    },
    [authedFetch, sourceVideoId],
  );

  // wavesurfer.js lifecycle — bound to the <video> element so playback
  // stays in sync off a single media source, but rendered from
  // precomputed peaks (waveformPeaks) rather than letting wavesurfer
  // fetch + decodeAudioData the raw video itself to compute them: for a
  // large upload that download-and-decode repeatedly crashed iOS
  // Safari's content process (confirmed for real, 2026-09-06, a 1.24GB
  // file — see ROADMAP.md). Gated on waveformPeaks being non-null, not
  // just playbackUrl, so there's no path left that decodes raw media
  // client-side — a video with no peaks (waveformUnavailable) simply
  // shows no waveform rather than falling back to that.
  useEffect(() => {
    if (
      !playbackUrl ||
      !waveformPeaks ||
      !videoRef.current ||
      !waveformRef.current
    )
      return;

    let cancelled = false;
    (async () => {
      const [{ default: WaveSurfer }, { default: RegionsPlugin }] =
        await Promise.all([
          import("wavesurfer.js"),
          import("wavesurfer.js/dist/plugins/regions.js"),
        ]);
      if (cancelled) return;

      const ws = WaveSurfer.create({
        container: waveformRef.current!,
        media: videoRef.current!,
        peaks: [Float32Array.from(waveformPeaks.peaks)],
        duration: waveformPeaks.duration,
        waveColor: "#8888aa",
        progressColor: "#5a5aff",
        height: 96,
      });
      const regions = ws.registerPlugin(RegionsPlugin.create());
      waveSurferRef.current = ws;
      regionsPluginRef.current = regions;

      // Every clip already in clipList gets its own region seeded below
      // — tracked here so region-created (registered further down) can
      // tell those apart from a genuinely new, user-drawn one. Registering
      // the listener only *after* this loop runs does NOT do that on its
      // own, despite looking like it should: confirmed for real
      // (2026-09-12) in wavesurfer.js's own regions-plugin source that
      // addRegion() only emits region-created synchronously when the
      // plugin already knows the media's duration; if it doesn't yet
      // (routine here, since this all runs the moment the video/waveform
      // data resolves), it defers via a one-time "ready" listener instead
      // — so every seeded region's region-created fires later, in a
      // batch, once "ready" fires, by which point *any* listener
      // registered here (regardless of ordering) is already attached.
      // That's what made the editor open with an existing clip sitting in
      // the pending-new-clip UI, as if the user had just drawn it.
      const seededClipIds = new Set(clipList.map((clip) => clip.id));
      for (const clip of clipList) {
        const locked = isLocked(clip.status);
        regions.addRegion({
          id: clip.id,
          start: clip.startSec,
          end: clip.endSec,
          color: REGION_COLOR[clip.status],
          drag: !locked,
          resize: !locked,
        });
      }

      regions.on("region-updated", (region: Region) => {
        void updateClip(region.id, {
          startSec: region.start,
          endSec: region.end,
        });
      });
      regions.on("region-clicked", (region: Region, e: MouseEvent) => {
        e.stopPropagation();
        region.play();
      });

      // Drag across empty waveform to define a new clip's bounds — the
      // regions plugin's own built-in creation mechanism. drag/resize off
      // here (the initial click-and-drag creation gesture itself is a
      // separate mechanism this doesn't affect) — the pending region has
      // no real clip id yet, so the region-updated handler above can't
      // safely PATCH it if the user tried to nudge its handles before
      // confirming.
      enablePendingDragSelection();
      regions.on("region-created", (region: Region) => {
        if (seededClipIds.has(region.id)) return;
        // Drawing a new selection while one is already pending replaces
        // it, rather than being blocked until Create/Cancel — requested
        // for real (2026-09-12): only one pending selection should ever
        // exist, but redrawing shouldn't require dismissing the old one
        // first. The functional updater (not the pendingNewClip variable
        // directly) reads whatever's actually still pending right now,
        // since this handler is registered once and would otherwise only
        // ever see the value from when the effect first ran.
        setPendingNewClip((prev) => {
          if (prev && prev !== region) prev.remove();
          return region;
        });
        setPendingStart(region.start);
        setPendingEnd(region.end);
      });
    })();

    return () => {
      cancelled = true;
      disableDragSelectionRef.current?.();
      disableDragSelectionRef.current = null;
      waveSurferRef.current?.destroy();
      waveSurferRef.current = null;
      regionsPluginRef.current = null;
    };
    // clipList is only used for the initial region seed — subsequent edits
    // flow through the region objects themselves, not React re-renders, so
    // it's deliberately excluded from the dependency list.
  }, [playbackUrl, waveformPeaks, updateClip, enablePendingDragSelection]);

  return (
    <div>
      {error && <p role="alert">{error}</p>}

      <video
        ref={videoRef}
        src={playbackUrl ?? undefined}
        controls
        style={{
          display: "block",
          width: "100%",
          maxWidth: 720,
          margin: "0 auto",
        }}
      />

      <div ref={waveformRef} style={{ margin: "1rem 0" }} />

      {waveformPeaks ? (
        <p style={{ color: "var(--muted)", fontSize: "0.9em" }}>
          Drag across an empty part of the waveform above to define a new clip.
        </p>
      ) : (
        waveformUnavailable && (
          <p style={{ color: "var(--muted)", fontSize: "0.9em" }}>
            Waveform unavailable for this video — new clips can still be drawn
            once it&apos;s re-analyzed, or adjusted below by time.
          </p>
        )
      )}

      {pendingNewClip && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.75rem",
            padding: "0.5rem 0.75rem",
            margin: "0.5rem 0",
            border: "1px solid var(--border)",
            borderRadius: 8,
            background: "var(--surface-raised)",
          }}
        >
          <span
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.25rem",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            New clip:{" "}
            <input
              key={`pending-start-${pendingStart}`}
              type="text"
              inputMode="numeric"
              defaultValue={formatTime(pendingStart)}
              onBlur={(e) => {
                const value = parseTimecode(e.target.value);
                if (
                  value == null ||
                  !Number.isFinite(value) ||
                  value < 0 ||
                  value >= pendingEnd
                ) {
                  e.target.value = formatTime(pendingStart);
                  return;
                }
                pendingNewClip.setOptions({ start: value });
                setPendingStart(value);
              }}
              style={{ width: "5.5em" }}
              aria-label="New clip start time (minutes:seconds)"
            />
            <span>–</span>
            <input
              key={`pending-end-${pendingEnd}`}
              type="text"
              inputMode="numeric"
              defaultValue={formatTime(pendingEnd)}
              onBlur={(e) => {
                const value = parseTimecode(e.target.value);
                const duration = videoRef.current?.duration;
                if (
                  value == null ||
                  !Number.isFinite(value) ||
                  value <= pendingStart ||
                  (duration != null && value > duration)
                ) {
                  e.target.value = formatTime(pendingEnd);
                  return;
                }
                pendingNewClip.setOptions({ end: value });
                setPendingEnd(value);
              }}
              style={{ width: "5.5em" }}
              aria-label="New clip end time (minutes:seconds)"
            />
          </span>
          <button
            type="button"
            onClick={() => playRange(pendingStart, pendingEnd)}
            disabled={!playbackUrl}
            title="Play this selection"
            aria-label={`Play selection from ${formatTime(pendingStart)} to ${formatTime(pendingEnd)}`}
            style={{ lineHeight: 1 }}
          >
            &#9654;
          </button>
          <button
            type="button"
            disabled={creatingClip}
            onClick={() =>
              void createClip(pendingStart, pendingEnd, pendingNewClip)
            }
          >
            {creatingClip ? "Creating…" : "Create clip"}
          </button>
          <button
            type="button"
            disabled={creatingClip}
            onClick={() => {
              pendingNewClip.remove();
              setPendingNewClip(null);
            }}
          >
            Cancel
          </button>
        </div>
      )}

      <h2>Clips</h2>

      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ borderBottom: "2px solid #333" }}>
            <th style={HEADER_CELL_STYLE}>Play</th>
            <th style={HEADER_CELL_STYLE}>Adjust</th>
            <th style={HEADER_CELL_STYLE}>Reasoning</th>
            <th style={HEADER_CELL_STYLE}>Status</th>
            <th style={HEADER_CELL_STYLE}>Format</th>
            <th style={HEADER_CELL_STYLE}>Manage</th>
          </tr>
        </thead>
        <tbody>
          {clipList.map((clip, index) => {
            const rowBackground =
              index % 2 === 1 ? "var(--surface-raised)" : "none";
            return (
              <tr
                key={clip.id}
                style={{
                  background: rowBackground,
                  borderBottom: "1px solid #333",
                }}
              >
                <td style={CELL_STYLE}>
                  <button
                    type="button"
                    onClick={() => playRange(clip.startSec, clip.endSec)}
                    disabled={!playbackUrl}
                    title="Play this clip"
                    aria-label={`Play clip from ${formatTime(clip.startSec)} to ${formatTime(clip.endSec)}`}
                    style={{ lineHeight: 1 }}
                  >
                    &#9654;
                  </button>
                </td>
                <td style={CELL_STYLE}>
                  {isLocked(clip.status) ? (
                    <span style={{ fontVariantNumeric: "tabular-nums" }}>
                      {formatTime(clip.startSec)} – {formatTime(clip.endSec)}
                    </span>
                  ) : (
                    <span
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "0.25rem",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      <input
                        key={`start-${clip.id}-${clip.startSec}`}
                        type="text"
                        inputMode="numeric"
                        defaultValue={formatTime(clip.startSec)}
                        onBlur={(e) => {
                          const value = parseTimecode(e.target.value);
                          if (
                            value == null ||
                            !Number.isFinite(value) ||
                            value < 0 ||
                            value >= clip.endSec
                          ) {
                            e.target.value = formatTime(clip.startSec);
                            return;
                          }
                          void updateClip(clip.id, { startSec: value });
                        }}
                        style={{ width: "5.5em" }}
                        aria-label="Clip start time (minutes:seconds)"
                      />
                      <span>–</span>
                      <input
                        key={`end-${clip.id}-${clip.endSec}`}
                        type="text"
                        inputMode="numeric"
                        defaultValue={formatTime(clip.endSec)}
                        onBlur={(e) => {
                          const value = parseTimecode(e.target.value);
                          const duration = videoRef.current?.duration;
                          if (
                            value == null ||
                            !Number.isFinite(value) ||
                            value <= clip.startSec ||
                            (duration != null && value > duration)
                          ) {
                            e.target.value = formatTime(clip.endSec);
                            return;
                          }
                          void updateClip(clip.id, { endSec: value });
                        }}
                        style={{ width: "5.5em" }}
                        aria-label="Clip end time (minutes:seconds)"
                      />
                    </span>
                  )}
                </td>
                <td style={{ ...CELL_STYLE, fontSize: "0.9em", opacity: 0.8 }}>
                  {clip.aiReason ?? "Manually adjusted clip"}
                  {clip.aiScore != null &&
                    ` (score ${clip.aiScore.toFixed(2)})`}
                </td>
                <td style={{ ...CELL_STYLE, fontSize: "0.85em", opacity: 0.7 }}>
                  {clip.status}
                  {clip.renderError && (
                    <p role="alert" style={{ margin: "0.25rem 0 0" }}>
                      {clip.renderError}
                    </p>
                  )}
                </td>
                <td style={CELL_STYLE}>
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "0.2rem",
                    }}
                  >
                    <label
                      style={{ display: "flex", gap: "0.35rem" }}
                      title="Cuts off the sides to fill the 9:16 frame"
                    >
                      <input
                        type="radio"
                        name={`fitMode-${clip.id}`}
                        checked={clip.fitMode === "crop"}
                        disabled={
                          renderingIds.has(clip.id) ||
                          clip.status === "rendering"
                        }
                        onChange={() =>
                          void updateClip(clip.id, { fitMode: "crop" })
                        }
                      />
                      Crop
                    </label>
                    <label
                      style={{ display: "flex", gap: "0.35rem" }}
                      title="Keeps the whole picture, adding black bars"
                    >
                      <input
                        type="radio"
                        name={`fitMode-${clip.id}`}
                        checked={clip.fitMode === "pad"}
                        disabled={
                          renderingIds.has(clip.id) ||
                          clip.status === "rendering"
                        }
                        onChange={() =>
                          void updateClip(clip.id, { fitMode: "pad" })
                        }
                      />
                      Fit
                    </label>
                  </div>
                </td>
                <td style={CELL_STYLE}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.5rem",
                    }}
                  >
                    <button
                      type="button"
                      disabled={
                        renderingIds.has(clip.id) || clip.status === "rendering"
                      }
                      onClick={() => void renderClip(clip.id)}
                    >
                      {renderingIds.has(clip.id) || clip.status === "rendering"
                        ? "Rendering…"
                        : "Render"}
                    </button>
                    {clip.status !== "rejected" && (
                      <button
                        type="button"
                        onClick={() =>
                          void updateClip(clip.id, { status: "rejected" })
                        }
                      >
                        Reject
                      </button>
                    )}
                    {clip.status === "ready" &&
                      clip.renderedR2Key &&
                      (renderedUrls[clip.id] ? (
                        <a
                          href={renderedUrls[clip.id]}
                          target="_blank"
                          rel="noreferrer"
                          className="btn-link"
                        >
                          Download
                        </a>
                      ) : (
                        <button type="button" disabled>
                          Download
                        </button>
                      ))}
                    {clip.status === "ready" && (
                      <Link
                        href={`/scheduled?clip=${clip.id}`}
                        className="btn-link"
                      >
                        Schedule
                      </Link>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

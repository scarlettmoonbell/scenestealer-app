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

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = (sec % 60).toFixed(1);
  return `${m}:${s.padStart(4, "0")}`;
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
  const [error, setError] = useState<string | null>(null);
  // A region the user drag-selected on the waveform but hasn't
  // confirmed as a real clip yet — holds the live wavesurfer Region
  // object itself (not just its start/end) so accepting it can
  // retarget the same visual region to the new clip's real id/color
  // instead of destroying and recreating it.
  const [pendingNewClip, setPendingNewClip] = useState<Region | null>(null);
  const [creatingClip, setCreatingClip] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const waveformRef = useRef<HTMLDivElement>(null);
  const waveSurferRef = useRef<WaveSurferType | null>(null);
  const regionsPluginRef = useRef<
    import("wavesurfer.js/dist/plugins/regions.js").default | null
  >(null);
  const disableDragSelectionRef = useRef<(() => void) | null>(null);

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

  // Tracks the timeupdate listener for whichever clip is currently
  // playing, so starting a new clip's playback cleans up the old
  // listener rather than leaving it watching a stale endSec (which
  // could pause the video early once currentTime crosses that old
  // boundary during the new clip's playback).
  const activePlaybackCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => activePlaybackCleanupRef.current?.();
  }, []);

  const playClip = useCallback((clip: Clip) => {
    const videoEl = videoRef.current;
    if (!videoEl) return;

    activePlaybackCleanupRef.current?.();

    videoEl.currentTime = clip.startSec;
    void videoEl.play();

    const onTimeUpdate = () => {
      if (videoEl.currentTime >= clip.endSec) {
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
      try {
        const res = await authedFetch(`/clips/${clipId}/render`, {
          method: "POST",
        });
        if (!res.ok) {
          setError("Failed to render clip");
          return;
        }
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

  const updateClip = useCallback(
    async (
      clipId: string,
      patch: Partial<Pick<Clip, "startSec" | "endSec" | "status">>,
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

  // wavesurfer.js lifecycle — bound to the <video> element so playback and
  // the waveform stay in sync off a single media source (no second fetch
  // of the video just to decode audio for the waveform).
  useEffect(() => {
    if (!playbackUrl || !videoRef.current || !waveformRef.current) return;

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
        waveColor: "#8888aa",
        progressColor: "#5a5aff",
        height: 96,
      });
      const regions = ws.registerPlugin(RegionsPlugin.create());
      waveSurferRef.current = ws;
      regionsPluginRef.current = regions;

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
      // regions plugin's own built-in creation mechanism, registered
      // only after the seed loop above so its region-created events
      // (identical event, fired for every region including the
      // pre-seeded ones) only reach this listener for genuinely new,
      // user-drawn regions. drag/resize off here (the initial
      // click-and-drag creation gesture itself is a separate mechanism
      // this doesn't affect) — the pending region has no real clip id
      // yet, so the region-updated handler below can't safely PATCH it
      // if the user tried to nudge its handles before confirming.
      disableDragSelectionRef.current = regions.enableDragSelection({
        color: REGION_COLOR_PENDING,
        drag: false,
        resize: false,
      });
      regions.on("region-created", (region: Region) => {
        setPendingNewClip(region);
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
  }, [playbackUrl, updateClip]);

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

      <p style={{ color: "var(--muted)", fontSize: "0.9em" }}>
        Drag across an empty part of the waveform above to define a new clip.
      </p>

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
          <span style={{ flex: 1, fontVariantNumeric: "tabular-nums" }}>
            New clip: {formatTime(pendingNewClip.start)} –{" "}
            {formatTime(pendingNewClip.end)}
          </span>
          <button
            type="button"
            disabled={creatingClip}
            onClick={() =>
              void createClip(
                pendingNewClip.start,
                pendingNewClip.end,
                pendingNewClip,
              )
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
                    onClick={() => playClip(clip)}
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
                        type="number"
                        step={0.1}
                        min={0}
                        defaultValue={clip.startSec.toFixed(1)}
                        onBlur={(e) => {
                          const value = parseFloat(e.target.value);
                          if (
                            !Number.isFinite(value) ||
                            value < 0 ||
                            value >= clip.endSec
                          ) {
                            e.target.value = clip.startSec.toFixed(1);
                            return;
                          }
                          void updateClip(clip.id, { startSec: value });
                        }}
                        style={{ width: "4.5em" }}
                        aria-label="Clip start time in seconds"
                      />
                      <span>–</span>
                      <input
                        key={`end-${clip.id}-${clip.endSec}`}
                        type="number"
                        step={0.1}
                        min={0}
                        max={videoRef.current?.duration}
                        defaultValue={clip.endSec.toFixed(1)}
                        onBlur={(e) => {
                          const value = parseFloat(e.target.value);
                          const duration = videoRef.current?.duration;
                          if (
                            !Number.isFinite(value) ||
                            value <= clip.startSec ||
                            (duration != null && value > duration)
                          ) {
                            e.target.value = clip.endSec.toFixed(1);
                            return;
                          }
                          void updateClip(clip.id, { endSec: value });
                        }}
                        style={{ width: "4.5em" }}
                        aria-label="Clip end time in seconds"
                      />
                      <span>sec</span>
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
                </td>
                <td style={CELL_STYLE}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.5rem",
                    }}
                  >
                    {clip.status !== "accepted" &&
                      clip.status !== "ready" &&
                      clip.status !== "rendering" && (
                        <button
                          type="button"
                          onClick={() =>
                            void updateClip(clip.id, { status: "accepted" })
                          }
                        >
                          Accept
                        </button>
                      )}
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
                    {clip.status === "accepted" && (
                      <button
                        type="button"
                        disabled={renderingIds.has(clip.id)}
                        onClick={() => void renderClip(clip.id)}
                      >
                        {renderingIds.has(clip.id) ? "Rendering…" : "Render"}
                      </button>
                    )}
                    {clip.status === "rendering" && <span>Rendering…</span>}
                    {clip.status === "ready" &&
                      clip.renderedR2Key &&
                      (renderedUrls[clip.id] ? (
                        <a
                          href={renderedUrls[clip.id]}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Download
                        </a>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void fetchRenderedUrl(clip.id)}
                        >
                          Get rendered clip
                        </button>
                      ))}
                    {clip.status === "ready" && (
                      <Link href={`/scheduled?clip=${clip.id}`}>Schedule</Link>
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

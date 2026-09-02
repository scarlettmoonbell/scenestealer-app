"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type WaveSurferType from "wavesurfer.js";
import type { Region } from "wavesurfer.js/dist/plugins/regions.js";
import type { clips as clipsTable } from "@scenestealer/db";
import { describeFetchError } from "../../fetch-error";
import { useAuthedFetch } from "../../use-authed-fetch";
import { PublishControl } from "./publish-control";

type Clip = typeof clipsTable.$inferSelect;

const REGION_COLOR: Record<Clip["status"], string> = {
  suggested: "rgba(90, 140, 255, 0.3)",
  accepted: "rgba(60, 200, 120, 0.35)",
  rejected: "rgba(140, 140, 140, 0.2)",
  rendering: "rgba(230, 180, 40, 0.35)",
  ready: "rgba(60, 200, 120, 0.35)",
};

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = (sec % 60).toFixed(1);
  return `${m}:${s.padStart(4, "0")}`;
}

export function ClipEditor({
  sourceVideoId,
  videoTitle,
  organizationName,
  initialClips,
}: {
  sourceVideoId: string;
  videoTitle: string;
  organizationName: string;
  initialClips: Clip[];
}) {
  const [clipList, setClipList] = useState<Clip[]>(initialClips);
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const waveformRef = useRef<HTMLDivElement>(null);
  const waveSurferRef = useRef<WaveSurferType | null>(null);
  const regionsPluginRef = useRef<
    import("wavesurfer.js/dist/plugins/regions.js").default | null
  >(null);

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
      } catch (e) {
        setError(`Failed to save clip change: ${describeFetchError(e)}`);
      }
    },
    [authedFetch],
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
        const locked =
          clip.status === "rejected" ||
          clip.status === "ready" ||
          clip.status === "rendering";
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
    })();

    return () => {
      cancelled = true;
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
        style={{ width: "100%", maxWidth: 720 }}
      />

      <div ref={waveformRef} style={{ margin: "1rem 0" }} />

      <ul style={{ listStyle: "none", padding: 0 }}>
        {clipList.map((clip) => (
          <li
            key={clip.id}
            style={{
              padding: "0.5rem 0",
              borderBottom: "1px solid #333",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.75rem",
              }}
            >
              <span style={{ fontVariantNumeric: "tabular-nums" }}>
                {formatTime(clip.startSec)} – {formatTime(clip.endSec)}
              </span>
              <span style={{ flex: 1, fontSize: "0.9em", opacity: 0.8 }}>
                {clip.aiReason ?? "Manually adjusted clip"}
                {clip.aiScore != null && ` (score ${clip.aiScore.toFixed(2)})`}
              </span>
              <span style={{ fontSize: "0.85em", opacity: 0.7 }}>
                {clip.status}
              </span>
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
            </div>
            {clip.status === "ready" && (
              <PublishControl
                clipId={clip.id}
                videoTitle={videoTitle}
                organizationName={organizationName}
              />
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

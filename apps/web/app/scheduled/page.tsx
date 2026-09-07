"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { DashboardTabs } from "../dashboard-tabs";
import { describeFetchError } from "../fetch-error";
import { useAuthedFetch } from "../use-authed-fetch";
import { TABLE_HEADER_STYLE } from "../table-header-style";
import { Scheduler, type VideoMetadata } from "./scheduler";

interface ReadyClip {
  id: string;
  // null once the source video has been deleted to save storage —
  // the clip itself (and its rendered file) is deliberately kept, see
  // packages/db/src/schema.ts's clips.sourceVideoId comment.
  sourceVideoId: string | null;
  // User-editable label — null until set, see the schema's own
  // comment. clipTitle() below is the single place that decides what
  // to show/edit; nothing else should read videoTitle directly for
  // display.
  title: string | null;
  startSec: number;
  endSec: number;
  aiReason: string | null;
  renderedR2Key: string | null;
  videoTitle: string | null;
  recordedAt: string | null;
  deviceModel: string | null;
  venueName: string | null;
  cityName: string | null;
  clipDurationSec: number;
}

// The one place that decides what a clip is called for display/editing
// — a tenant's own title first, falling back to the source video's
// title (itself only available until that video's deleted — see
// ReadyClip.sourceVideoId), then a plain placeholder.
function clipTitle(clip: Pick<ReadyClip, "title" | "videoTitle">): string {
  return clip.title ?? clip.videoTitle ?? "Untitled recording";
}

interface ScheduledPost {
  id: string;
  clipId: string | null;
  scheduledAt: string;
  platform: string;
  videoTitle: string | null;
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = (sec % 60).toFixed(1);
  return `${m}:${s.padStart(4, "0")}`;
}

// Wrapped in Suspense because the child reads useSearchParams() (the
// ?clip= a "Schedule" link from a video's clip table arrives with) —
// Next.js requires that boundary for any component using it.
export default function SchedulingPage() {
  return (
    <Suspense fallback={null}>
      <SchedulingContent />
    </Suspense>
  );
}

function SchedulingContent() {
  const authedFetch = useAuthedFetch();
  const searchParams = useSearchParams();

  const [readyClips, setReadyClips] = useState<ReadyClip[]>([]);
  const [organizationName, setOrganizationName] = useState("");
  const [postList, setPostList] = useState<ScheduledPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  // Seeded from ?clip=, set by the "Schedule" link on a video's own
  // clip table — this is the one place scheduling actually happens
  // now, so that link needs to land here with the clip already picked
  // rather than making the tenant find it again in the list below.
  const [selectedClipId, setSelectedClipId] = useState<string | null>(
    searchParams.get("clip"),
  );

  const loadAll = useCallback(async () => {
    try {
      const [clipsRes, postsRes] = await Promise.all([
        authedFetch("/clips"),
        authedFetch("/posts/scheduled"),
      ]);
      if (!clipsRes.ok || !postsRes.ok) {
        setError("Failed to load scheduling data");
        return;
      }
      const { organizationName: orgName, clips } = (await clipsRes.json()) as {
        organizationName: string;
        clips: ReadyClip[];
      };
      const { posts } = (await postsRes.json()) as { posts: ScheduledPost[] };
      setOrganizationName(orgName);
      setReadyClips(clips);
      setPostList(posts);
    } catch (e) {
      setError(`Failed to load scheduling data: ${describeFetchError(e)}`);
    } finally {
      setLoading(false);
    }
  }, [authedFetch]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  async function handleRename(clipId: string, title: string) {
    try {
      const res = await authedFetch(`/clips/${clipId}`, {
        method: "PATCH",
        body: JSON.stringify({ title }),
      });
      if (!res.ok) {
        setError("Failed to rename clip");
        return;
      }
      const { clip } = (await res.json()) as { clip: ReadyClip };
      setReadyClips((prev) =>
        prev.map((c) => (c.id === clipId ? { ...c, title: clip.title } : c)),
      );
    } catch (e) {
      setError(`Failed to rename clip: ${describeFetchError(e)}`);
    }
  }

  async function handleCancel(id: string) {
    if (!window.confirm("Cancel this scheduled post?")) return;
    setCancellingId(id);
    setError(null);
    try {
      const res = await authedFetch(`/posts/${id}`, { method: "DELETE" });
      if (!res.ok) {
        setError("Failed to cancel post");
        return;
      }
      setPostList((prev) => prev.filter((p) => p.id !== id));
    } catch (e) {
      setError(`Failed to cancel post: ${describeFetchError(e)}`);
    } finally {
      setCancellingId(null);
    }
  }

  const selectedClip = readyClips.find((c) => c.id === selectedClipId);
  const selectedClipVideoMetadata: VideoMetadata | null = selectedClip
    ? {
        recordedAt: selectedClip.recordedAt
          ? new Date(selectedClip.recordedAt)
          : null,
        deviceModel: selectedClip.deviceModel,
        venueName: selectedClip.venueName,
        cityName: selectedClip.cityName,
      }
    : null;

  return (
    <main style={{ maxWidth: 1160, margin: "0 auto", padding: "24px" }}>
      <DashboardTabs />
      <h1>Scheduling</h1>
      <p style={{ marginTop: "1rem", color: "var(--muted)" }}>
        Every rendered clip across your videos, in one place — pick one below to
        publish or schedule it.
      </p>

      {error && (
        <p role="alert" style={{ marginTop: "1rem" }}>
          {error}
        </p>
      )}

      {!loading && selectedClip && selectedClipVideoMetadata && (
        <div style={{ marginTop: "2rem" }}>
          <h2>
            Scheduling: {clipTitle(selectedClip)} (
            {formatTime(selectedClip.startSec)} –{" "}
            {formatTime(selectedClip.endSec)})
          </h2>
          <div style={{ marginTop: "1rem" }}>
            <Scheduler
              clipId={selectedClip.id}
              videoTitle={clipTitle(selectedClip)}
              organizationName={organizationName}
              videoMetadata={selectedClipVideoMetadata}
              clipDurationSec={selectedClip.clipDurationSec}
            />
          </div>
          <button
            type="button"
            onClick={() => setSelectedClipId(null)}
            style={{ marginTop: "0.75rem" }}
          >
            Choose a different clip
          </button>
        </div>
      )}

      {!loading && (
        <div style={{ marginTop: "2rem" }}>
          <h2>Rendered clips</h2>
          {readyClips.length === 0 ? (
            <p style={{ color: "var(--muted)" }}>
              No rendered clips yet — render a clip from its video page first.
            </p>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "2px solid #333" }}>
                  <th style={{ ...TABLE_HEADER_STYLE, textAlign: "left" }}>
                    Title
                  </th>
                  <th style={{ ...TABLE_HEADER_STYLE, textAlign: "left" }}>
                    Clip
                  </th>
                  <th style={{ ...TABLE_HEADER_STYLE, textAlign: "left" }}>
                    Reasoning
                  </th>
                  <th style={{ ...TABLE_HEADER_STYLE, textAlign: "left" }}>
                    Manage
                  </th>
                </tr>
              </thead>
              <tbody>
                {readyClips.map((clip, index) => (
                  <tr
                    key={clip.id}
                    style={{
                      background:
                        index % 2 === 1 ? "var(--surface-raised)" : "none",
                      borderBottom: "1px solid #333",
                    }}
                  >
                    <td style={{ padding: "0.5rem 0.75rem" }}>
                      <input
                        key={`title-${clip.id}-${clip.title}`}
                        type="text"
                        defaultValue={clipTitle(clip)}
                        placeholder="Untitled recording"
                        onBlur={(e) => {
                          if (e.target.value.trim() === clipTitle(clip)) return;
                          void handleRename(clip.id, e.target.value);
                        }}
                        aria-label="Clip title"
                        style={{
                          width: "100%",
                          background: "transparent",
                          border: "1px solid transparent",
                          borderRadius: 4,
                          padding: "0.25rem 0.4rem",
                          font: "inherit",
                          color: "inherit",
                        }}
                        onFocus={(e) => {
                          e.target.style.borderColor = "var(--border)";
                        }}
                      />
                    </td>
                    <td
                      style={{
                        padding: "0.5rem 0.75rem",
                        fontVariantNumeric: "tabular-nums",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {formatTime(clip.startSec)} – {formatTime(clip.endSec)}
                    </td>
                    <td
                      style={{
                        padding: "0.5rem 0.75rem",
                        fontSize: "0.9em",
                        opacity: 0.8,
                      }}
                    >
                      {clip.aiReason ?? "Manually adjusted clip"}
                    </td>
                    <td style={{ padding: "0.5rem 0.75rem" }}>
                      <button
                        type="button"
                        disabled={clip.id === selectedClipId}
                        onClick={() => setSelectedClipId(clip.id)}
                      >
                        {clip.id === selectedClipId
                          ? "Selected"
                          : "Publish / Schedule"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {!loading && (
        <div style={{ marginTop: "2rem" }}>
          <h2>Already scheduled</h2>
          {postList.length === 0 ? (
            <p style={{ color: "var(--muted)" }}>Nothing scheduled yet.</p>
          ) : (
            <ul style={{ listStyle: "none", padding: 0 }}>
              {postList.map((post) => (
                <li
                  key={post.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.75rem",
                    padding: "0.75rem 0",
                    borderBottom: "1px solid #333",
                  }}
                >
                  <span style={{ flex: 1 }}>
                    <strong>{post.videoTitle ?? "Untitled video"}</strong>
                    <span
                      style={{
                        marginLeft: "0.5rem",
                        fontSize: "0.85em",
                        opacity: 0.7,
                        textTransform: "capitalize",
                      }}
                    >
                      {post.platform}
                    </span>
                  </span>
                  <span style={{ fontSize: "0.85em", color: "var(--muted)" }}>
                    {new Date(post.scheduledAt).toLocaleString()}
                  </span>
                  <button
                    type="button"
                    disabled={cancellingId === post.id}
                    onClick={() => void handleCancel(post.id)}
                  >
                    {cancellingId === post.id ? "Cancelling…" : "Cancel"}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </main>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { DashboardTabs } from "../dashboard-tabs";
import { describeFetchError } from "../fetch-error";
import { useAuthedFetch } from "../use-authed-fetch";

interface ScheduledPost {
  id: string;
  clipId: string | null;
  scheduledAt: string;
  platform: string;
  videoTitle: string | null;
}

export default function ScheduledPage() {
  const authedFetch = useAuthedFetch();
  const [postList, setPostList] = useState<ScheduledPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const loadScheduled = useCallback(async () => {
    try {
      const res = await authedFetch("/posts/scheduled");
      if (!res.ok) {
        setError("Failed to load scheduled posts");
        return;
      }
      const { posts: rows } = (await res.json()) as { posts: ScheduledPost[] };
      setPostList(rows);
    } catch (e) {
      setError(`Failed to load scheduled posts: ${describeFetchError(e)}`);
    } finally {
      setLoading(false);
    }
  }, [authedFetch]);

  useEffect(() => {
    void loadScheduled();
  }, [loadScheduled]);

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

  return (
    <main style={{ maxWidth: 1160, margin: "0 auto", padding: "24px" }}>
      <DashboardTabs />
      <h1>Scheduled posts</h1>
      <p style={{ marginTop: "1rem", color: "var(--muted)" }}>
        Clips queued to publish later. Schedule one from a clip&rsquo;s publish
        panel.
      </p>

      {error && (
        <p role="alert" style={{ marginTop: "1rem" }}>
          {error}
        </p>
      )}

      {!loading && (
        <div style={{ marginTop: "2rem" }}>
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

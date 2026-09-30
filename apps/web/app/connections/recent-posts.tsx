"use client";

import { useState } from "react";
import { describeFetchError } from "../fetch-error";
import { useAuthedFetch } from "../use-authed-fetch";

// apps/api's GET /social/connections/:id/recent-posts serves this from
// two different sources depending on platform — see that route's own
// comment for why — but returns the same shape either way, so this
// component doesn't need to know which one it got.
interface RecentPost {
  id: string;
  message?: string;
  createdTime: string;
  permalinkUrl?: string;
  fullPicture?: string;
}

export function RecentPosts({ connectionId }: { connectionId: string }) {
  const authedFetch = useAuthedFetch();
  const [open, setOpen] = useState(false);
  const [posts, setPosts] = useState<RecentPost[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setOpen(true);
    if (posts !== null || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await authedFetch(
        `/social/connections/${connectionId}/recent-posts`,
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        setError(body?.error ?? "Failed to load recent posts");
        return;
      }
      const { posts: rows } = (await res.json()) as {
        posts: RecentPost[];
      };
      setPosts(rows);
    } catch (e) {
      setError(`Failed to load recent posts: ${describeFetchError(e)}`);
    } finally {
      setLoading(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => void load()}
        style={{
          fontSize: "0.85em",
          background: "none",
          border: "1px solid var(--border)",
          borderRadius: 4,
          padding: "0.3rem 0.6rem",
          cursor: "pointer",
          color: "var(--muted)",
        }}
      >
        Show recent posts
      </button>
    );
  }

  return (
    <div
      style={{
        width: "100%",
        marginTop: "0.5rem",
        padding: "0.75rem",
        background: "var(--surface-raised)",
        borderRadius: 6,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <strong style={{ fontSize: "0.9em" }}>Recent posts</strong>
        <button
          type="button"
          onClick={() => setOpen(false)}
          style={{
            fontSize: "0.85em",
            background: "none",
            border: "none",
            color: "var(--muted)",
            cursor: "pointer",
          }}
        >
          Hide
        </button>
      </div>

      {loading && (
        <p style={{ fontSize: "0.85em", color: "var(--muted)" }}>Loading…</p>
      )}
      {error && (
        <p role="alert" style={{ fontSize: "0.85em" }}>
          {error}
        </p>
      )}
      {posts && posts.length === 0 && (
        <p style={{ fontSize: "0.85em", color: "var(--muted)" }}>
          No posts yet.
        </p>
      )}
      {posts && posts.length > 0 && (
        <ul
          style={{
            listStyle: "none",
            padding: 0,
            marginTop: "0.5rem",
            display: "flex",
            flexDirection: "column",
            gap: "0.6rem",
          }}
        >
          {posts.map((post) => (
            <li key={post.id} style={{ display: "flex", gap: "0.6rem" }}>
              {post.fullPicture && (
                <img
                  src={post.fullPicture}
                  alt=""
                  width={48}
                  height={48}
                  style={{
                    objectFit: "cover",
                    borderRadius: 4,
                    flexShrink: 0,
                  }}
                />
              )}
              <div style={{ fontSize: "0.85em" }}>
                <p style={{ margin: 0 }}>{post.message ?? "(no text)"}</p>
                {post.permalinkUrl && (
                  <a
                    href={post.permalinkUrl}
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: "var(--muted)" }}
                  >
                    {new Date(post.createdTime).toLocaleString()}
                  </a>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

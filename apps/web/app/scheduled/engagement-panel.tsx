"use client";

import { useCallback, useState } from "react";
import { describeFetchError } from "../fetch-error";
import { useAuthedFetch } from "../use-authed-fetch";

// Comments and basic insights for one published Facebook/Instagram post,
// read live from the platform via apps/api's GET /posts/:id/engagement,
// with replies posted back as the Page / Instagram account.
interface EngagementComment {
  id: string;
  author: string | null;
  message: string;
  createdTime: string;
  replies: EngagementComment[];
}

interface Engagement {
  platform: "facebook" | "instagram";
  comments: EngagementComment[];
  stats: { label: string; value: number }[];
  statsError?: string;
}

const PLATFORM_NAME = { facebook: "Facebook", instagram: "Instagram" };

const SMALL_BUTTON = {
  fontSize: "0.85em",
  background: "none",
  border: "1px solid var(--border)",
  borderRadius: 4,
  padding: "0.3rem 0.6rem",
  cursor: "pointer",
  color: "var(--muted)",
} as const;

export function EngagementPanel({ postId }: { postId: string }) {
  const authedFetch = useAuthedFetch();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Engagement | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authedFetch(`/posts/${postId}/engagement`);
      const body = (await res.json().catch(() => null)) as
        (Engagement & { error?: string }) | null;
      if (!res.ok || !body) {
        setError(body?.error ?? "Failed to load comments");
        return;
      }
      setData(body);
    } catch (e) {
      setError(`Failed to load comments: ${describeFetchError(e)}`);
    } finally {
      setLoading(false);
    }
  }, [authedFetch, postId]);

  async function sendReply(commentId: string) {
    setSending(true);
    setError(null);
    try {
      const res = await authedFetch(
        `/posts/${postId}/comments/${commentId}/replies`,
        { method: "POST", body: JSON.stringify({ message: replyText }) },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        setError(body?.error ?? "Failed to send reply");
        return;
      }
      setReplyingTo(null);
      setReplyText("");
      await load();
    } catch (e) {
      setError(`Failed to send reply: ${describeFetchError(e)}`);
    } finally {
      setSending(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        title="See comments and views for this post, and reply to comments"
        onClick={() => {
          setOpen(true);
          if (!data) void load();
        }}
        style={SMALL_BUTTON}
      >
        Comments &amp; insights
      </button>
    );
  }

  const platformName = data ? PLATFORM_NAME[data.platform] : "";

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
          gap: "0.5rem",
        }}
      >
        <strong style={{ fontSize: "0.9em" }}>
          Comments &amp; insights{platformName && ` from ${platformName}`}
        </strong>
        <span style={{ display: "flex", gap: "0.5rem" }}>
          <button
            type="button"
            title="Load the latest comments and numbers again"
            onClick={() => void load()}
            disabled={loading}
            style={SMALL_BUTTON}
          >
            Refresh
          </button>
          <button
            type="button"
            title="Close this panel"
            onClick={() => setOpen(false)}
            style={{ ...SMALL_BUTTON, border: "none" }}
          >
            Hide
          </button>
        </span>
      </div>

      {loading && (
        <p style={{ fontSize: "0.85em", color: "var(--muted)" }}>Loading…</p>
      )}
      {error && (
        <p role="alert" style={{ fontSize: "0.85em" }}>
          {error}
        </p>
      )}

      {data && (
        <>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "1.25rem",
              margin: "0.75rem 0",
              fontSize: "0.9em",
            }}
          >
            {data.stats.length > 0 ? (
              data.stats.map((s) => (
                <span key={s.label}>
                  <span style={{ color: "var(--muted)" }}>{s.label}</span>{" "}
                  <strong>{s.value.toLocaleString()}</strong>
                </span>
              ))
            ) : (
              <span style={{ color: "var(--muted)" }}>
                Views and reach aren&apos;t available yet — {platformName} can
                take a little while after publishing.
              </span>
            )}
          </div>

          {data.comments.length === 0 ? (
            <p style={{ fontSize: "0.85em", color: "var(--muted)" }}>
              No comments yet.
            </p>
          ) : (
            <ul
              style={{
                listStyle: "none",
                padding: 0,
                margin: 0,
                display: "flex",
                flexDirection: "column",
                gap: "0.75rem",
              }}
            >
              {data.comments.map((comment) => (
                <li key={comment.id} style={{ fontSize: "0.85em" }}>
                  <CommentLine comment={comment} />
                  {comment.replies.length > 0 && (
                    <ul
                      style={{
                        listStyle: "none",
                        padding: "0 0 0 1rem",
                        margin: "0.35rem 0 0",
                        borderLeft: "2px solid var(--border)",
                        display: "flex",
                        flexDirection: "column",
                        gap: "0.35rem",
                      }}
                    >
                      {comment.replies.map((reply) => (
                        <li key={reply.id}>
                          <CommentLine comment={reply} />
                        </li>
                      ))}
                    </ul>
                  )}
                  {replyingTo === comment.id ? (
                    <div
                      style={{
                        display: "flex",
                        gap: "0.5rem",
                        marginTop: "0.4rem",
                      }}
                    >
                      <input
                        type="text"
                        value={replyText}
                        maxLength={2000}
                        placeholder={`Reply as your ${platformName} account…`}
                        aria-label="Reply text"
                        onChange={(e) => setReplyText(e.target.value)}
                        style={{ flex: 1 }}
                      />
                      <button
                        type="button"
                        title={`Post this reply on ${platformName}`}
                        disabled={sending || replyText.trim().length === 0}
                        onClick={() => void sendReply(comment.id)}
                      >
                        {sending ? "Sending…" : "Send"}
                      </button>
                      <button
                        type="button"
                        title="Discard this reply"
                        onClick={() => {
                          setReplyingTo(null);
                          setReplyText("");
                        }}
                        style={{ ...SMALL_BUTTON, border: "none" }}
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      title={`Reply to this comment on ${platformName}`}
                      onClick={() => {
                        setReplyingTo(comment.id);
                        setReplyText("");
                      }}
                      style={{
                        ...SMALL_BUTTON,
                        border: "none",
                        padding: "0.2rem 0",
                      }}
                    >
                      Reply
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function CommentLine({ comment }: { comment: EngagementComment }) {
  return (
    <p style={{ margin: 0 }}>
      <strong>{comment.author ?? "Someone"}</strong> {comment.message}{" "}
      <span style={{ color: "var(--muted)", fontSize: "0.9em" }}>
        {new Date(comment.createdTime).toLocaleString()}
      </span>
    </p>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { sourceVideos } from "@scenestealer/db";
import { describeFetchError } from "../../fetch-error";
import { useAuthedFetch } from "../../use-authed-fetch";

type Status = (typeof sourceVideos.$inferSelect)["status"];

const POLL_INTERVAL_MS = 5000;

export function AnalyzeControl({
  sourceVideoId,
  initialStatus,
  initialError,
}: {
  sourceVideoId: string;
  initialStatus: Status;
  initialError: string | null;
}) {
  const authedFetch = useAuthedFetch();
  const router = useRouter();
  const [status, setStatus] = useState(initialStatus);
  const [error, setError] = useState(initialError);
  const [busy, setBusy] = useState(false);
  // Tracks whether this mount already owns the in-flight POST /analyze
  // call — the polling effect below only needs to run when analysis is
  // "analyzing" from a page load/reload, not while this same click is
  // already awaiting its own response.
  const owningRequest = useRef(false);

  useEffect(() => {
    if (status !== "analyzing" || owningRequest.current) return;
    let cancelled = false;
    const interval = setInterval(() => {
      void authedFetch(`/videos/${sourceVideoId}/status`)
        .then((res) => (res.ok ? res.json() : null))
        .then(
          (body: { status: Status; analysisError: string | null } | null) => {
            if (cancelled || !body || body.status === "analyzing") return;
            setStatus(body.status);
            setError(body.analysisError);
            router.refresh();
          },
        )
        .catch(() => {
          // Transient — keep polling.
        });
    }, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [status, sourceVideoId, authedFetch, router]);

  async function handleAnalyze() {
    setBusy(true);
    setError(null);
    setStatus("analyzing");
    owningRequest.current = true;
    try {
      const res = await authedFetch(`/videos/${sourceVideoId}/analyze`, {
        method: "POST",
      });
      const body = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!res.ok) {
        setStatus("failed");
        setError(body?.error ?? "Analysis failed");
        return;
      }
      setStatus("analyzed");
      router.refresh();
    } catch (e) {
      setStatus("failed");
      setError(`Analysis failed: ${describeFetchError(e)}`);
    } finally {
      owningRequest.current = false;
      setBusy(false);
    }
  }

  if (status === "analyzing") {
    return (
      <div
        style={{
          marginTop: "1rem",
          padding: "0.75rem",
          border: "1px solid var(--border)",
          borderRadius: 8,
          background: "var(--surface-raised)",
        }}
      >
        <strong>Processing your recording…</strong>
        <p style={{ marginTop: "0.25rem", color: "var(--muted)" }}>
          This can take a few minutes for longer shows — feel free to leave this
          page, it&rsquo;ll keep running.
        </p>
      </div>
    );
  }

  return (
    <div style={{ marginTop: "1rem" }}>
      {error && (
        <p role="alert" style={{ marginBottom: "0.5rem" }}>
          {error}
        </p>
      )}
      {status === "analyzed" ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => void handleAnalyze()}
        >
          {busy ? "Starting…" : "Re-run analysis"}
        </button>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={() => void handleAnalyze()}
        >
          {busy
            ? "Starting…"
            : status === "failed"
              ? "Retry generating clips"
              : "Generate clips"}
        </button>
      )}
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { sourceVideos } from "@scenestealer/db";
import { describeFetchError } from "../../fetch-error";
import { useAuthedFetch } from "../../use-authed-fetch";

type Status = (typeof sourceVideos.$inferSelect)["status"];

const POLL_INTERVAL_MS = 5000;

function formatMinutes(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

// Deliberately a range, not a single number — apps/api's estimate is a
// rolling average across a still-small, still-growing set of real jobs
// (see GET /:id/status), not a precise prediction. ±30% keeps this
// honest about that uncertainty rather than implying more confidence
// than the underlying data supports (see ROADMAP.md's "Cold-start
// honesty" note).
function formatEstimate(
  durationSec: number | null,
  estimatedTotalSeconds: number | null,
): string {
  if (estimatedTotalSeconds != null) {
    const low = formatMinutes(estimatedTotalSeconds * 0.7);
    const high = formatMinutes(estimatedTotalSeconds * 1.3);
    return `Usually takes ${low}–${high} for a recording this length.`;
  }
  if (durationSec != null) {
    return "Estimating how long this will take…";
  }
  return "This can take a few minutes for longer shows.";
}

export function AnalyzeControl({
  sourceVideoId,
  initialStatus,
  initialError,
  initialDurationSec,
}: {
  sourceVideoId: string;
  initialStatus: Status;
  initialError: string | null;
  initialDurationSec: number | null;
}) {
  const authedFetch = useAuthedFetch();
  const router = useRouter();
  const [status, setStatus] = useState(initialStatus);
  const [error, setError] = useState(initialError);
  const [busy, setBusy] = useState(false);
  // durationSec isn't known until partway through the pipeline (ffprobe
  // runs after the video's downloaded — see apps/worker/src/analyze.ts),
  // so this starts null even mid-"analyzing" and fills in from a later
  // poll. estimatedTotalSeconds is a rolling average from real completed
  // jobs (see apps/api's GET /:id/status) — also starts null until
  // enough of those exist; shown only as a rough range, never false
  // precision (see ROADMAP.md).
  const [durationSec, setDurationSec] = useState(initialDurationSec);
  const [estimatedTotalSeconds, setEstimatedTotalSeconds] = useState<
    number | null
  >(null);
  // Whether this mount owns an in-flight POST /analyze call — state,
  // not a ref: POST /analyze now only enqueues the job (see
  // apps/api's routes/videos.ts) and returns almost immediately, so
  // this flips back to false while status is still "analyzing", and
  // the effect below needs to actually re-run at that point to start
  // polling — a ref changing wouldn't do that on its own.
  const [owningRequest, setOwningRequest] = useState(false);

  useEffect(() => {
    if (status !== "analyzing" || owningRequest) return;
    let cancelled = false;
    const interval = setInterval(() => {
      void authedFetch(`/videos/${sourceVideoId}/status`)
        .then((res) => (res.ok ? res.json() : null))
        .then(
          (
            body: {
              status: Status;
              analysisError: string | null;
              durationSec: number | null;
              estimatedTotalSeconds: number | null;
            } | null,
          ) => {
            if (cancelled || !body) return;
            setDurationSec(body.durationSec);
            setEstimatedTotalSeconds(body.estimatedTotalSeconds);
            if (body.status === "analyzing") return;
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
  }, [status, owningRequest, sourceVideoId, authedFetch, router]);

  async function handleAnalyze() {
    setBusy(true);
    setError(null);
    setStatus("analyzing");
    setDurationSec(null);
    setEstimatedTotalSeconds(null);
    setOwningRequest(true);
    try {
      const res = await authedFetch(`/videos/${sourceVideoId}/analyze`, {
        method: "POST",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        setStatus("failed");
        setError(body?.error ?? "Failed to start analysis");
        return;
      }
      // Enqueued, not finished — analysis itself now runs out-of-band
      // (see apps/api's routes/videos.ts), so the polling effect above
      // (re-armed once owningRequest flips back to false below) is
      // what picks up the real outcome.
    } catch (e) {
      setStatus("failed");
      setError(`Failed to start analysis: ${describeFetchError(e)}`);
    } finally {
      setOwningRequest(false);
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
          {formatEstimate(durationSec, estimatedTotalSeconds)} Feel free to
          leave this page, it&rsquo;ll keep running.
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

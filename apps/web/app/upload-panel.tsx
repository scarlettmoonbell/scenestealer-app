"use client";

import { useCallback, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { describeFetchError } from "./fetch-error";

const API_URL = process.env.NEXT_PUBLIC_API_URL;

type Status = "idle" | "uploading" | "done" | "error";

// R2 (and S3) reject a single PUT over 5 GiB outright — confirmed for
// real (2026-09-07): a 5.38GB test upload got a flat HTTP 400. Anything
// at or above this switches to the multipart path below; kept a little
// under the real 5 GiB (5 * 1024**3) cap as safety margin rather than
// cutting it exactly at the boundary.
const MULTIPART_THRESHOLD_BYTES = 4.5 * 1024 ** 3;
// R2 multipart parts must be 5 MiB-5 GiB (except the last); 100MiB
// keeps a 5GB+ file to a reasonable part count (~54 for 5.38GB) well
// under the 10,000-part ceiling, without making a single failed part
// too expensive to retry.
const PART_SIZE_BYTES = 100 * 1024 ** 2;
// Parts in flight at once — same instinct as downloadFromR2ToFile's
// PARALLEL_DOWNLOAD_CHUNKS (not bound by any one connection's own
// congestion-control ceiling), kept lower than that constant's 6 since
// client upload bandwidth is more often the actual constraint than
// download bandwidth is.
const PART_UPLOAD_CONCURRENCY = 4;
const MAX_PART_RETRIES = 3;

async function readError(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    return body.error ?? fallback;
  } catch {
    return fallback;
  }
}

/**
 * Uploads a part with retries, signing a fresh URL each attempt (a
 * presigned URL is single-use in intent even if R2 doesn't literally
 * enforce that — re-signing is cheap and avoids relying on reuse
 * semantics that were never the point of presigning).
 */
async function uploadPartWithRetry(
  file: File,
  authHeaders: Record<string, string>,
  r2Key: string,
  uploadId: string,
  partNumber: number,
  start: number,
  end: number,
): Promise<{ partNumber: number; etag: string }> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_PART_RETRIES; attempt++) {
    try {
      const signRes = await fetch(`${API_URL}/uploads/multipart/sign-part`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ r2Key, uploadId, partNumber }),
      });
      if (!signRes.ok) {
        throw new Error(
          await readError(signRes, `Failed to sign part ${partNumber}`),
        );
      }
      const { url } = (await signRes.json()) as { url: string };

      const putRes = await fetch(url, {
        method: "PUT",
        body: file.slice(start, end),
      });
      if (!putRes.ok) {
        throw new Error(
          `Storage rejected part ${partNumber} (HTTP ${putRes.status})`,
        );
      }
      const etag = putRes.headers.get("ETag");
      if (!etag) {
        throw new Error(
          `Part ${partNumber} uploaded but no ETag came back — R2's CORS ` +
            `config may not be exposing it to the browser`,
        );
      }
      return { partNumber, etag };
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(`Part ${partNumber} failed after ${MAX_PART_RETRIES} attempts`);
}

/**
 * Multipart path for anything at/over MULTIPART_THRESHOLD_BYTES — see
 * that constant's comment for why the single-PUT path can't handle
 * these. Parts upload with bounded concurrency (a simple pull-based
 * worker pool, not a library) rather than one at a time, matching
 * downloadFromR2ToFile's own parallel-chunk precedent on the read side.
 */
async function uploadFileMultipart(
  file: File,
  authHeaders: Record<string, string>,
  onProgress: (fraction: number) => void,
): Promise<string> {
  const createRes = await fetch(`${API_URL}/uploads/multipart/create`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ filename: file.name, contentType: file.type }),
  });
  if (!createRes.ok) {
    throw new Error(
      await readError(createRes, "Failed to start a multipart upload"),
    );
  }
  const { r2Key, uploadId } = (await createRes.json()) as {
    r2Key: string;
    uploadId: string;
  };

  const partCount = Math.ceil(file.size / PART_SIZE_BYTES);
  const parts: { partNumber: number; etag: string }[] = [];
  let bytesDone = 0;
  let nextPartNumber = 1;

  async function worker() {
    while (nextPartNumber <= partCount) {
      const partNumber = nextPartNumber++;
      const start = (partNumber - 1) * PART_SIZE_BYTES;
      const end = Math.min(start + PART_SIZE_BYTES, file.size);
      const part = await uploadPartWithRetry(
        file,
        authHeaders,
        r2Key,
        uploadId,
        partNumber,
        start,
        end,
      );
      parts.push(part);
      bytesDone += end - start;
      onProgress(bytesDone / file.size);
    }
  }

  try {
    await Promise.all(
      Array.from({ length: Math.min(PART_UPLOAD_CONCURRENCY, partCount) }, () =>
        worker(),
      ),
    );
  } catch (e) {
    // Best-effort — the real failure is `e` regardless of whether this
    // lands; see abortMultipartUpload's own comment (apps/api/src/r2.ts).
    void fetch(`${API_URL}/uploads/multipart/abort`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ r2Key, uploadId }),
    }).catch(() => {});
    throw e;
  }

  const completeRes = await fetch(`${API_URL}/uploads/multipart/complete`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ r2Key, uploadId, parts }),
  });
  if (!completeRes.ok) {
    throw new Error(
      await readError(completeRes, "Failed to finish the multipart upload"),
    );
  }

  return r2Key;
}

export function UploadPanel() {
  const { getToken } = useAuth();
  const router = useRouter();
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [uploadedTitle, setUploadedTitle] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);

  const handleFile = useCallback(
    async (file: File) => {
      setStatus("uploading");
      setError(null);
      setProgress(file.size >= MULTIPART_THRESHOLD_BYTES ? 0 : null);

      let authHeaders: { "Content-Type": string; Authorization: string };
      try {
        const token = await getToken();
        authHeaders = {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        };
      } catch (e) {
        setError(`Couldn't get an auth token: ${describeFetchError(e)}`);
        setStatus("error");
        return;
      }

      let r2Key: string;
      if (file.size >= MULTIPART_THRESHOLD_BYTES) {
        try {
          r2Key = await uploadFileMultipart(file, authHeaders, setProgress);
        } catch (e) {
          setError(`Uploading to storage failed: ${describeFetchError(e)}`);
          setStatus("error");
          return;
        }
      } else {
        let uploadUrl: string;
        try {
          const presignRes = await fetch(`${API_URL}/uploads/presign`, {
            method: "POST",
            headers: authHeaders,
            body: JSON.stringify({
              filename: file.name,
              contentType: file.type,
            }),
          });
          if (!presignRes.ok) {
            throw new Error(
              await readError(presignRes, "Failed to get an upload URL"),
            );
          }
          ({ uploadUrl, r2Key } = (await presignRes.json()) as {
            uploadUrl: string;
            r2Key: string;
          });
        } catch (e) {
          setError(`Requesting an upload URL failed: ${describeFetchError(e)}`);
          setStatus("error");
          return;
        }

        try {
          const putRes = await fetch(uploadUrl, {
            method: "PUT",
            body: file,
          });
          if (!putRes.ok) {
            throw new Error(
              `Storage rejected the upload (HTTP ${putRes.status})`,
            );
          }
        } catch (e) {
          setError(`Uploading to storage failed: ${describeFetchError(e)}`);
          setStatus("error");
          return;
        }
      }

      try {
        const completeRes = await fetch(`${API_URL}/uploads/complete`, {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({ r2Key, title: file.name }),
        });
        if (!completeRes.ok) {
          throw new Error(
            await readError(completeRes, "Failed to record the upload"),
          );
        }
      } catch (e) {
        setError(`Recording the upload failed: ${describeFetchError(e)}`);
        setStatus("error");
        return;
      }

      setUploadedTitle(file.name);
      setStatus("done");
      // VideoList is a Server Component reading the DB directly at
      // render time — this client-side upload has no other way to
      // make it show the new video without a full page reload.
      router.refresh();
    },
    [getToken, router],
  );

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLLabelElement>) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file) void handleFile(file);
    },
    [handleFile],
  );

  const onFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) void handleFile(file);
    },
    [handleFile],
  );

  return (
    <section>
      <label
        onDrop={onDrop}
        onDragOver={(e) => e.preventDefault()}
        style={{
          display: "block",
          border: "2px dashed #888",
          borderRadius: 8,
          padding: "3rem 1rem",
          textAlign: "center",
          cursor: status === "uploading" ? "wait" : "pointer",
        }}
      >
        <input
          type="file"
          accept="video/*"
          onChange={onFileInput}
          disabled={status === "uploading"}
          style={{ display: "none" }}
        />
        Drop a show recording here, or click to choose a file
      </label>
      {status === "uploading" && (
        <p>
          {progress === null
            ? "Uploading…"
            : `Uploading… ${Math.round(progress * 100)}%`}
        </p>
      )}
      {status === "done" && <p>Uploaded: {uploadedTitle}</p>}
      {status === "error" && <p role="alert">{error}</p>}
    </section>
  );
}

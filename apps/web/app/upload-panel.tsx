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
// R2 multipart parts must be 5 MiB-5 GiB (except the last); 32MiB keeps
// a 5GB+ file to a reasonable part count (~172 for 5.38GB) well under
// the 10,000-part ceiling. Deliberately smaller than a first version of
// this (100MiB) — confirmed for real (2026-09-07): at 100MiB, a slower
// home upload connection could go many minutes between progress ticks
// (progress only advances on part *completion*, not mid-part — see
// putPartWithXhrProgress below, which now reports continuously within
// a part too, but a smaller part size still bounds the worst case where
// a single failed part has to restart from zero).
const PART_SIZE_BYTES = 32 * 1024 ** 2;
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

// Clerk session tokens are short-lived (~60s) and meant to be re-fetched
// per call, not cached — getToken() itself handles refreshing under the
// hood. A multipart upload of a multi-GB file can easily run for
// minutes across dozens of parts, so every function below takes this
// (not a precomputed headers object) and calls it fresh immediately
// before each request. Confirmed for real (2026-09-07): reusing one
// getToken() result across an entire upload's worth of requests, as an
// earlier version of this file did, made every part-sign call after the
// first ~60s fail with 401 — the upload looked "stuck at 0%" because no
// part ever got far enough to actually move any bytes.
type GetAuthHeaders = () => Promise<{
  "Content-Type": string;
  Authorization: string;
}>;

/**
 * PUTs a part via XMLHttpRequest rather than fetch — fetch has no
 * upload-progress event at all, which is exactly why a first version of
 * this file could only advance the progress bar once per whole part
 * (see PART_SIZE_BYTES's comment). `xhr.upload.onprogress` reports
 * continuously as the browser actually sends bytes, so the caller can
 * show real progress within a part, not just between them.
 */
function putPartWithXhrProgress(
  url: string,
  blob: Blob,
  onBytes: (loaded: number) => void,
): Promise<{ status: number; etag: string | null }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onBytes(e.loaded);
    };
    xhr.onload = () =>
      resolve({ status: xhr.status, etag: xhr.getResponseHeader("ETag") });
    xhr.onerror = () =>
      reject(new Error("Network error uploading part to storage"));
    xhr.send(blob);
  });
}

/**
 * Uploads a part with retries, signing a fresh URL each attempt (a
 * presigned URL is single-use in intent even if R2 doesn't literally
 * enforce that — re-signing is cheap and avoids relying on reuse
 * semantics that were never the point of presigning). onBytes reports
 * this part's own live progress (0 at the start of each attempt, so a
 * retry doesn't double-count bytes from a failed prior attempt).
 */
async function uploadPartWithRetry(
  file: File,
  getAuthHeaders: GetAuthHeaders,
  r2Key: string,
  uploadId: string,
  partNumber: number,
  start: number,
  end: number,
  onBytes: (loaded: number) => void,
): Promise<{ partNumber: number; etag: string }> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_PART_RETRIES; attempt++) {
    try {
      onBytes(0);
      const signRes = await fetch(`${API_URL}/uploads/multipart/sign-part`, {
        method: "POST",
        headers: await getAuthHeaders(),
        body: JSON.stringify({ r2Key, uploadId, partNumber }),
      });
      if (!signRes.ok) {
        throw new Error(
          await readError(signRes, `Failed to sign part ${partNumber}`),
        );
      }
      const { url } = (await signRes.json()) as { url: string };

      const { status, etag } = await putPartWithXhrProgress(
        url,
        file.slice(start, end),
        onBytes,
      );
      if (status < 200 || status >= 300) {
        throw new Error(`Storage rejected part ${partNumber} (HTTP ${status})`);
      }
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
  getAuthHeaders: GetAuthHeaders,
  onProgress: (fraction: number) => void,
): Promise<string> {
  const createRes = await fetch(`${API_URL}/uploads/multipart/create`, {
    method: "POST",
    headers: await getAuthHeaders(),
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
  // Bytes actually sent per part slot (including in-flight, not just
  // completed) — summed on every XHR progress tick, so the bar moves
  // continuously as any of the concurrent parts sends data, not just
  // when a whole part finishes.
  const partBytesSent = new Array<number>(partCount).fill(0);
  function reportProgress() {
    const total = partBytesSent.reduce((a, b) => a + b, 0);
    onProgress(total / file.size);
  }
  let nextPartNumber = 1;

  async function worker() {
    while (nextPartNumber <= partCount) {
      const partNumber = nextPartNumber++;
      const start = (partNumber - 1) * PART_SIZE_BYTES;
      const end = Math.min(start + PART_SIZE_BYTES, file.size);
      const part = await uploadPartWithRetry(
        file,
        getAuthHeaders,
        r2Key,
        uploadId,
        partNumber,
        start,
        end,
        (loaded) => {
          partBytesSent[partNumber - 1] = loaded;
          reportProgress();
        },
      );
      parts.push(part);
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
    void getAuthHeaders()
      .then((headers) =>
        fetch(`${API_URL}/uploads/multipart/abort`, {
          method: "POST",
          headers,
          body: JSON.stringify({ r2Key, uploadId }),
        }),
      )
      .catch(() => {});
    throw e;
  }

  const completeRes = await fetch(`${API_URL}/uploads/multipart/complete`, {
    method: "POST",
    headers: await getAuthHeaders(),
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

  // Fetched fresh right before every authenticated call rather than
  // once and cached — see the GetAuthHeaders comment above for the real
  // 401-storm this caused when a single upfront token was reused across
  // an entire multi-minute multipart upload.
  const getAuthHeaders = useCallback(async () => {
    const token = await getToken();
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    };
  }, [getToken]);

  const handleFile = useCallback(
    async (file: File) => {
      setStatus("uploading");
      setError(null);
      setProgress(file.size >= MULTIPART_THRESHOLD_BYTES ? 0 : null);

      try {
        await getAuthHeaders();
      } catch (e) {
        setError(`Couldn't get an auth token: ${describeFetchError(e)}`);
        setStatus("error");
        return;
      }

      let r2Key: string;
      if (file.size >= MULTIPART_THRESHOLD_BYTES) {
        try {
          r2Key = await uploadFileMultipart(file, getAuthHeaders, setProgress);
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
            headers: await getAuthHeaders(),
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
          headers: await getAuthHeaders(),
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
    [getAuthHeaders, router],
  );

  // Guarding on status matters here specifically: the file <input>
  // below is disabled while uploading, which blocks the click-to-choose
  // path, but that disabled attribute does nothing for drag-and-drop —
  // the label's onDrop still fires regardless. Confirmed for real
  // (2026-09-07): a large multipart upload's progress bar only ticks
  // once a part's worth of bytes has actually gone out, which on a
  // slower connection can look like nothing is happening for a while;
  // a user who dropped the same file again during that stretch started
  // a *second*, fully concurrent multipart upload of it, halving the
  // real upload bandwidth available to each and making both look stuck
  // — visible in apps/api's logs as two separate /multipart/create
  // calls ~33s apart for the same file. onFileInput doesn't strictly
  // need this (the disabled attribute already covers it) but guards it
  // too for consistency, in case that ever changes.
  const onDrop = useCallback(
    (e: React.DragEvent<HTMLLabelElement>) => {
      e.preventDefault();
      if (status === "uploading") return;
      const file = e.dataTransfer.files[0];
      if (file) void handleFile(file);
    },
    [handleFile, status],
  );

  const onFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (status === "uploading") return;
      const file = e.target.files?.[0];
      if (file) void handleFile(file);
    },
    [handleFile, status],
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

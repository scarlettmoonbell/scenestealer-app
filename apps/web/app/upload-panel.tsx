"use client";

import { useCallback, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { describeFetchError } from "./fetch-error";

const API_URL = process.env.NEXT_PUBLIC_API_URL;

type Status = "idle" | "uploading" | "done" | "error";

async function readError(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    return body.error ?? fallback;
  } catch {
    return fallback;
  }
}

export function UploadPanel() {
  const { getToken } = useAuth();
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [uploadedTitle, setUploadedTitle] = useState<string | null>(null);

  const handleFile = useCallback(
    async (file: File) => {
      setStatus("uploading");
      setError(null);

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

      let uploadUrl: string, r2Key: string;
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
        const putRes = await fetch(uploadUrl, { method: "PUT", body: file });
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
    },
    [getToken],
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
      {status === "uploading" && <p>Uploading…</p>}
      {status === "done" && <p>Uploaded: {uploadedTitle}</p>}
      {status === "error" && <p role="alert">{error}</p>}
    </section>
  );
}

"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { describeFetchError } from "./fetch-error";
import { useAuthedFetch } from "./use-authed-fetch";

export function VideoListItem({ id, title }: { id: string; title: string }) {
  const authedFetch = useAuthedFetch();
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    if (
      !window.confirm(
        `Delete "${title}" and every clip rendered from it? This can't be undone.`,
      )
    ) {
      return;
    }
    setDeleting(true);
    setError(null);
    try {
      const res = await authedFetch(`/videos/${id}`, { method: "DELETE" });
      if (!res.ok) {
        setError("Failed to delete recording");
        setDeleting(false);
        return;
      }
      router.refresh();
    } catch (e) {
      setError(`Failed to delete recording: ${describeFetchError(e)}`);
      setDeleting(false);
    }
  }

  return (
    <li
      style={{
        padding: "0.5rem 0",
        borderBottom: "1px solid #333",
        display: "flex",
        alignItems: "center",
        gap: "0.75rem",
      }}
    >
      <Link href={`/videos/${id}`} style={{ flex: 1 }}>
        {title}
      </Link>
      {error && <span role="alert">{error}</span>}
      <button type="button" disabled={deleting} onClick={handleDelete}>
        {deleting ? "Deleting…" : "Delete"}
      </button>
    </li>
  );
}

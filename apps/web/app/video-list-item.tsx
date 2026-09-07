"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { describeFetchError } from "./fetch-error";
import { useAuthedFetch } from "./use-authed-fetch";

export function VideoListItem({
  id,
  title,
  striped,
}: {
  id: string;
  title: string;
  striped: boolean;
}) {
  const authedFetch = useAuthedFetch();
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    if (
      !window.confirm(
        `Delete "${title}"? This frees up its storage and can't be undone. ` +
          `Clips you've already rendered from it are kept — find them on the ` +
          `Scheduling page — but any not-yet-rendered clips go with it.`,
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
    <tr
      style={{ background: striped ? "var(--surface-raised)" : "transparent" }}
    >
      <td
        style={{
          padding: "0.5rem 0.75rem 0.5rem 0",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <Link href={`/videos/${id}`}>{title}</Link>
      </td>
      <td
        style={{
          padding: "0.5rem 0 0.5rem 0.75rem",
          borderBottom: "1px solid var(--border)",
          textAlign: "right",
        }}
      >
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "0.75rem",
          }}
        >
          {error && <span role="alert">{error}</span>}
          <button type="button" disabled={deleting} onClick={handleDelete}>
            {deleting ? "Deleting…" : "Delete"}
          </button>
        </div>
      </td>
    </tr>
  );
}

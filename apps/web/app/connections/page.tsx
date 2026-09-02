"use client";

import { useCallback, useEffect, useState } from "react";
import type { socialConnections } from "@scenestealer/db";
import { DashboardTabs } from "../dashboard-tabs";
import { describeFetchError } from "../fetch-error";
import { useAuthedFetch } from "../use-authed-fetch";

type SocialConnection = typeof socialConnections.$inferSelect;

const PLATFORMS = [
  { key: "youtube", label: "YouTube" },
  { key: "facebook", label: "Facebook" },
  { key: "instagram", label: "Instagram" },
] as const;

const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 2 * 60 * 1000;

export default function ConnectionsPage() {
  const authedFetch = useAuthedFetch();
  const [connections, setConnections] = useState<SocialConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connectingPlatform, setConnectingPlatform] = useState<string | null>(
    null,
  );

  const loadConnections = useCallback(async () => {
    try {
      const res = await authedFetch("/social/connections");
      if (!res.ok) {
        setError("Failed to load connected accounts");
        return;
      }
      const { connections: rows } = (await res.json()) as {
        connections: SocialConnection[];
      };
      setConnections(rows);
    } catch (e) {
      setError(`Failed to load connected accounts: ${describeFetchError(e)}`);
    } finally {
      setLoading(false);
    }
  }, [authedFetch]);

  useEffect(() => {
    void loadConnections();
  }, [loadConnections]);

  async function handleConnect(platform: string) {
    setError(null);
    setConnectingPlatform(platform);
    try {
      const res = await authedFetch(`/social/${platform}/connect`, {
        method: "POST",
      });
      if (!res.ok) {
        setError(`Failed to start connecting ${platform}`);
        setConnectingPlatform(null);
        return;
      }
      const { url, beforeIds } = (await res.json()) as {
        url: string;
        beforeIds: string[];
      };
      window.open(url, "_blank", "noopener,noreferrer");

      const deadline = Date.now() + POLL_TIMEOUT_MS;
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
        const finalizeRes = await authedFetch(`/social/${platform}/finalize`, {
          method: "POST",
          body: JSON.stringify({ beforeIds }),
        });
        if (!finalizeRes.ok) continue;
        const { connections: newOnes } = (await finalizeRes.json()) as {
          connections: SocialConnection[];
        };
        if (newOnes.length > 0) {
          await loadConnections();
          setConnectingPlatform(null);
          return;
        }
      }
      setError(
        `Didn't see a new ${platform} connection — if you finished connecting, try refreshing.`,
      );
      setConnectingPlatform(null);
    } catch (e) {
      setError(`Failed to connect ${platform}: ${describeFetchError(e)}`);
      setConnectingPlatform(null);
    }
  }

  async function handleDisconnect(id: string) {
    if (
      !window.confirm(
        "Disconnect this account? This revokes access immediately.",
      )
    ) {
      return;
    }
    setError(null);
    try {
      const res = await authedFetch(`/social/connections/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        setError("Failed to disconnect account");
        return;
      }
      setConnections((prev) => prev.filter((c) => c.id !== id));
    } catch (e) {
      setError(`Failed to disconnect account: ${describeFetchError(e)}`);
    }
  }

  return (
    <main style={{ maxWidth: 1160, margin: "0 auto", padding: "24px" }}>
      <DashboardTabs />
      <h1>Connected accounts</h1>
      <p style={{ marginTop: "1rem", color: "var(--muted)" }}>
        Connect the accounts you want to publish clips to.
      </p>

      {error && (
        <p role="alert" style={{ marginTop: "1rem" }}>
          {error}
        </p>
      )}

      {!loading && (
        <div style={{ marginTop: "2rem" }}>
          <h2>Your connections</h2>
          {connections.length === 0 ? (
            <p style={{ color: "var(--muted)" }}>No accounts connected yet.</p>
          ) : (
            <ul style={{ listStyle: "none", padding: 0 }}>
              {connections.map((connection) => (
                <li
                  key={connection.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.75rem",
                    padding: "0.5rem 0",
                    borderBottom: "1px solid #333",
                  }}
                >
                  <span style={{ flex: 1, textTransform: "capitalize" }}>
                    {connection.platform}
                  </span>
                  <span style={{ fontSize: "0.85em", opacity: 0.7 }}>
                    Connected{" "}
                    {new Date(connection.createdAt).toLocaleDateString()}
                  </span>
                  <button
                    type="button"
                    onClick={() => void handleDisconnect(connection.id)}
                  >
                    Disconnect
                  </button>
                </li>
              ))}
            </ul>
          )}

          <h2 style={{ marginTop: "2rem" }}>Connect a new account</h2>
          <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
            {PLATFORMS.map((platform) => (
              <button
                key={platform.key}
                type="button"
                disabled={connectingPlatform !== null}
                onClick={() => void handleConnect(platform.key)}
              >
                {connectingPlatform === platform.key
                  ? "Waiting for you to finish connecting…"
                  : `Connect ${platform.label}`}
              </button>
            ))}
          </div>
        </div>
      )}
    </main>
  );
}

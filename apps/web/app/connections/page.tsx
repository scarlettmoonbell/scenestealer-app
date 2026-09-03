"use client";

import { useCallback, useEffect, useState } from "react";
import type { socialConnections } from "@scenestealer/db";
import { DashboardTabs } from "../dashboard-tabs";
import { describeFetchError } from "../fetch-error";
import { useAuthedFetch } from "../use-authed-fetch";

// Extends the raw row with the real account/page name and picture,
// read live from Postiz — a tenant can have more than one connection
// per platform, so these are what actually distinguish them in the UI.
type SocialConnection = typeof socialConnections.$inferSelect & {
  name: string | null;
  picture: string | null;
};

const PLATFORMS = [
  { key: "youtube", label: "YouTube" },
  { key: "facebook", label: "Facebook" },
  { key: "instagram", label: "Instagram" },
] as const;

const POLL_INTERVAL_MS = 3000;
// A multi-step flow (e.g. revoking and re-granting Page access, working
// through Postiz's own Page-picker) can easily run past two minutes —
// confirmed live: a real reconnect attempt succeeded well after the old
// 2-minute window would have given up.
const POLL_TIMEOUT_MS = 5 * 60 * 1000;

interface PendingConnect {
  platform: string;
  url: string;
  beforeIds: string[];
}

export default function ConnectionsPage() {
  const authedFetch = useAuthedFetch();
  const [connections, setConnections] = useState<SocialConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connectingPlatform, setConnectingPlatform] = useState<string | null>(
    null,
  );
  // The connect URL is ready but not yet opened — waiting on a second,
  // genuine click. A window.open()/`.location.href` navigation fired from
  // inside an async callback (even one opened synchronously beforehand
  // and pointed at the real URL later) loses the trusted user-gesture
  // context in Safari specifically — confirmed live: it left the tenant's
  // main tab hijacked onto Postiz's calendar with a blank orphaned popup,
  // rather than opening a clean second tab. A real <a target="_blank">,
  // clicked directly by the user, sidesteps this entirely since it's
  // native browser navigation, not JS-driven.
  const [pendingConnect, setPendingConnect] = useState<PendingConnect | null>(
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

  async function startConnect(platform: string) {
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
      setPendingConnect({ platform, url, beforeIds });
    } catch (e) {
      setError(`Failed to connect ${platform}: ${describeFetchError(e)}`);
      setConnectingPlatform(null);
    }
  }

  function cancelPendingConnect() {
    setPendingConnect(null);
    setConnectingPlatform(null);
  }

  // Fires from the real <a>'s onClick, alongside its native navigation —
  // no window handle to track or close, so nothing to strand the tenant
  // on. They can just switch back to this tab themselves once done; it
  // updates on its own as soon as polling sees the new connection.
  async function beginPolling(platform: string, beforeIds: string[]) {
    setPendingConnect(null);
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      try {
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
      } catch {
        // Transient — keep polling until the deadline.
      }
    }
    setError(
      `Still waiting on ${platform} after five minutes — if you finished connecting, refresh this page to check.`,
    );
    setConnectingPlatform(null);
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
                  <span style={{ flex: 1 }}>
                    <span style={{ textTransform: "capitalize" }}>
                      {connection.platform}
                    </span>
                    {connection.name && (
                      <span style={{ color: "var(--muted)" }}>
                        {" "}
                        &mdash; {connection.name}
                      </span>
                    )}
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
          <div
            style={{
              display: "flex",
              gap: "0.75rem",
              flexWrap: "wrap",
              alignItems: "center",
            }}
          >
            {PLATFORMS.map((platform) => {
              if (pendingConnect?.platform === platform.key) {
                return (
                  <span
                    key={platform.key}
                    style={{ display: "flex", gap: "0.5rem" }}
                  >
                    <a
                      href={pendingConnect.url}
                      target="_blank"
                      rel="noreferrer"
                      onClick={() =>
                        void beginPolling(
                          pendingConnect.platform,
                          pendingConnect.beforeIds,
                        )
                      }
                      style={{
                        display: "inline-block",
                        padding: "0.4rem 0.75rem",
                        background: "var(--accent)",
                        color: "#fff",
                        borderRadius: 4,
                        textDecoration: "none",
                      }}
                    >
                      Continue to {platform.label} &rarr;
                    </a>
                    <button type="button" onClick={cancelPendingConnect}>
                      Cancel
                    </button>
                  </span>
                );
              }
              return (
                <button
                  key={platform.key}
                  type="button"
                  disabled={connectingPlatform !== null}
                  onClick={() => void startConnect(platform.key)}
                >
                  {connectingPlatform === platform.key
                    ? "Waiting for you to finish connecting…"
                    : `Connect ${platform.label}`}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </main>
  );
}

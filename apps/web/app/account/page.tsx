"use client";

import { useCallback, useEffect, useState } from "react";
import { DashboardTabs } from "../dashboard-tabs";
import { describeFetchError } from "../fetch-error";
import { useAuthedFetch } from "../use-authed-fetch";
import { TABLE_HEADER_STYLE } from "../table-header-style";

interface Usage {
  plan: "free" | "small" | "medium" | "large" | "tester";
  tierName: string;
  capBytes: number;
  storageAddonUnits: number;
  usedBytes: number;
  availableBytes: number;
  burstSecondsRemaining: number;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  freeCapBytes: number;
}

// Static — matches apps/api/src/billing-tiers.ts. Duplicated rather
// than fetched: these are display-only (name/price/cap), the API
// route is the actual source of truth for what a tenant is charged,
// and a static list means the plan picker renders instantly instead
// of waiting on a round trip.
const TIER_CARDS = [
  { slug: "free" as const, name: "Free", price: "$0", storage: "4 GB" },
  { slug: "small" as const, name: "Small", price: "$9/mo", storage: "25 GB" },
  {
    slug: "medium" as const,
    name: "Medium",
    price: "$29/mo",
    storage: "100 GB",
  },
  { slug: "large" as const, name: "Large", price: "$49/mo", storage: "300 GB" },
];

function formatGb(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

function formatMinutes(seconds: number): string {
  return `${Math.floor(seconds / 60)} min`;
}

// The "user profile management page" ROADMAP.md calls for — plan,
// storage usage, and self-serve billing (tier switching happens
// in-app via POST /stripe/change-plan; storage add-on quantity,
// payment method, and invoices go through Stripe's hosted Customer
// Portal). Notification preferences stay
// on their own /settings page rather than merging in here — linked
// below instead, to keep this page focused on billing/plan.
export default function AccountPage() {
  const authedFetch = useAuthedFetch();
  const [usage, setUsage] = useState<Usage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [redirecting, setRedirecting] = useState<string | null>(null);
  const [checkoutResult, setCheckoutResult] = useState<string | null>(null);

  useEffect(() => {
    setCheckoutResult(
      new URLSearchParams(window.location.search).get("checkout"),
    );
  }, []);

  const loadUsage = useCallback(async () => {
    try {
      const res = await authedFetch("/tenant/usage");
      if (!res.ok) {
        setError("Failed to load account usage");
        return;
      }
      setUsage((await res.json()) as Usage);
    } catch (e) {
      setError(`Failed to load account usage: ${describeFetchError(e)}`);
    } finally {
      setLoading(false);
    }
  }, [authedFetch]);

  useEffect(() => {
    void loadUsage();
  }, [loadUsage]);

  async function openPortal() {
    setRedirecting("portal");
    setError(null);
    try {
      const res = await authedFetch("/stripe/portal", { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(body.error ?? "Failed to open the billing portal");
        setRedirecting(null);
        return;
      }
      const { url } = (await res.json()) as { url: string };
      window.location.href = url;
    } catch (e) {
      setError(`Failed to open the billing portal: ${describeFetchError(e)}`);
      setRedirecting(null);
    }
  }

  async function buyBurst() {
    setRedirecting("burst");
    setError(null);
    try {
      const res = await authedFetch("/stripe/checkout/burst", {
        method: "POST",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(body.error ?? "Failed to start checkout");
        setRedirecting(null);
        return;
      }
      const { url } = (await res.json()) as { url: string };
      window.location.href = url;
    } catch (e) {
      setError(`Failed to start checkout: ${describeFetchError(e)}`);
      setRedirecting(null);
    }
  }

  async function chooseTier(tier: "small" | "medium" | "large") {
    setRedirecting(tier);
    setError(null);
    try {
      const res = await authedFetch("/stripe/checkout", {
        method: "POST",
        body: JSON.stringify({ tier }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(body.error ?? "Failed to start checkout");
        setRedirecting(null);
        return;
      }
      const { url } = (await res.json()) as { url: string };
      window.location.href = url;
    } catch (e) {
      setError(`Failed to start checkout: ${describeFetchError(e)}`);
      setRedirecting(null);
    }
  }

  async function switchTier(tier: "small" | "medium" | "large") {
    setRedirecting(tier);
    setError(null);
    try {
      const res = await authedFetch("/stripe/change-plan", {
        method: "POST",
        body: JSON.stringify({ tier }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(body.error ?? "Failed to switch plans");
        return;
      }
      await loadUsage();
    } catch (e) {
      setError(`Failed to switch plans: ${describeFetchError(e)}`);
    } finally {
      setRedirecting(null);
    }
  }

  async function setCancellation(cancel: boolean) {
    if (
      cancel &&
      !window.confirm(
        "Switch to Free at the end of your current billing period? You keep your paid plan until then.",
      )
    ) {
      return;
    }
    setRedirecting(cancel ? "free" : "resume");
    setError(null);
    try {
      const res = await authedFetch(
        cancel ? "/stripe/cancel" : "/stripe/resume",
        {
          method: "POST",
        },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(body.error ?? "Failed to update your plan");
        return;
      }
      await loadUsage();
    } catch (e) {
      setError(`Failed to update your plan: ${describeFetchError(e)}`);
    } finally {
      setRedirecting(null);
    }
  }

  const usedFraction = usage ? usage.usedBytes / usage.capBytes : 0;
  const nearCap = usedFraction >= 0.9;
  const subscribed = usage != null && usage.plan !== "free";
  const periodEndLabel = usage?.currentPeriodEnd
    ? new Date(usage.currentPeriodEnd).toLocaleDateString(undefined, {
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : "the end of your billing period";
  const overFreeCap = usage != null && usage.usedBytes > usage.freeCapBytes;

  return (
    <>
      <DashboardTabs />
      {/* Outer frame matches DashboardTabs' own 1160px width — see
          settings/page.tsx's matching comment for why. */}
      <main style={{ maxWidth: 1160, margin: "0 auto", padding: "24px" }}>
        <div style={{ maxWidth: 720 }}>
          <h1>Account</h1>
          <p style={{ marginTop: "1rem", color: "var(--muted)" }}>
            Your plan and storage usage. Notification preferences live on the{" "}
            <a href="/settings">Settings</a> page.
          </p>

          {checkoutResult === "success" && (
            <p style={{ marginTop: "1rem", color: "var(--accent-text)" }}>
              Subscription started — it may take a few seconds to appear below.
            </p>
          )}
          {error && (
            <p role="alert" style={{ marginTop: "1rem" }}>
              {error}
            </p>
          )}

          {!loading && usage && (
            <>
              <div
                style={{
                  marginTop: "2rem",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  padding: "1.5rem",
                  display: "flex",
                  flexDirection: "column",
                  gap: "1rem",
                }}
              >
                <h2 style={{ marginTop: 0 }}>
                  Current plan: {usage.tierName}
                  {usage.storageAddonUnits > 0 &&
                    ` + ${usage.storageAddonUnits} storage add-on${usage.storageAddonUnits > 1 ? "s" : ""}`}
                </h2>

                <div>
                  <span style={TABLE_HEADER_STYLE}>
                    Storage: {formatGb(usage.usedBytes)} of{" "}
                    {formatGb(usage.capBytes)} used
                  </span>
                  <div
                    style={{
                      marginTop: "0.4rem",
                      height: 10,
                      borderRadius: 999,
                      background: "var(--surface-raised)",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        height: "100%",
                        width: `${Math.min(100, usedFraction * 100)}%`,
                        background: nearCap ? "var(--warm)" : "var(--accent)",
                        borderRadius: 999,
                      }}
                    />
                  </div>
                  {nearCap && (
                    <p style={{ marginTop: "0.5rem", color: "var(--warm)" }}>
                      You're close to your storage limit. Upgrade your plan or
                      add more storage below.
                    </p>
                  )}
                </div>

                {subscribed && usage.cancelAtPeriodEnd && (
                  <div
                    style={{
                      border: "1px solid var(--warm)",
                      borderRadius: 6,
                      padding: "0.75rem 1rem",
                    }}
                  >
                    <p style={{ margin: 0 }}>
                      Your {usage.tierName} plan ends on {periodEndLabel}, then
                      you'll move to Free ({formatGb(usage.freeCapBytes)}).
                    </p>
                    {overFreeCap && (
                      <p style={{ margin: "0.5rem 0 0", color: "var(--warm)" }}>
                        You're storing {formatGb(usage.usedBytes)}. Nothing will
                        be deleted, but new uploads will pause until you're
                        under {formatGb(usage.freeCapBytes)}.
                      </p>
                    )}
                    <button
                      type="button"
                      style={{ marginTop: "0.75rem" }}
                      disabled={redirecting === "resume"}
                      onClick={() => void setCancellation(false)}
                    >
                      {redirecting === "resume"
                        ? "Keeping plan…"
                        : `Keep ${usage.tierName}`}
                    </button>
                  </div>
                )}

                {subscribed && (
                  <button
                    type="button"
                    disabled={redirecting === "portal"}
                    onClick={() => void openPortal()}
                  >
                    {redirecting === "portal"
                      ? "Opening billing portal…"
                      : "Manage billing (switch plan, add storage, payment method)"}
                  </button>
                )}
              </div>

              <div
                style={{
                  marginTop: "1.5rem",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  padding: "1.5rem",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "1rem",
                  flexWrap: "wrap",
                }}
              >
                <div>
                  <h2 style={{ marginTop: 0, marginBottom: "0.35rem" }}>
                    Burst processing
                  </h2>
                  <p style={{ margin: 0, color: "var(--muted)" }}>
                    {usage.burstSecondsRemaining > 0
                      ? `${formatMinutes(usage.burstSecondsRemaining)} of fast processing remaining.`
                      : "Process your next uploads on our fastest machines."}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={redirecting === "burst"}
                  onClick={() => void buyBurst()}
                >
                  {redirecting === "burst"
                    ? "Starting…"
                    : "Buy 2 hours — $4.99"}
                </button>
              </div>

              <div
                style={{
                  marginTop: "1.5rem",
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
                  gap: "1rem",
                }}
              >
                {TIER_CARDS.map((tier) => {
                  const isCurrent = usage.plan === tier.slug;
                  return (
                    <div
                      key={tier.slug}
                      style={{
                        border: isCurrent
                          ? "1.5px solid var(--accent-text)"
                          : "1px solid var(--border)",
                        borderRadius: 8,
                        padding: "1rem",
                        display: "flex",
                        flexDirection: "column",
                        gap: "0.5rem",
                      }}
                    >
                      <strong>{tier.name}</strong>
                      <span style={{ color: "var(--muted)" }}>
                        {tier.price}
                      </span>
                      <span
                        style={{ color: "var(--muted)", fontSize: "0.9em" }}
                      >
                        {tier.storage} storage
                      </span>
                      {isCurrent ? (
                        <span style={{ fontSize: "0.9em" }}>Current plan</span>
                      ) : tier.slug === "free" ? (
                        !subscribed ||
                        usage.plan ===
                          "tester" ? null : usage.cancelAtPeriodEnd ? (
                          <span
                            style={{
                              fontSize: "0.85em",
                              color: "var(--muted)",
                            }}
                          >
                            Starts {periodEndLabel}
                          </span>
                        ) : (
                          <button
                            type="button"
                            disabled={redirecting === "free"}
                            onClick={() => void setCancellation(true)}
                          >
                            {redirecting === "free"
                              ? "Switching…"
                              : "Switch to Free"}
                          </button>
                        )
                      ) : subscribed ? (
                        <button
                          type="button"
                          disabled={redirecting === tier.slug}
                          onClick={() =>
                            void switchTier(
                              tier.slug as "small" | "medium" | "large",
                            )
                          }
                        >
                          {redirecting === tier.slug
                            ? "Switching…"
                            : `Switch to ${tier.name}`}
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={redirecting === tier.slug}
                          onClick={() =>
                            void chooseTier(
                              tier.slug as "small" | "medium" | "large",
                            )
                          }
                        >
                          {redirecting === tier.slug
                            ? "Starting…"
                            : "Choose plan"}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </main>
    </>
  );
}

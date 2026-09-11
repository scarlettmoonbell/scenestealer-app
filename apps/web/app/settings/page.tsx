"use client";

import { useCallback, useEffect, useState } from "react";
import { DashboardTabs } from "../dashboard-tabs";
import { describeFetchError } from "../fetch-error";
import { useAuthedFetch } from "../use-authed-fetch";
import { TABLE_HEADER_STYLE } from "../table-header-style";

interface TenantSettings {
  notificationEmail: string | null;
  notifyOnPublishFailure: boolean;
}

const FIELD_LABEL_STYLE = {
  ...TABLE_HEADER_STYLE,
  display: "block" as const,
  marginBottom: "0.35rem",
};

// Currently just publish-failure notifications — see apps/api's
// routes/tenant.ts for why this is tenant-scoped (one address per
// org) rather than per Clerk user. Deliberately does not surface
// anything from Postiz's own settings UI: per-connection posting
// defaults live on the Scheduling page instead, next to the
// connection they apply to.
export default function SettingsPage() {
  const authedFetch = useAuthedFetch();
  const [settings, setSettings] = useState<TenantSettings | null>(null);
  const [email, setEmail] = useState("");
  const [notifyOnFailure, setNotifyOnFailure] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const loadSettings = useCallback(async () => {
    try {
      const res = await authedFetch("/tenant/settings");
      if (!res.ok) {
        setError("Failed to load settings");
        return;
      }
      const { settings: loaded } = (await res.json()) as {
        settings: TenantSettings;
      };
      setSettings(loaded);
      setEmail(loaded.notificationEmail ?? "");
      setNotifyOnFailure(loaded.notifyOnPublishFailure);
    } catch (e) {
      setError(`Failed to load settings: ${describeFetchError(e)}`);
    } finally {
      setLoading(false);
    }
  }, [authedFetch]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await authedFetch("/tenant/settings", {
        method: "PATCH",
        body: JSON.stringify({
          notificationEmail: email,
          notifyOnPublishFailure: notifyOnFailure,
        }),
      });
      if (!res.ok) {
        setError("Failed to save settings");
        return;
      }
      const { settings: updated } = (await res.json()) as {
        settings: TenantSettings;
      };
      setSettings(updated);
      setSaved(true);
    } catch (e) {
      setError(`Failed to save settings: ${describeFetchError(e)}`);
    } finally {
      setSaving(false);
    }
  }

  const dirty =
    settings != null &&
    (email !== (settings.notificationEmail ?? "") ||
      notifyOnFailure !== settings.notifyOnPublishFailure);

  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "24px" }}>
      <DashboardTabs />
      <h1>Settings</h1>
      <p style={{ marginTop: "1rem", color: "var(--muted)" }}>
        Notification preferences for this organization.
      </p>

      {error && (
        <p role="alert" style={{ marginTop: "1rem" }}>
          {error}
        </p>
      )}

      {!loading && (
        <div
          style={{
            marginTop: "2rem",
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: "1.5rem",
            display: "flex",
            flexDirection: "column",
            gap: "1rem",
            maxWidth: 480,
          }}
        >
          <h2 style={{ marginTop: 0 }}>Publish failures</h2>

          <label>
            <input
              type="checkbox"
              checked={notifyOnFailure}
              onChange={(e) => setNotifyOnFailure(e.target.checked)}
            />{" "}
            Email me when a post fails to publish
          </label>

          <label>
            <span style={FIELD_LABEL_STYLE}>Notification email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="field-input"
              disabled={!notifyOnFailure}
            />
          </label>

          <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
            <button
              type="button"
              disabled={saving || !dirty}
              onClick={() => void handleSave()}
            >
              {saving ? "Saving…" : "Save"}
            </button>
            {saved && !dirty && (
              <span style={{ color: "var(--muted)", fontSize: "0.9em" }}>
                Saved.
              </span>
            )}
          </div>
        </div>
      )}
    </main>
  );
}

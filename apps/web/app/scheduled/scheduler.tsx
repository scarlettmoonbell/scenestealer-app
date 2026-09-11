"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type {
  socialConnections,
  templates as templatesTable,
} from "@scenestealer/db";
import { describeFetchError } from "../fetch-error";
import { useAuthedFetch } from "../use-authed-fetch";
import { TABLE_HEADER_STYLE } from "../table-header-style";
import { CalendarPicker } from "./calendar-picker";

// Same look as a table column header (TABLE_HEADER_STYLE), just as a
// block-level label sitting above a field instead of inline in a <th>
// — confirmed live 2026-09-07: this form's field labels were plain
// unstyled text, inconsistent with the "Rendered clips" table right
// above it on the same page.
const FIELD_LABEL_STYLE = {
  ...TABLE_HEADER_STYLE,
  display: "block" as const,
  marginBottom: "0.35rem",
};

// Extends the raw row with the real account/page name, read live from
// Postiz — a tenant can have more than one connection per platform, so
// this is what actually distinguishes them in the dropdown below.
type SocialConnection = typeof socialConnections.$inferSelect & {
  name: string | null;
};
type Template = typeof templatesTable.$inferSelect;

interface SettingsField {
  key: string;
  enumValues?: string[];
}

interface IntegrationSettingsResponse {
  output: {
    settings: {
      properties: Record<string, { enum?: string[] }>;
      required?: string[];
    };
  };
}

export interface VideoMetadata {
  recordedAt: Date | null;
  deviceModel: string | null;
  venueName: string | null;
  cityName: string | null;
}

function formatDuration(sec: number): string {
  const total = Math.round(sec);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m}:${String(s).padStart(2, "0")}` : `${s}s`;
}

function renderTemplate(
  template: string,
  vars: {
    video_title: string;
    date: string;
    organization: string;
    venue: string;
    city: string;
    recorded_date: string;
    duration: string;
  },
): string {
  return template
    .replaceAll("{{video_title}}", vars.video_title)
    .replaceAll("{{date}}", vars.date)
    .replaceAll("{{organization}}", vars.organization)
    .replaceAll("{{venue}}", vars.venue)
    .replaceAll("{{city}}", vars.city)
    .replaceAll("{{recorded_date}}", vars.recorded_date)
    .replaceAll("{{duration}}", vars.duration);
}

// Publish/schedule form for one already-rendered clip — always
// rendered once a clip is selected on the Scheduling page, unlike its
// predecessor (apps/web/app/videos/[id]/publish-control.tsx, now
// deleted) which stayed collapsed behind its own "Publish" button
// inside each video's clip table. That inline placement is what made
// scheduling feel scattered across every video's own page instead of
// living in one place — this component's logic is otherwise unchanged
// from that original.
export function Scheduler({
  clipId,
  videoTitle,
  organizationName,
  videoMetadata,
  clipDurationSec,
}: {
  clipId: string;
  videoTitle: string;
  organizationName: string;
  videoMetadata: VideoMetadata;
  clipDurationSec: number;
}) {
  const authedFetch = useAuthedFetch();
  const [connections, setConnections] = useState<SocialConnection[]>([]);
  const [templateList, setTemplateList] = useState<Template[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [connectionId, setConnectionId] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [caption, setCaption] = useState("");
  const [settingsFields, setSettingsFields] = useState<SettingsField[]>([]);
  const [settingsValues, setSettingsValues] = useState<Record<string, string>>(
    {},
  );
  const [publishing, setPublishing] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [scheduleMode, setScheduleMode] = useState<"now" | "later">("now");
  const [scheduledFor, setScheduledFor] = useState("");
  // "HH:mm", our own per-connection convenience — not Postiz's own
  // postingTimes (that field lives behind Postiz's session-authenticated
  // app API, not the API-key-based public one this app otherwise uses;
  // see schema.ts's socialConnections.defaultPostingTime comment).
  const [defaultPostingTime, setDefaultPostingTime] = useState("");
  const [savingDefaultTime, setSavingDefaultTime] = useState(false);

  useEffect(() => {
    if (loaded) return;
    Promise.all([
      authedFetch("/social/connections").then((res) => res.json()) as Promise<{
        connections: SocialConnection[];
      }>,
      authedFetch("/templates").then((res) => res.json()) as Promise<{
        templates: Template[];
      }>,
    ])
      .then(([connectionsRes, templatesRes]) => {
        setConnections(connectionsRes.connections);
        setTemplateList(templatesRes.templates);
        if (connectionsRes.connections.length > 0) {
          setConnectionId(connectionsRes.connections[0].id);
        }
        setLoaded(true);
      })
      .catch((e) =>
        setError(`Failed to load publish options: ${describeFetchError(e)}`),
      );
  }, [loaded, authedFetch]);

  useEffect(() => {
    const connection = connections.find((c) => c.id === connectionId);
    setDefaultPostingTime(connection?.defaultPostingTime ?? "");
  }, [connectionId, connections]);

  async function saveDefaultPostingTime() {
    if (!connectionId) return;
    setSavingDefaultTime(true);
    setError(null);
    try {
      const res = await authedFetch(`/social/connections/${connectionId}`, {
        method: "PATCH",
        body: JSON.stringify({
          defaultPostingTime: defaultPostingTime || null,
        }),
      });
      if (!res.ok) {
        setError("Failed to save default posting time");
        return;
      }
      const { connection } = (await res.json()) as {
        connection: SocialConnection;
      };
      setConnections((prev) =>
        prev.map((c) => (c.id === connectionId ? connection : c)),
      );
    } catch (e) {
      setError(`Failed to save default posting time: ${describeFetchError(e)}`);
    } finally {
      setSavingDefaultTime(false);
    }
  }

  useEffect(() => {
    if (!connectionId) {
      setSettingsFields([]);
      return;
    }
    authedFetch(`/social/connections/${connectionId}/settings`)
      .then((res) => res.json() as Promise<IntegrationSettingsResponse>)
      .then((data) => {
        const required = data.output.settings.required ?? [];
        const properties = data.output.settings.properties ?? {};
        setSettingsFields(
          required.map((key) => ({
            key,
            enumValues: properties[key]?.enum,
          })),
        );
        setSettingsValues({});
      })
      .catch((e) =>
        setError(
          `Failed to load account requirements: ${describeFetchError(e)}`,
        ),
      );
  }, [connectionId, authedFetch]);

  function applyTemplate(id: string) {
    setTemplateId(id);
    const template = templateList.find((t) => t.id === id);
    if (template) {
      setCaption(
        renderTemplate(template.captionTemplate, {
          video_title: videoTitle,
          date: new Date().toLocaleDateString(),
          organization: organizationName,
          venue: videoMetadata.venueName ?? "",
          city: videoMetadata.cityName ?? "",
          recorded_date: videoMetadata.recordedAt
            ? new Date(videoMetadata.recordedAt).toLocaleDateString()
            : "",
          duration: formatDuration(clipDurationSec),
        }),
      );
    }
  }

  // Postiz accepting the publish request only means it queued the post
  // — actual delivery happens asynchronously via its own orchestrator,
  // so a "now" publish isn't done the moment the POST above resolves.
  // Polls GET /posts/:id/status (apps/api/src/routes/posts.ts), which
  // checks Postiz's real per-post state and updates our own row, until
  // it reaches a terminal status or this gives up. Confirmed for real
  // (2026-09-07) that skipping this and just showing "Published!"
  // immediately can lie — a stuck orchestrator once left posts
  // permanently un-delivered with our own UI still claiming success.
  //
  // Silent while still pending (2026-09-11, tenant's own request) — the
  // button's own disabled/label state already says "Publishing…" while
  // this runs, so a second inline text block saying the same thing was
  // redundant. A genuine failure interrupts the tenant via the error
  // banner below; reaching "published" surfaces its own confirmation
  // (2026-09-11, tenant's own follow-up request — the button simply
  // going back to normal read as "did anything happen?"). A pending-
  // too-long post (attempts exhausted, neither terminal status reached)
  // still resolves correctly next time this page — or "Already
  // scheduled" — reconciles it, same as it always did; nothing is shown
  // for that case since it isn't actually known yet either way.
  async function pollPostStatus(postId: string) {
    for (let attempt = 0; attempt < 12; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      try {
        const res = await authedFetch(`/posts/${postId}/status`);
        if (!res.ok) continue;
        const { post } = (await res.json()) as {
          post: { status: string; error: string | null };
        };
        if (post.status === "published") {
          setSuccess("Published!");
          return;
        }
        if (post.status === "failed") {
          setError(post.error ?? "Failed to publish");
          return;
        }
      } catch {
        // Transient — keep polling until attempts run out.
      }
    }
  }

  async function handlePublish() {
    if (!connectionId) return;
    if (scheduleMode === "later" && !scheduledFor) {
      setError("Pick a date and time to schedule for");
      return;
    }
    setPublishing(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await authedFetch(`/clips/${clipId}/publish`, {
        method: "POST",
        body: JSON.stringify({
          socialConnectionId: connectionId,
          caption,
          templateId: templateId || undefined,
          settings: settingsValues,
          scheduledFor:
            scheduleMode === "later"
              ? new Date(scheduledFor).toISOString()
              : undefined,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        setError(body?.error ?? "Failed to publish");
        return;
      }
      if (scheduleMode === "later") {
        setSuccess("Scheduled!");
        return;
      }
      const { post } = (await res.json()) as { post: { id: string } };
      await pollPostStatus(post.id);
    } catch (e) {
      setError(`Failed to publish: ${describeFetchError(e)}`);
    } finally {
      setPublishing(false);
    }
  }

  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 8,
        padding: "1rem",
        maxWidth: 900,
      }}
    >
      {error && (
        <p
          role="alert"
          style={{
            background: "color-mix(in srgb, #e5484d 12%, transparent)",
            border: "1px solid #e5484d",
            borderRadius: 6,
            padding: "0.6rem 0.85rem",
            marginBottom: "1rem",
            color: "#e5484d",
          }}
        >
          {error}
        </p>
      )}

      {success && (
        <p
          role="status"
          style={{
            background: "color-mix(in srgb, #30a46c 12%, transparent)",
            border: "1px solid #30a46c",
            borderRadius: 6,
            padding: "0.6rem 0.85rem",
            marginBottom: "1rem",
            color: "#30a46c",
          }}
        >
          {success}
        </p>
      )}

      {loaded && connections.length === 0 && (
        <p>
          No accounts connected yet.{" "}
          <Link href="/connections">Connect one</Link>.
        </p>
      )}

      {loaded && connections.length > 0 && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "2rem",
            alignItems: "stretch",
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "0.75rem",
              flex: "1 1 320px",
            }}
          >
            <label>
              <span style={FIELD_LABEL_STYLE}>Account</span>
              <select
                value={connectionId}
                onChange={(e) => setConnectionId(e.target.value)}
                className="field-input"
              >
                {connections.map((connection) => (
                  <option key={connection.id} value={connection.id}>
                    {connection.name
                      ? `${connection.platform} — ${connection.name}`
                      : connection.platform}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <span style={FIELD_LABEL_STYLE}>
                Default posting time for this account
              </span>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <input
                  type="time"
                  value={defaultPostingTime}
                  onChange={(e) => setDefaultPostingTime(e.target.value)}
                  className="field-input"
                  style={{ flex: 1 }}
                />
                <button
                  type="button"
                  disabled={savingDefaultTime}
                  onClick={() => void saveDefaultPostingTime()}
                >
                  {savingDefaultTime ? "Saving…" : "Save"}
                </button>
              </div>
            </label>

            <label>
              <span style={FIELD_LABEL_STYLE}>Template (optional)</span>
              <select
                value={templateId}
                onChange={(e) => applyTemplate(e.target.value)}
                className="field-input"
              >
                <option value="">No template</option>
                {templateList
                  .filter(
                    (t) =>
                      !t.platform ||
                      t.platform ===
                        connections.find((c) => c.id === connectionId)
                          ?.platform,
                  )
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
              </select>
            </label>

            <label>
              <span style={FIELD_LABEL_STYLE}>Caption</span>
              <textarea
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                rows={3}
                className="field-input"
              />
            </label>

            {settingsFields.map((field) => (
              <label key={field.key}>
                <span style={FIELD_LABEL_STYLE}>{field.key}</span>
                {field.enumValues ? (
                  <select
                    value={settingsValues[field.key] ?? ""}
                    onChange={(e) =>
                      setSettingsValues((prev) => ({
                        ...prev,
                        [field.key]: e.target.value,
                      }))
                    }
                    className="field-input"
                  >
                    <option value="">Select…</option>
                    {field.enumValues.map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={settingsValues[field.key] ?? ""}
                    onChange={(e) =>
                      setSettingsValues((prev) => ({
                        ...prev,
                        [field.key]: e.target.value,
                      }))
                    }
                    className="field-input"
                  />
                )}
              </label>
            ))}

            <div style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
              <label>
                <input
                  type="radio"
                  name="scheduleMode"
                  checked={scheduleMode === "now"}
                  onChange={() => setScheduleMode("now")}
                />{" "}
                Publish now
              </label>
              <label>
                <input
                  type="radio"
                  name="scheduleMode"
                  checked={scheduleMode === "later"}
                  onChange={() => {
                    setScheduleMode("later");
                    // Prefills the calendar's time field from this
                    // connection's saved default instead of
                    // CalendarPicker's own fallback (today at noon) —
                    // only when nothing's been picked yet, so it never
                    // overwrites a date/time the tenant already chose.
                    if (!scheduledFor && defaultPostingTime) {
                      const today = new Date(
                        Date.now() - new Date().getTimezoneOffset() * 60000,
                      )
                        .toISOString()
                        .slice(0, 10);
                      setScheduledFor(`${today}T${defaultPostingTime}`);
                    }
                  }}
                />{" "}
                Schedule for later
              </label>
            </div>

            <button
              type="button"
              disabled={publishing}
              onClick={() => void handlePublish()}
            >
              {publishing
                ? scheduleMode === "later"
                  ? "Scheduling…"
                  : "Publishing…"
                : scheduleMode === "later"
                  ? "Schedule"
                  : "Publish now"}
            </button>
          </div>

          {scheduleMode === "later" && (
            <div
              style={{
                flex: "1 1 320px",
                display: "flex",
                flexDirection: "column",
              }}
            >
              <span style={FIELD_LABEL_STYLE}>Date and time</span>
              <CalendarPicker
                value={scheduledFor}
                onChange={setScheduledFor}
                min={new Date(
                  Date.now() - new Date().getTimezoneOffset() * 60000,
                )
                  .toISOString()
                  .slice(0, 16)}
                style={{ flex: 1 }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

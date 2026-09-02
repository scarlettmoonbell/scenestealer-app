"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type {
  socialConnections,
  templates as templatesTable,
} from "@scenestealer/db";
import { describeFetchError } from "../../fetch-error";
import { useAuthedFetch } from "../../use-authed-fetch";

type SocialConnection = typeof socialConnections.$inferSelect;
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

function renderTemplate(
  template: string,
  vars: { video_title: string; date: string },
): string {
  return template
    .replaceAll("{{video_title}}", vars.video_title)
    .replaceAll("{{date}}", vars.date);
}

export function PublishControl({
  clipId,
  videoTitle,
}: {
  clipId: string;
  videoTitle: string;
}) {
  const authedFetch = useAuthedFetch();
  const [open, setOpen] = useState(false);
  const [connections, setConnections] = useState<SocialConnection[]>([]);
  const [templateList, setTemplateList] = useState<Template[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const [connectionId, setConnectionId] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [caption, setCaption] = useState("");
  const [settingsFields, setSettingsFields] = useState<SettingsField[]>([]);
  const [settingsValues, setSettingsValues] = useState<Record<string, string>>(
    {},
  );
  const [publishing, setPublishing] = useState(false);

  useEffect(() => {
    if (!open || loaded) return;
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
  }, [open, loaded, authedFetch]);

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
        }),
      );
    }
  }

  async function handlePublish() {
    if (!connectionId) return;
    setPublishing(true);
    setError(null);
    setResult(null);
    try {
      const res = await authedFetch(`/clips/${clipId}/publish`, {
        method: "POST",
        body: JSON.stringify({
          socialConnectionId: connectionId,
          caption,
          templateId: templateId || undefined,
          settings: settingsValues,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        setError(body?.error ?? "Failed to publish");
        return;
      }
      setResult("Published!");
    } catch (e) {
      setError(`Failed to publish: ${describeFetchError(e)}`);
    } finally {
      setPublishing(false);
    }
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}>
        Publish
      </button>
    );
  }

  return (
    <div
      style={{
        border: "1px solid #333",
        padding: "0.75rem",
        marginTop: "0.5rem",
        display: "flex",
        flexDirection: "column",
        gap: "0.5rem",
        maxWidth: 480,
      }}
    >
      {error && <p role="alert">{error}</p>}
      {result && <p>{result}</p>}

      {loaded && connections.length === 0 && (
        <p>
          No accounts connected yet.{" "}
          <Link href="/connections">Connect one</Link>.
        </p>
      )}

      {loaded && connections.length > 0 && (
        <>
          <label>
            Account
            <select
              value={connectionId}
              onChange={(e) => setConnectionId(e.target.value)}
              style={{ display: "block", width: "100%" }}
            >
              {connections.map((connection) => (
                <option key={connection.id} value={connection.id}>
                  {connection.platform}
                </option>
              ))}
            </select>
          </label>

          <label>
            Template (optional)
            <select
              value={templateId}
              onChange={(e) => applyTemplate(e.target.value)}
              style={{ display: "block", width: "100%" }}
            >
              <option value="">No template</option>
              {templateList
                .filter(
                  (t) =>
                    !t.platform ||
                    t.platform ===
                      connections.find((c) => c.id === connectionId)?.platform,
                )
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
            </select>
          </label>

          <label>
            Caption
            <textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              rows={3}
              style={{ display: "block", width: "100%" }}
            />
          </label>

          {settingsFields.map((field) => (
            <label key={field.key}>
              {field.key}
              {field.enumValues ? (
                <select
                  value={settingsValues[field.key] ?? ""}
                  onChange={(e) =>
                    setSettingsValues((prev) => ({
                      ...prev,
                      [field.key]: e.target.value,
                    }))
                  }
                  style={{ display: "block", width: "100%" }}
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
                  style={{ display: "block", width: "100%" }}
                />
              )}
            </label>
          ))}

          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button
              type="button"
              disabled={publishing}
              onClick={() => void handlePublish()}
            >
              {publishing ? "Publishing…" : "Publish now"}
            </button>
            <button type="button" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </>
      )}
    </div>
  );
}

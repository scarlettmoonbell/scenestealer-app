"use client";

import { useCallback, useEffect, useState } from "react";
import type { templates as templatesTable } from "@scenestealer/db";
import { DashboardTabs } from "../dashboard-tabs";
import { describeFetchError } from "../fetch-error";
import { useAuthedFetch } from "../use-authed-fetch";

type Template = typeof templatesTable.$inferSelect;
type Platform = Template["platform"];

const PLATFORM_OPTIONS: { value: Platform; label: string }[] = [
  { value: null, label: "Any platform" },
  { value: "youtube", label: "YouTube" },
  { value: "facebook", label: "Facebook" },
  { value: "instagram", label: "Instagram" },
];

const EMPTY_FORM = {
  name: "",
  captionTemplate: "",
  platform: null as Platform,
};

export default function TemplatesPage() {
  const authedFetch = useAuthedFetch();
  const [templateList, setTemplateList] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const loadTemplates = useCallback(async () => {
    try {
      const res = await authedFetch("/templates");
      if (!res.ok) {
        setError("Failed to load templates");
        return;
      }
      const { templates: rows } = (await res.json()) as {
        templates: Template[];
      };
      setTemplateList(rows);
    } catch (e) {
      setError(`Failed to load templates: ${describeFetchError(e)}`);
    } finally {
      setLoading(false);
    }
  }, [authedFetch]);

  useEffect(() => {
    void loadTemplates();
  }, [loadTemplates]);

  function startEdit(template: Template) {
    setEditingId(template.id);
    setForm({
      name: template.name,
      captionTemplate: template.captionTemplate,
      platform: template.platform,
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setForm(EMPTY_FORM);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !form.captionTemplate.trim()) return;

    setSaving(true);
    setError(null);
    try {
      const res = editingId
        ? await authedFetch(`/templates/${editingId}`, {
            method: "PATCH",
            body: JSON.stringify(form),
          })
        : await authedFetch("/templates", {
            method: "POST",
            body: JSON.stringify(form),
          });
      if (!res.ok) {
        setError("Failed to save template");
        return;
      }
      cancelEdit();
      await loadTemplates();
    } catch (e) {
      setError(`Failed to save template: ${describeFetchError(e)}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm("Delete this template?")) return;
    setError(null);
    try {
      const res = await authedFetch(`/templates/${id}`, { method: "DELETE" });
      if (!res.ok) {
        setError("Failed to delete template");
        return;
      }
      setTemplateList((prev) => prev.filter((t) => t.id !== id));
      if (editingId === id) cancelEdit();
    } catch (e) {
      setError(`Failed to delete template: ${describeFetchError(e)}`);
    }
  }

  return (
    <main style={{ maxWidth: 1160, margin: "0 auto", padding: "24px" }}>
      <DashboardTabs />
      <h1>Caption templates</h1>
      <p style={{ marginTop: "1rem", color: "var(--muted)" }}>
        Reusable captions for publishing — write a caption once, reuse it with
        variables filled in automatically. See the reference table below for
        what&rsquo;s available.
      </p>

      {error && (
        <p role="alert" style={{ marginTop: "1rem" }}>
          {error}
        </p>
      )}

      <form
        onSubmit={(e) => void handleSave(e)}
        style={{
          marginTop: "1.5rem",
          display: "flex",
          flexDirection: "column",
          gap: "0.75rem",
          maxWidth: 480,
        }}
      >
        <h2>{editingId ? "Edit template" : "New template"}</h2>
        <label>
          Name
          <input
            type="text"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            style={{ display: "block", width: "100%" }}
          />
        </label>
        <label>
          Platform
          <select
            value={form.platform ?? ""}
            onChange={(e) =>
              setForm({
                ...form,
                platform: (e.target.value || null) as Platform,
              })
            }
            style={{ display: "block", width: "100%" }}
          >
            {PLATFORM_OPTIONS.map((option) => (
              <option key={option.label} value={option.value ?? ""}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Caption
          <textarea
            value={form.captionTemplate}
            onChange={(e) =>
              setForm({ ...form, captionTemplate: e.target.value })
            }
            rows={4}
            style={{ display: "block", width: "100%" }}
          />
        </label>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button type="submit" disabled={saving}>
            {saving ? "Saving…" : editingId ? "Save changes" : "Create"}
          </button>
          {editingId && (
            <button type="button" onClick={cancelEdit}>
              Cancel
            </button>
          )}
        </div>
      </form>

      <div style={{ marginTop: "2rem" }}>
        <h2>Available variables</h2>
        <div style={{ marginTop: "1rem", overflowX: "auto" }}>
          <table
            style={{
              borderCollapse: "collapse",
              width: "100%",
              maxWidth: 720,
              fontSize: "0.95em",
            }}
          >
            <thead>
              <tr>
                <th
                  scope="col"
                  style={{
                    textAlign: "left",
                    padding: "0.5rem 0.75rem 0.5rem 0",
                    borderBottom: "1px solid var(--border)",
                    color: "var(--heading)",
                  }}
                >
                  Variable
                </th>
                <th
                  scope="col"
                  style={{
                    textAlign: "left",
                    padding: "0.5rem 0.75rem",
                    borderBottom: "1px solid var(--border)",
                    color: "var(--heading)",
                  }}
                >
                  Example
                </th>
                <th
                  scope="col"
                  style={{
                    textAlign: "left",
                    padding: "0.5rem 0 0.5rem 0.75rem",
                    borderBottom: "1px solid var(--border)",
                    color: "var(--heading)",
                  }}
                >
                  Where it comes from
                </th>
              </tr>
            </thead>
            <tbody>
              {[
                {
                  variable: "{{video_title}}",
                  example: "Opening Night — Act II",
                  notes: "The recording's title",
                },
                {
                  variable: "{{organization}}",
                  example: "Motherwound Theatre Co.",
                  notes: "Your organization's name",
                },
                {
                  variable: "{{duration}}",
                  example: "0:45",
                  notes: "This clip's length",
                },
                {
                  variable: "{{date}}",
                  example: "9/2/2026",
                  notes: "Today's date, when you publish",
                },
                {
                  variable: "{{recorded_date}}",
                  example: "8/8/2026",
                  notes:
                    "When the video was actually recorded, if the file has that metadata",
                },
                {
                  variable: "{{venue}}",
                  example: "Zach Theatre",
                  notes: (
                    <>
                      Business/venue name at the recording location, when
                      OpenStreetMap has one mapped there
                    </>
                  ),
                },
                {
                  variable: "{{city}}",
                  example: "Austin, Texas",
                  notes:
                    "City where it was recorded, from the same location data",
                },
              ].map((row) => (
                <tr key={row.variable}>
                  <td
                    style={{
                      padding: "0.5rem 0.75rem 0.5rem 0",
                      borderBottom: "1px solid var(--border)",
                    }}
                  >
                    <code>{row.variable}</code>
                  </td>
                  <td
                    style={{
                      padding: "0.5rem 0.75rem",
                      borderBottom: "1px solid var(--border)",
                      color: "var(--muted)",
                    }}
                  >
                    {row.example}
                  </td>
                  <td
                    style={{
                      padding: "0.5rem 0 0.5rem 0.75rem",
                      borderBottom: "1px solid var(--border)",
                      color: "var(--muted)",
                    }}
                  >
                    {row.notes}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p
          style={{
            marginTop: "0.75rem",
            color: "var(--muted)",
            fontSize: "0.85em",
          }}
        >
          Not every video has every field (e.g. a screen recording won&rsquo;t
          have location data) — a variable with nothing to fill just gets
          dropped from the caption. <code>{"{{venue}}"}</code>/
          <code>{"{{city}}"}</code> come from your recording&rsquo;s location
          data, reverse-geocoded via{" "}
          <a
            href="https://www.openstreetmap.org/copyright"
            target="_blank"
            rel="noreferrer"
          >
            OpenStreetMap
          </a>{" "}
          — © OpenStreetMap contributors.
        </p>
      </div>

      {!loading && (
        <div style={{ marginTop: "2rem" }}>
          <h2>Your templates</h2>
          {templateList.length === 0 ? (
            <p style={{ color: "var(--muted)" }}>No templates yet.</p>
          ) : (
            <ul style={{ listStyle: "none", padding: 0 }}>
              {templateList.map((template) => (
                <li
                  key={template.id}
                  style={{
                    padding: "0.75rem 0",
                    borderBottom: "1px solid #333",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.75rem",
                    }}
                  >
                    <strong style={{ flex: 1 }}>{template.name}</strong>
                    <span style={{ fontSize: "0.85em", opacity: 0.7 }}>
                      {template.platform ?? "Any platform"}
                    </span>
                    <button type="button" onClick={() => startEdit(template)}>
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDelete(template.id)}
                    >
                      Delete
                    </button>
                  </div>
                  <p style={{ marginTop: "0.4rem", color: "var(--muted)" }}>
                    {template.captionTemplate}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </main>
  );
}

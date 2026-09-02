"use client";

import { useCallback, useEffect, useState } from "react";
import type { templates as templatesTable } from "@scenestealer/db";
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
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "2rem 1rem" }}>
      <h1>Caption templates</h1>
      <p style={{ marginTop: "1rem", color: "var(--muted)" }}>
        Reusable captions for publishing. Use <code>{"{{video_title}}"}</code>{" "}
        and <code>{"{{date}}"}</code> — they get filled in when you publish.
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

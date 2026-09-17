"use client";

import { useState } from "react";
import { startRegistration } from "@simplewebauthn/browser";

const API_URL = process.env.NEXT_PUBLIC_API_URL;

// One-time bootstrap only — see apps/api/src/routes/admin-auth.ts's
// POST /setup/*. Not reachable via requireAdmin (nothing to check yet
// on a fresh system), gated instead by pasting the ADMIN_SETUP_TOKEN
// secret directly here. Rotate/delete that secret after real use so
// this page can't register a second identity later.
export default function AdminSetupPage() {
  const [setupToken, setSetupToken] = useState("");
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);

  async function handleSetup() {
    setLoading(true);
    setError(null);
    try {
      const optionsRes = await fetch(`${API_URL}/admin-auth/setup/options`, {
        method: "POST",
        headers: { "X-Setup-Token": setupToken },
        credentials: "include",
      });
      if (!optionsRes.ok) {
        const body = await optionsRes.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to start setup");
      }
      const optionsJSON = await optionsRes.json();

      const response = await startRegistration({ optionsJSON });

      const verifyRes = await fetch(`${API_URL}/admin-auth/setup/verify`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Setup-Token": setupToken,
        },
        credentials: "include",
        body: JSON.stringify({ response, label: label || "First passkey" }),
      });
      if (!verifyRes.ok) {
        const body = await verifyRes.json().catch(() => ({}));
        throw new Error(body.error ?? "Setup verification failed");
      }
      const { recoveryCodes: codes } = await verifyRes.json();
      setRecoveryCodes(codes);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Setup failed");
    } finally {
      setLoading(false);
    }
  }

  if (recoveryCodes) {
    return (
      <main>
        <h1>Save these recovery codes now</h1>
        <p>
          Shown exactly once. Store them in a password manager immediately —
          each is single-use, for the rare case every passkey is lost at once.
        </p>
        <pre
          style={{ padding: "1rem", border: "1px solid var(--border, #ccc)" }}
        >
          {recoveryCodes.join("\n")}
        </pre>
        <p>
          Setup is complete.{" "}
          <strong>Rotate or delete the ADMIN_SETUP_TOKEN secret now</strong> so
          this page can never register a second identity. Then go to{" "}
          <a href="/admin">/admin</a>.
        </p>
      </main>
    );
  }

  return (
    <main>
      <h1>Admin setup (one-time)</h1>
      {error && (
        <p role="alert" style={{ color: "var(--error, crimson)" }}>
          {error}
        </p>
      )}
      <label>
        Setup token
        <input
          type="password"
          value={setupToken}
          onChange={(e) => setSetupToken(e.target.value)}
          autoFocus
        />
      </label>
      <label>
        Label for this passkey
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="e.g. MacBook Touch ID"
        />
      </label>
      <div style={{ marginTop: "0.75rem" }}>
        <button
          type="button"
          disabled={loading || !setupToken}
          onClick={() => void handleSetup()}
        >
          {loading ? "Setting up…" : "Register first passkey"}
        </button>
      </div>
    </main>
  );
}

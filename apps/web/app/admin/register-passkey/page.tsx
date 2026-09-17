"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { startRegistration } from "@simplewebauthn/browser";
import { adminFetch } from "../admin-fetch";

function RegisterPasskeyForm() {
  const router = useRouter();
  const fromRecovery = useSearchParams().get("fromRecovery") === "1";
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleRegister() {
    setLoading(true);
    setError(null);
    try {
      const optionsRes = await adminFetch("/admin-auth/register/options", {
        method: "POST",
      });
      if (!optionsRes.ok)
        throw new Error("Failed to start passkey registration");
      const optionsJSON = await optionsRes.json();

      const response = await startRegistration({ optionsJSON });

      const verifyRes = await adminFetch("/admin-auth/register/verify", {
        method: "POST",
        body: JSON.stringify({ response, label: label || "Untitled passkey" }),
      });
      if (!verifyRes.ok) {
        const body = await verifyRes.json().catch(() => ({}));
        throw new Error(body.error ?? "Passkey registration failed");
      }
      router.push("/admin");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Passkey registration failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main>
      <h1>Register a passkey</h1>
      {fromRecovery && (
        <p>
          You signed in with a recovery code — register a new passkey now to
          restore normal sign-in before continuing.
        </p>
      )}

      {error && (
        <p role="alert" style={{ color: "var(--error, crimson)" }}>
          {error}
        </p>
      )}

      <label>
        Label (e.g. &ldquo;MacBook Touch ID&rdquo;)
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          autoFocus
        />
      </label>
      <div style={{ marginTop: "0.75rem" }}>
        <button
          type="button"
          disabled={loading}
          onClick={() => void handleRegister()}
        >
          {loading ? "Registering…" : "Register this device"}
        </button>
      </div>
    </main>
  );
}

export default function RegisterPasskeyPage() {
  return (
    <Suspense fallback={null}>
      <RegisterPasskeyForm />
    </Suspense>
  );
}

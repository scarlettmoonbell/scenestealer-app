"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { startAuthentication } from "@simplewebauthn/browser";
import { adminFetch } from "../admin-fetch";

export default function AdminLoginPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [useRecoveryCode, setUseRecoveryCode] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState("");

  async function handlePasskeyLogin() {
    setLoading(true);
    setError(null);
    try {
      const optionsRes = await adminFetch("/admin-auth/login/options", {
        method: "POST",
      });
      if (!optionsRes.ok) throw new Error("Failed to start passkey sign-in");
      const optionsJSON = await optionsRes.json();

      const response = await startAuthentication({ optionsJSON });

      const verifyRes = await adminFetch("/admin-auth/login/verify", {
        method: "POST",
        body: JSON.stringify({ response }),
      });
      if (!verifyRes.ok) {
        const body = await verifyRes.json().catch(() => ({}));
        throw new Error(body.error ?? "Passkey sign-in failed");
      }
      router.push("/admin");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Passkey sign-in failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleRecoveryCodeLogin() {
    setLoading(true);
    setError(null);
    try {
      const res = await adminFetch("/admin-auth/recovery/redeem", {
        method: "POST",
        body: JSON.stringify({ code: recoveryCode }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Recovery code rejected");
      }
      // Server issued a session, but a recovery code is a break-glass
      // path, not a standing login method — force registering a fresh
      // passkey before landing on the real dashboard.
      router.push("/admin/register-passkey?fromRecovery=1");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Recovery code rejected");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main>
      <h1>SceneStealer Admin</h1>

      {error && (
        <p role="alert" style={{ color: "var(--error, crimson)" }}>
          {error}
        </p>
      )}

      {!useRecoveryCode ? (
        <>
          <button
            type="button"
            disabled={loading}
            onClick={() => void handlePasskeyLogin()}
          >
            {loading ? "Signing in…" : "Sign in with passkey"}
          </button>
          <p>
            <button
              type="button"
              onClick={() => setUseRecoveryCode(true)}
              style={{ background: "none", border: "none", textDecoration: "underline", cursor: "pointer" }}
            >
              Use a recovery code instead
            </button>
          </p>
        </>
      ) : (
        <>
          <label>
            Recovery code
            <input
              type="text"
              value={recoveryCode}
              onChange={(e) => setRecoveryCode(e.target.value)}
              placeholder="xxxxx-xxxxx-xxxxx-xxxxx"
              autoFocus
            />
          </label>
          <div style={{ display: "flex", gap: "0.75rem", marginTop: "0.75rem" }}>
            <button
              type="button"
              disabled={loading || !recoveryCode.trim()}
              onClick={() => void handleRecoveryCodeLogin()}
            >
              {loading ? "Verifying…" : "Redeem code"}
            </button>
            <button type="button" onClick={() => setUseRecoveryCode(false)}>
              Back to passkey
            </button>
          </div>
        </>
      )}
    </main>
  );
}

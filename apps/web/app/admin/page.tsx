"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { adminFetch } from "./admin-fetch";

interface TenantSummary {
  id: string;
  name: string;
  clerkOrgId: string;
  createdAt: string;
  sourceVideoCount: number;
  clipCount: number;
  connectionCount: number;
  publishedPostCount: number;
}

interface Failure {
  kind: "post" | "analysis" | "render";
  id: string;
  tenantId: string;
  error: string | null;
  occurredAt: string;
}

// `borderCollapse: "collapse"` leaves zero gap between adjacent cells
// with no padding of their own — harmless for a single left-aligned
// column, but a right-aligned number next to a left-aligned column runs
// straight into it (e.g. "Published"/"Created" rendered as one smashed
// "08/7/2026"). Every th/td gets this so alignment stays consistent.
const cellStyle = { padding: "0.35rem 1rem 0.35rem 0" };

// Real enforcement lives on the API (requireAdmin) — this page's own
// redirect-on-401 is UX only, same discipline as the tenant-facing
// pages' own client-side auth checks.
export default function AdminDashboardPage() {
  const router = useRouter();
  const [tenants, setTenants] = useState<TenantSummary[] | null>(null);
  const [failures, setFailures] = useState<Failure[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [tenantsRes, failuresRes] = await Promise.all([
      adminFetch("/admin/tenants"),
      adminFetch("/admin/failures"),
    ]);
    if (tenantsRes.status === 401 || failuresRes.status === 401) {
      router.push("/admin/login");
      return;
    }
    if (!tenantsRes.ok || !failuresRes.ok) {
      setError("Failed to load admin data");
      return;
    }
    setTenants((await tenantsRes.json()).tenants);
    setFailures((await failuresRes.json()).failures);
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleLogout() {
    await adminFetch("/admin-auth/logout", { method: "POST" });
    router.push("/admin/login");
  }

  return (
    <main>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <h1>SceneStealer Admin</h1>
        <div style={{ display: "flex", gap: "1rem" }}>
          <Link href="/admin/register-passkey">Add a passkey</Link>
          <button type="button" onClick={() => void handleLogout()}>
            Sign out
          </button>
        </div>
      </div>

      {error && <p role="alert">{error}</p>}

      <h2>Tenants</h2>
      {!tenants ? (
        <p>Loading…</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th align="left" style={cellStyle}>
                Name
              </th>
              <th align="right" style={cellStyle}>
                Videos
              </th>
              <th align="right" style={cellStyle}>
                Clips
              </th>
              <th align="right" style={cellStyle}>
                Connections
              </th>
              <th align="right" style={cellStyle}>
                Published
              </th>
              <th align="left" style={cellStyle}>
                Created
              </th>
            </tr>
          </thead>
          <tbody>
            {tenants.map((t) => (
              <tr key={t.id}>
                <td style={cellStyle}>{t.name}</td>
                <td align="right" style={cellStyle}>
                  {t.sourceVideoCount}
                </td>
                <td align="right" style={cellStyle}>
                  {t.clipCount}
                </td>
                <td align="right" style={cellStyle}>
                  {t.connectionCount}
                </td>
                <td align="right" style={cellStyle}>
                  {t.publishedPostCount}
                </td>
                <td style={cellStyle}>
                  {new Date(t.createdAt).toLocaleDateString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>Recent failures (all tenants)</h2>
      {!failures ? (
        <p>Loading…</p>
      ) : failures.length === 0 ? (
        <p>None.</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th align="left" style={cellStyle}>
                Kind
              </th>
              <th align="left" style={cellStyle}>
                Tenant
              </th>
              <th align="left" style={cellStyle}>
                Error
              </th>
              <th align="left" style={cellStyle}>
                When
              </th>
            </tr>
          </thead>
          <tbody>
            {failures.map((f) => (
              <tr key={`${f.kind}-${f.id}`}>
                <td style={cellStyle}>{f.kind}</td>
                <td style={cellStyle}>{f.tenantId}</td>
                <td style={cellStyle}>{f.error}</td>
                <td style={cellStyle}>
                  {new Date(f.occurredAt).toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}

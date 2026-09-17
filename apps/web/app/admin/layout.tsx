import type { ReactNode } from "react";

// Deliberately does NOT wrap with <ClerkProvider> (unlike the root
// layout) — this whole subtree uses standalone WebAuthn (see
// apps/api/src/routes/admin-auth.ts), with zero dependency on Clerk's
// session/provider. That's the actual point of this auth boundary: a
// bug or compromise in Clerk's side can't reach this one, and vice versa.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "SceneStealer Admin",
};

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div style={{ maxWidth: 960, margin: "0 auto", padding: "24px" }}>
      {children}
    </div>
  );
}

import { ClerkProvider } from "@clerk/nextjs";
import type { ReactNode } from "react";

// Every route in this app is behind Clerk auth and per-tenant, so nothing
// here should be statically prerendered — also sidesteps `next build`
// needing a live Clerk publishableKey just to prerender a static shell.
export const dynamic = "force-dynamic";

// Deployed via @cloudflare/next-on-pages, which requires every
// server-rendered route to explicitly opt into the Edge Runtime (Workers
// has no Node.js runtime for SSR) — set once here so it cascades to every
// route under this layout instead of repeating it per page.
export const runtime = "edge";

export const metadata = {
  title: "SceneStealer",
  description: "Turn full-length show recordings into clips, automatically.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="en">
        <body>{children}</body>
      </html>
    </ClerkProvider>
  );
}

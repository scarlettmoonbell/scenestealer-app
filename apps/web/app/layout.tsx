import {
  ClerkProvider,
  OrganizationSwitcher,
  Show,
  UserButton,
} from "@clerk/nextjs";
import Link from "next/link";
import type { ReactNode } from "react";
import "./globals.css";
import { SiteHeader } from "./site-header";

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
  // Meta's domain-verification step for the Facebook Page/app —
  // proves control of scenestealer.app, doesn't grant Meta any access.
  other: {
    "facebook-domain-verification": "zdqliv5rchz1qpnarwxwktp9klsxvi",
  },
  icons: {
    // Same two self-contained icon badges the header swaps between —
    // media-matched so the tab icon follows the browser's own theme.
    icon: [
      {
        url: "/logo-light.svg",
        media: "(prefers-color-scheme: light)",
      },
      {
        url: "/logo-dark.svg",
        media: "(prefers-color-scheme: dark)",
      },
      { url: "/logo-light.svg" },
    ],
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ClerkProvider>
          <SiteHeader
            right={
              <Show when="signed-in">
                <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                  <OrganizationSwitcher hidePersonal />
                  <UserButton />
                </div>
              </Show>
            }
          />
          {children}
        </ClerkProvider>
        <footer
          style={{
            display: "flex",
            gap: "1rem",
            justifyContent: "center",
            padding: "2rem 1rem",
            fontSize: "0.85em",
            opacity: 0.7,
          }}
        >
          <Link href="/about">About</Link>
          <Link href="/contact">Contact</Link>
          <Link href="/privacy">Privacy Policy</Link>
          <Link href="/terms">Terms of Service</Link>
          <Link href="/data-deletion">Data Deletion</Link>
        </footer>
      </body>
    </html>
  );
}

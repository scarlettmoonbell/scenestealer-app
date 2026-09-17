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
import { SocialLinks } from "./social-links";

// Every route in this app is behind Clerk auth and per-tenant, so nothing
// here should be statically prerendered — also sidesteps `next build`
// needing a live Clerk publishableKey just to prerender a static shell.
export const dynamic = "force-dynamic";

// Deployed via @opennextjs/cloudflare (migrated 2026-09-17 off the
// deprecated @cloudflare/next-on-pages, which required every route to
// opt into the Edge Runtime explicitly). OpenNext runs on Workers'
// Node.js compat layer by default and does NOT support `runtime =
// "edge"` cascading from a layout onto regular pages — confirmed for
// real: the build fails outright ("OpenNext requires edge runtime
// function to be defined in a separate function") with this left in.
// Not needed anyway — Workers are edge-native regardless of this flag.

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
            flexDirection: "column",
            gap: "1rem",
            alignItems: "center",
            padding: "2rem 1rem",
          }}
        >
          <div
            style={{
              display: "flex",
              gap: "1rem",
              justifyContent: "center",
              flexWrap: "wrap",
              fontSize: "0.85em",
              opacity: 0.7,
            }}
          >
            <Link href="/docs">Documentation</Link>
            <Link href="/about">About</Link>
            <Link href="/contact">Contact</Link>
            <Link href="/privacy">Privacy Policy</Link>
            <Link href="/terms">Terms of Service</Link>
            <Link href="/data-deletion">Data Deletion</Link>
          </div>
          <SocialLinks />
        </footer>
      </body>
    </html>
  );
}

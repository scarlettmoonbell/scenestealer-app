import { ClerkProvider } from "@clerk/nextjs";
import type { ReactNode } from "react";

// Every route in this app is behind Clerk auth and per-tenant, so nothing
// here should be statically prerendered — also sidesteps `next build`
// needing a live Clerk publishableKey just to prerender a static shell.
export const dynamic = "force-dynamic";

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

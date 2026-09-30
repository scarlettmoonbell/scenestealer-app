"use client";

import { SignIn } from "@clerk/nextjs";
import { useClerkThemeVariables } from "./clerk-theme";

// Clerk's <SignIn/> renders its own light-themed card by default —
// without this it shows as a stark white box against our dark-mode
// background. See clerk-theme.ts for the shared palette/detection
// logic (also used by account-menu.tsx for the header's account/org
// menus).
export function ThemedSignIn() {
  const variables = useClerkThemeVariables();

  return (
    <SignIn
      routing="hash"
      // Explicit rather than relying on Clerk Dashboard "Paths"
      // defaults — bit us for real 2026-09-18 when dev's Clerk
      // Application was split from production's: a fresh Application's
      // Paths default to Clerk's hosted Account Portal, so signing up
      // (which <SignIn/> handles internally, no separate <SignUp/>
      // needed) stranded the user on Clerk's own domain instead of
      // returning to the app. These make the redirect behavior
      // independent of any given Application's Dashboard config.
      fallbackRedirectUrl="/"
      signUpFallbackRedirectUrl="/"
      appearance={{
        variables,
        elements: {
          rootBox: { width: "100%" },
          card: { boxShadow: "none", border: "none", width: "100%" },
          headerTitle: { display: "none" },
          headerSubtitle: { display: "none" },
        },
      }}
    />
  );
}

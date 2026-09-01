"use client";

import { SignIn } from "@clerk/nextjs";
import { useEffect, useState } from "react";

// Clerk's <SignIn/> renders its own light-themed card by default —
// without this it shows as a stark white box against our dark-mode
// background. prefers-color-scheme isn't knowable at server-render
// time, so this detects it client-side after mount (a brief flash to
// the wrong theme on a dark-mode system is the accepted tradeoff,
// same as any client-only theme detection). Themed via Clerk's own
// `variables` (not @clerk/themes' baseTheme — that package's Theme
// type doesn't match this installed @clerk/nextjs version's Variables
// type, a real version-skew issue, not worth forcing through).
export function ThemedSignIn() {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    setIsDark(query.matches);
    const listener = (e: MediaQueryListEvent) => setIsDark(e.matches);
    query.addEventListener("change", listener);
    return () => query.removeEventListener("change", listener);
  }, []);

  const variables = isDark
    ? {
        colorPrimary: "#4f8ef7",
        colorBackground: "#15151d",
        colorForeground: "#e4e4e9",
        colorMutedForeground: "#9a9aa5",
        colorInput: "#1c1c26",
        colorInputForeground: "#e4e4e9",
        colorNeutral: "white",
        colorBorder: "rgba(255, 255, 255, 0.09)",
      }
    : {
        colorPrimary: "#4f8ef7",
        colorBackground: "#ffffff",
        colorForeground: "#1f1b24",
        colorMutedForeground: "#6b6470",
        colorInput: "#ffffff",
        colorInputForeground: "#1f1b24",
        colorNeutral: "black",
        colorBorder: "rgba(61, 31, 71, 0.13)",
      };

  return (
    <SignIn
      routing="hash"
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

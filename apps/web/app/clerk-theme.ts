"use client";

import { useEffect, useState } from "react";

// Clerk's own components render with a stock light theme by default —
// unthemed against this app's dark-mode-aware palette, they show up as
// a jarring mismatched white popover/card. prefers-color-scheme isn't
// knowable at server-render time, so this detects it client-side after
// mount (a brief flash to the wrong theme on a dark-mode system is the
// accepted tradeoff, same as any client-only theme detection).
//
// Originally lived only in themed-sign-in.tsx (for <SignIn/>); shared
// here so the account/org menu theming below doesn't duplicate the
// same palette a third time. Themed via Clerk's own `variables` (not
// @clerk/themes' baseTheme — that package's Theme type doesn't match
// this installed @clerk/nextjs version's Variables type, a real
// version-skew issue, not worth forcing through).
export function useClerkThemeVariables() {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    setIsDark(query.matches);
    const listener = (e: MediaQueryListEvent) => setIsDark(e.matches);
    query.addEventListener("change", listener);
    return () => query.removeEventListener("change", listener);
  }, []);

  return isDark
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
}

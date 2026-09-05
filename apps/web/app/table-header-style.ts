import type { CSSProperties } from "react";

// The uppercase, letter-spaced look from the "Your templates" table
// (apps/web/app/templates/page.tsx) — now the shared style for every
// column-header row in the app. Blue via var(--accent-text), the same
// WCAG-AA-safe accent already used for links, rather than a new
// one-off color that'd need its own light/dark contrast check.
export const TABLE_HEADER_STYLE: CSSProperties = {
  fontSize: "0.85em",
  fontWeight: 600,
  color: "var(--accent-text)",
  textTransform: "uppercase",
  letterSpacing: "0.03em",
};

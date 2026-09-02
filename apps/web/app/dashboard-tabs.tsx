"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/", label: "Media" },
  { href: "/connections", label: "Connected Accounts" },
  { href: "/templates", label: "Caption Templates" },
] as const;

// Shared across the signed-in dashboard's three pages — a real routed
// tab bar (each tab is a Link, not client-side state) so every view
// keeps its own URL, and none of the three is a dead end.
export function DashboardTabs() {
  const pathname = usePathname();

  return (
    <div
      role="tablist"
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 24,
        borderBottom: "1px solid var(--border)",
        marginBottom: "1.5rem",
      }}
    >
      {TABS.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            role="tab"
            aria-selected={active}
            style={{
              display: "inline-block",
              padding: "0 0 12px",
              marginBottom: -1,
              borderBottom: active
                ? "2px solid var(--accent)"
                : "2px solid transparent",
              fontFamily: "'Bodoni Moda', Georgia, serif",
              fontSize: 18,
              fontWeight: 500,
              color: active ? "var(--heading)" : "var(--muted)",
              textDecoration: "none",
            }}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}

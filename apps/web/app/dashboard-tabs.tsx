"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Connected Accounts and Settings last — once a tenant has connected
// their accounts, both tabs need minimal ongoing attention compared to
// Media/Templates.
const TABS = [
  { href: "/", label: "Media" },
  { href: "/scheduled", label: "Scheduling" },
  { href: "/templates", label: "Caption Templates" },
  { href: "/connections", label: "Connected Accounts" },
  { href: "/settings", label: "Settings" },
  { href: "/account", label: "Account" },
] as const;

// Shared across every signed-in dashboard page — a real routed tab bar
// (each tab is a Link, not client-side state) so every view keeps its
// own URL, and none of them is a dead end.
//
// Deliberately self-contained at the same 1160px width SiteHeader uses,
// rather than inheriting whatever maxWidth a given page's own <main>
// picks for its content column — settings/page.tsx and account/page.tsx
// both use a narrower 720px column for their own content, which used to
// squeeze the tab row down with them and force an unnecessary wrap even
// on wide windows. The tab bar now wraps only when the viewport itself
// is too narrow for all six tabs, not when a page's content happens to
// be narrow.
export function DashboardTabs() {
  const pathname = usePathname();

  return (
    <div
      style={{
        display: "flex",
        justifyContent: "center",
        borderBottom: "1px solid var(--border)",
        marginBottom: "1.5rem",
      }}
    >
      <div
        role="tablist"
        style={{
          width: "100%",
          maxWidth: 1160,
          padding: "0 24px",
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          gap: "4px 24px",
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
    </div>
  );
}

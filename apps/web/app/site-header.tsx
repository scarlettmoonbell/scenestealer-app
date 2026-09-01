import Link from "next/link";
import type { ReactNode } from "react";

// Two logo variants ship as static assets (self-contained square badges,
// each with its own background) — swapping which one is visible is done
// in globals.css via the same prefers-color-scheme/data-theme pattern
// the rest of the theming uses, so it needs no client JS.
export function SiteHeader({ right }: { right?: ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "center",
        borderBottom: "1px solid var(--border)",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 1160,
          padding: "18px 24px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
        }}
      >
        <Link
          href="/"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            color: "var(--heading)",
            textDecoration: "none",
          }}
        >
          <img
            src="/logo-light.svg"
            alt=""
            width={44}
            height={44}
            className="logo-light"
            style={{ borderRadius: 10 }}
          />
          <img
            src="/logo-dark.svg"
            alt=""
            width={44}
            height={44}
            className="logo-dark"
            style={{ borderRadius: 10 }}
          />
          <span
            style={{
              fontFamily: "'Bodoni Moda', Georgia, serif",
              fontSize: 28,
              fontWeight: 600,
              letterSpacing: "0.3px",
            }}
          >
            SceneStealer
          </span>
        </Link>
        {right}
      </div>
    </div>
  );
}

// NEXT_PUBLIC_ENVIRONMENT is only set to "dev" by deploy-dev.yml's cf:build
// step — production's build never sets it, so this compiles away to null
// there. Sticky (not fixed) so it stays visible while scrolling without
// needing extra body padding to compensate for removing it from flow.
const IS_DEV_SITE = process.env.NEXT_PUBLIC_ENVIRONMENT === "dev";

export function DevBanner() {
  if (!IS_DEV_SITE) return null;

  return (
    <div
      style={{
        position: "sticky",
        top: 0,
        zIndex: 50,
        textAlign: "center",
        padding: "6px 12px",
        fontSize: "0.8rem",
        fontWeight: 700,
        letterSpacing: "0.03em",
        textTransform: "uppercase",
        color: "#1f1b24",
        background: "var(--warm)",
      }}
    >
      Development Site — not production
    </div>
  );
}

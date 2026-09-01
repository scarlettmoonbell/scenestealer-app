// "Stealer" always renders in the icon's accent blue — the same
// two-tone treatment everywhere the product name appears as text, so
// it doesn't drift out of sync between the header, tabs, and copy
// pages.
export function Brand() {
  return (
    <>
      Scene<span style={{ color: "#4f8ef7" }}>Stealer</span>
    </>
  );
}

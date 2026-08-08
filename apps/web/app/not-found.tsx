// Next's auto-generated /_not-found route doesn't reliably inherit
// `runtime = "edge"` from the root layout without an explicit file here —
// @cloudflare/next-on-pages requires every route to declare it.
export const runtime = "edge";

export default function NotFound() {
  return (
    <main>
      <h1>Not found</h1>
      <p>That page doesn&apos;t exist.</p>
    </main>
  );
}

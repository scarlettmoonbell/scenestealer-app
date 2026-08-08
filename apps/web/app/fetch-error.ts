// A network-level fetch failure (CORS block, DNS failure, connection
// refused) throws a bare TypeError whose message is a browser-specific,
// non-actionable string ("Load failed" in Safari, "Failed to fetch" in
// Chrome) — indistinguishable, to a user, from every other kind of error.
// Surface those cases explicitly instead of passing the raw message through.
export function describeFetchError(e: unknown): string {
  if (e instanceof TypeError) {
    console.error("Network-level fetch failure:", e);
    return "Couldn't reach the server. Check your connection, or the API/storage service may be down or misconfigured.";
  }
  if (e instanceof Error) return e.message;
  return "Something went wrong";
}

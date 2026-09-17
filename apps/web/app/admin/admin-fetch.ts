const API_URL = process.env.NEXT_PUBLIC_API_URL;

// Mirrors ../use-authed-fetch.ts's shape, but cookie-based rather than
// bearer-token — the admin session lives in an HttpOnly cookie
// (apps/api/src/routes/admin-auth.ts), so there's no token to attach
// client-side even if we wanted to. `credentials: "include"` is required
// for the cookie to travel on this cross-subdomain (same-site, not
// same-origin) fetch — see index.ts's CORS comment for the other half.
export async function adminFetch(path: string, init?: RequestInit) {
  return fetch(`${API_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
}

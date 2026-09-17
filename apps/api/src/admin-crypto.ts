// Small shared helpers for the admin passkey/session/recovery-code flow —
// used by both auth.ts (requireAdmin) and routes/admin-auth.ts. Kept
// separate from those so the hashing/encoding logic has one place to be
// correct, rather than duplicated inline.

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// Round-trip helpers for storing a WebAuthn credential's public key
// (a Uint8Array) as text in Postgres.
export function bytesToBase64url(bytes: Uint8Array): string {
  return base64url(bytes);
}

export function base64urlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded.padEnd(padded.length + ((4 - (padded.length % 4)) % 4), "="));
  // Uint8Array.from(...) types as Uint8Array<ArrayBufferLike> — too loose
  // for @simplewebauthn/server's stricter Uint8Array<ArrayBuffer> param.
  // Allocating explicitly and copying in guarantees a real ArrayBuffer.
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// 256 bits of entropy — used for both session tokens and recovery codes.
// Only the hash (sha256Hex above) is ever stored.
export function randomToken(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

export { sha256Hex };

// Recovery codes are meant to be typed/copied by a human, so a shorter,
// visually distinct format than a full random token — still 20 bytes
// (160 bits) of entropy, comfortably enough to resist guessing since
// they're also rate-limited by being single-use and requiring an exact
// hash match.
export function generateRecoveryCode(): string {
  const raw = base64url(crypto.getRandomValues(new Uint8Array(20)));
  return raw.match(/.{1,5}/g)!.join("-");
}

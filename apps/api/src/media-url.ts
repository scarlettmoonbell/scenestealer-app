import type { Env } from "./index.js";

// Confirmed live 2026-09-08 against the real R2 bucket: a SigV4
// presigned URL is strictly bound to the single HTTP method it was
// signed for — a GET-signed URL 403s on HEAD (and vice versa), with no
// Content-Length on the error response either. Postiz's YouTube provider
// does exactly that: a HEAD to size the upload, then ranged GETs against
// the *same* URL to stream it — something no single R2 presigned URL can
// satisfy. This module signs a URL to our own /media route instead,
// which live-signs a fresh per-method R2 request server-side on every
// call rather than reusing one static presigned URL, sidestepping the
// method-binding limitation entirely.

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(message),
  );
  return btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function signMediaUrl(
  env: Env,
  key: string,
  expiresInSeconds = 3600,
): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + expiresInSeconds;
  const sig = await hmac(env.MEDIA_URL_SECRET, `${key}:${exp}`);
  // Postiz validates this URL itself before ever creating the post
  // (libraries/helpers/src/utils/valid.url.path.ts's ValidUrlExtension,
  // confirmed live 2026-09-08 after this exact gap 400'd a real publish
  // attempt): it strips everything from the first "?" onward and checks
  // *that* ends in .png/.jpg/.jpeg/.gif/.webp/.mp4 — a bare `/media?...`
  // path fails outright, regardless of the query string. The filename
  // segment's actual text is otherwise unused; routes/media.ts identifies
  // the real object purely from the `key` query param below.
  const extMatch = /\.[a-zA-Z0-9]+$/.exec(key);
  const ext = extMatch ? extMatch[0] : ".mp4";
  const url = new URL(`${env.API_ORIGIN}/media/clip${ext}`);
  url.searchParams.set("key", key);
  url.searchParams.set("exp", String(exp));
  url.searchParams.set("sig", sig);
  return url.toString();
}

export async function verifyMediaUrl(
  env: Env,
  key: string,
  exp: string,
  sig: string,
): Promise<boolean> {
  const expNum = Number(exp);
  if (!Number.isFinite(expNum) || expNum < Date.now() / 1000) {
    return false;
  }
  const expected = await hmac(env.MEDIA_URL_SECRET, `${key}:${exp}`);
  // Same length check + per-char comparison as a real timing-safe
  // compare — both sig and expected are fixed-shape base64url HMAC
  // output, never attacker-controlled length information worth hiding
  // further than this.
  if (sig.length !== expected.length) {
    return false;
  }
  let mismatch = 0;
  for (let i = 0; i < sig.length; i++) {
    mismatch |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return mismatch === 0;
}

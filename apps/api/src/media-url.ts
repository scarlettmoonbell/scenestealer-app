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

// 24h, not 1h: confirmed for real (2026-09-11) that a clean, correctly
// formatted render (faststart, no timecode track, verified separately
// against Meta's API directly — container reached FINISHED in minutes)
// still failed via the real publish flow with the same opaque 2207076
// "processing failed" status. Root cause isn't the file: Instagram's
// container model creates the container immediately (postPending) but
// only fetches/transcodes the video_url asynchronously, later, as a
// separate Temporal-orchestrated step (checkPostStatus) — and this
// Postiz instance has a documented, recurring pattern of its Temporal
// orchestrator hanging for extended periods (see ROADMAP.md), which
// could easily push that real fetch past a 1h-old signature. Instagram
// itself expires an unpublished container after 24h (status_code
// "EXPIRED") — matching our own URL's lifetime to that ceiling removes
// the race entirely rather than guessing at how long is "long enough".
const DEFAULT_MEDIA_URL_TTL_SECONDS = 24 * 60 * 60;

export async function signMediaUrl(
  env: Env,
  key: string,
  expiresInSeconds = DEFAULT_MEDIA_URL_TTL_SECONDS,
): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + expiresInSeconds;
  const sig = await hmac(env.MEDIA_URL_SECRET, `${key}:${exp}`);
  // Postiz validates this URL itself before ever creating the post
  // (libraries/helpers/src/utils/valid.url.path.ts's ValidUrlExtension,
  // confirmed live 2026-09-08 after this exact gap 400'd a real publish
  // attempt): it strips everything from the first "?" onward and checks
  // *that* ends in .png/.jpg/.jpeg/.gif/.webp/.mp4.
  //
  // exp/sig/key live in the PATH, not the query string, for a second,
  // more serious reason than that check: confirmed for real (2026-09-11)
  // that Postiz's own InstagramProvider.postPending splices this whole
  // URL into ITS OWN outbound query string with no encodeURIComponent
  // (`video_url=${m.path}&media_type=REELS&...`) — a query string of
  // our own here means our "&exp=...&sig=..." gets read as *Meta's*
  // top-level params instead, truncating the video_url Meta actually
  // receives right after "key=...". Meta doesn't validate that
  // truncated URL synchronously (the container still gets created), so
  // this surfaced later and looked exactly like a processing failure
  // ("Media upload has failed with error code 2207076") — not a video
  // problem at all; confirmed by calling Meta's API directly with this
  // exact rendered file and a normal JSON body, which worked (container
  // reached FINISHED) every time. A path with no "?" or "&" anywhere is
  // immune to this regardless of what Postiz (or anything else) does to
  // it. verifyMediaUrl's HMAC target is unchanged (`${key}:${exp}`) —
  // only how the three values travel changed.
  const extMatch = /\.[a-zA-Z0-9]+$/.exec(key);
  const ext = extMatch ? extMatch[0] : ".mp4";
  return `${env.API_ORIGIN}/media/${exp}/${sig}/${encodeURIComponent(key)}/clip${ext}`;
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

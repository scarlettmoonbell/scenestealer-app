import { AwsClient } from "aws4fetch";
import { Hono } from "hono";
import { decodeMediaKey, verifyMediaUrl } from "../media-url.js";
import type { Env } from "../index.js";

// No Variables generic (same reason as routes/internal.ts) — this is
// fetched directly by Postiz's/the platforms' own servers, which carry
// no Clerk session, so it isn't mounted under requireTenant. Authenticated
// instead with a signed key+expiry (see media-url.ts's verifyMediaUrl).
export const mediaRoute = new Hono<{ Bindings: Env }>();

// Proxies a single R2 object for both GET (ranged or not) and HEAD,
// signing a fresh, real request to R2 server-side per incoming request
// instead of reusing one static presigned URL — see media-url.ts's
// top comment for why a presigned URL alone can't do this.
//
// exp/sig/key live in the path, not the query string — see
// signMediaUrl's own comment for why a query string here breaks once
// Postiz splices the whole URL into its own, unescaped one. The
// trailing `:filename` segment is never read — it exists only so the
// URL ends in a real extension, since Postiz's own request validation
// (confirmed live 2026-09-08) rejects a media URL outright unless it
// does. The real object is identified purely by `:key` below.
mediaRoute.on(["GET", "HEAD"], "/:exp/:sig/:key/:filename", async (c) => {
  const exp = c.req.param("exp");
  const sig = c.req.param("sig");
  const encodedKey = c.req.param("key");
  if (!encodedKey || !exp || !sig) {
    return c.text("Bad request", 400);
  }

  let key: string;
  try {
    key = decodeMediaKey(encodedKey);
  } catch {
    return c.text("Bad request", 400);
  }
  if (!(await verifyMediaUrl(c.env, key, exp, sig))) {
    return c.text("Forbidden", 403);
  }

  const client = new AwsClient({
    accessKeyId: c.env.R2_ACCESS_KEY_ID,
    secretAccessKey: c.env.R2_SECRET_ACCESS_KEY,
    region: "auto",
    service: "s3",
  });
  const url = `https://${c.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${c.env.R2_BUCKET_NAME}/${key}`;
  const range = c.req.header("range");

  const upstream = await client.fetch(url, {
    method: c.req.method,
    headers: range ? { Range: range, "Accept-Encoding": "identity" } : {},
  });

  const headers = new Headers(upstream.headers);
  headers.delete("content-encoding");
  return new Response(c.req.method === "HEAD" ? null : upstream.body, {
    status: upstream.status,
    headers,
  });
});

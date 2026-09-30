import { neon } from "@neondatabase/serverless";
import type { Env } from "./index.js";

// Postiz's own public API (postiz.ts) has no endpoint for reading a
// connected Page's actual content back — only creating posts and checking
// publish status. Reading real Page content (needed to genuinely exercise
// Meta's pages_read_engagement permission, not just claim it) requires a
// Facebook Page Access Token, which Postiz holds internally and never
// exposes. Rather than forking Postiz to add a proxy endpoint (it's
// deliberately left untouched everywhere else in this codebase — see
// apps/postiz-proxy's own comments), this reads Postiz's `Integration`
// row directly from its own Neon database: confirmed live (2026-09-18)
// that `token` is stored plaintext and is already the Page-scoped token
// (Postiz uses it directly to publish to the Page), and `internalId` is
// the real Facebook Page ID — not Postiz's own `id` (a cuid, that's
// what socialConnections.postizIntegrationId stores). Read-only,
// single-purpose: this is not a general Postiz DB client, and nothing
// here writes to Postiz's database.
export interface PostizFacebookToken {
  pageId: string;
  accessToken: string;
}

export async function getPostizFacebookToken(
  env: Env,
  postizIntegrationId: string,
): Promise<PostizFacebookToken | null> {
  if (!env.POSTIZ_DATABASE_URL) {
    console.error("getPostizFacebookToken: POSTIZ_DATABASE_URL is not set");
    return null;
  }

  const sql = neon(env.POSTIZ_DATABASE_URL);
  const rows = await sql`
    select "internalId" as "pageId", token as "accessToken"
    from public."Integration"
    where id = ${postizIntegrationId}
      and "providerIdentifier" = 'facebook'
      and "deletedAt" is null
    limit 1
  `;
  const row = rows[0] as PostizFacebookToken | undefined;
  if (!row) {
    console.error(
      `getPostizFacebookToken: no matching Integration row for postizIntegrationId=${postizIntegrationId}`,
    );
  }
  return row ?? null;
}

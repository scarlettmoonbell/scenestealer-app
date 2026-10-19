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

export interface PostizPublishedPost {
  provider: "facebook" | "instagram";
  // The platform's own id for what Postiz published: a Facebook video id
  // (Postiz publishes clips via /{page}/videos) or an Instagram media id
  // (from media_publish).
  releaseId: string;
  pageAccessToken: string;
}

// Looks up one post Postiz published, by Postiz's own post id (what
// posts.externalPostId stores), along with the Page token needed to read
// its comments/insights. Scoped by integration id too, so a post id can
// only resolve through the connection it was actually published with.
export async function getPostizPublishedPost(
  env: Env,
  postizPostId: string,
  postizIntegrationId: string,
): Promise<PostizPublishedPost | null> {
  if (!env.POSTIZ_DATABASE_URL) {
    console.error("getPostizPublishedPost: POSTIZ_DATABASE_URL is not set");
    return null;
  }

  const sql = neon(env.POSTIZ_DATABASE_URL);
  const rows = await sql`
    select p."releaseId" as "releaseId",
           i."providerIdentifier" as "provider",
           i.token as "token"
    from public."Post" p
    join public."Integration" i on i.id = p."integrationId"
    where p.id = ${postizPostId}
      and p."integrationId" = ${postizIntegrationId}
      and p."deletedAt" is null
      and i."deletedAt" is null
      and i."providerIdentifier" in ('facebook', 'instagram')
    limit 1
  `;
  const row = rows[0] as
    { releaseId: string | null; provider: string; token: string } | undefined;
  if (!row?.releaseId) return null;

  return {
    provider: row.provider as "facebook" | "instagram",
    releaseId: row.releaseId,
    // Postiz's Instagram (via Facebook Login) integration stores
    // "<pageToken>___<userToken>"; the Page token is what the Instagram
    // Graph API calls need. Facebook integrations store the Page token
    // alone, which split() leaves unchanged.
    pageAccessToken: row.token.split("___")[0],
  };
}

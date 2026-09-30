import { and, desc, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import {
  clips,
  createDb,
  posts,
  socialConnections,
  sourceVideos,
} from "@scenestealer/db";
import { requireTenant } from "../auth.js";
import { getPagePosts } from "../facebook-graph.js";
import {
  deleteIntegration,
  getConnectUrl,
  getIntegrations,
  getIntegrationSettings,
} from "../postiz.js";
import { getPostizFacebookToken } from "../postiz-db.js";
import type { Env } from "../index.js";
import type { Variables } from "../auth.js";

export const social = new Hono<{ Bindings: Env; Variables: Variables }>();

social.use("*", requireTenant);

const PLATFORMS = ["youtube", "instagram", "facebook"] as const;
type Platform = (typeof PLATFORMS)[number];

function isPlatform(value: string): value is Platform {
  return (PLATFORMS as readonly string[]).includes(value);
}

// Postiz's connect endpoint accepts no customer/state param and has no
// callback we can intercept (the tenant's browser lands back on Postiz's
// own domain, not ours) — confirmed against the real API, not assumed.
// So attribution is a before/after diff: snapshot integration IDs here,
// hand them back to the client, and let /finalize below diff against a
// fresh list once the tenant's done connecting.
social.post("/:platform/connect", async (c) => {
  const platform = c.req.param("platform");
  if (!isPlatform(platform)) {
    return c.json({ error: "Unknown platform" }, 400);
  }

  const [url, integrations] = await Promise.all([
    getConnectUrl(c.env, platform),
    getIntegrations(c.env),
  ]);

  return c.json({ url, beforeIds: integrations.map((i) => i.id) });
});

social.post("/:platform/finalize", async (c) => {
  const tenantId = c.get("tenantId");
  const platform = c.req.param("platform");
  if (!isPlatform(platform)) {
    return c.json({ error: "Unknown platform" }, 400);
  }
  const { beforeIds } = await c.req.json<{ beforeIds: string[] }>();

  const db = createDb(c.env.DATABASE_URL);
  const [integrations, existing] = await Promise.all([
    getIntegrations(c.env),
    db
      .select({ postizIntegrationId: socialConnections.postizIntegrationId })
      .from(socialConnections)
      .where(eq(socialConnections.tenantId, tenantId)),
  ]);

  const knownIds = new Set([
    ...beforeIds,
    ...existing.map((row) => row.postizIntegrationId),
  ]);
  const newOnes = integrations.filter(
    (i) => i.identifier === platform && !knownIds.has(i.id),
  );

  const inserted =
    newOnes.length > 0
      ? await db
          .insert(socialConnections)
          .values(
            newOnes.map((integration) => ({
              tenantId,
              platform,
              postizIntegrationId: integration.id,
            })),
          )
          .returning()
      : [];

  return c.json({ connections: inserted });
});

// Enriches each row with its real account/page name (and picture) from
// Postiz, read live rather than stored — a tenant can have more than one
// connection per platform (e.g. two Facebook Pages), and without this
// they're indistinguishable in the UI (every row just says "facebook").
social.get("/connections", async (c) => {
  const tenantId = c.get("tenantId");
  const db = createDb(c.env.DATABASE_URL);

  const [connections, integrations] = await Promise.all([
    db
      .select()
      .from(socialConnections)
      .where(eq(socialConnections.tenantId, tenantId)),
    getIntegrations(c.env).catch(() => []),
  ]);
  const byId = new Map(integrations.map((i) => [i.id, i]));

  return c.json({
    connections: connections.map((connection) => ({
      ...connection,
      name: byId.get(connection.postizIntegrationId)?.name ?? null,
      picture: byId.get(connection.postizIntegrationId)?.picture ?? null,
    })),
  });
});

// Our own convenience field only — see socialConnections.defaultPostingTime's
// schema comment for why this can't be Postiz's own postingTimes setting.
social.patch("/connections/:id", async (c) => {
  const tenantId = c.get("tenantId");
  const connectionId = c.req.param("id");
  const body = await c.req.json<{ defaultPostingTime?: string | null }>();

  const db = createDb(c.env.DATABASE_URL);
  const [existing] = await db
    .select({ id: socialConnections.id })
    .from(socialConnections)
    .where(
      and(
        eq(socialConnections.id, connectionId),
        eq(socialConnections.tenantId, tenantId),
      ),
    )
    .limit(1);
  if (!existing) {
    return c.json({ error: "Connection not found" }, 404);
  }

  if (body.defaultPostingTime === undefined) {
    return c.json({ error: "defaultPostingTime is required" }, 400);
  }

  const [updated] = await db
    .update(socialConnections)
    .set({ defaultPostingTime: body.defaultPostingTime?.trim() || null })
    .where(eq(socialConnections.id, connectionId))
    .returning();

  return c.json({ connection: updated });
});

social.get("/connections/:id/settings", async (c) => {
  const tenantId = c.get("tenantId");
  const db = createDb(c.env.DATABASE_URL);

  const [connection] = await db
    .select()
    .from(socialConnections)
    .where(
      and(
        eq(socialConnections.id, c.req.param("id")),
        eq(socialConnections.tenantId, tenantId),
      ),
    )
    .limit(1);
  if (!connection) {
    return c.json({ error: "Connection not found" }, 404);
  }

  const settings = await getIntegrationSettings(
    c.env,
    connection.postizIntegrationId,
  );
  return c.json(settings);
});

// Facebook reads real content back from the connected Page itself — see
// postiz-db.ts and facebook-graph.ts for why: it's what genuinely
// exercises pages_read_engagement for Meta App Review, not just claims
// it. That proof only needs to exist once, on Facebook; Instagram/
// YouTube have no equivalent review requirement, so for them this
// serves from our own already-stored publish history instead of a
// second live Graph API integration — cheaper to build, and the data
// (our own confirmed-published posts, see posts.ts's releaseUrl) is
// already sitting right there.
social.get("/connections/:id/recent-posts", async (c) => {
  const tenantId = c.get("tenantId");
  const db = createDb(c.env.DATABASE_URL);

  const [connection] = await db
    .select()
    .from(socialConnections)
    .where(
      and(
        eq(socialConnections.id, c.req.param("id")),
        eq(socialConnections.tenantId, tenantId),
      ),
    )
    .limit(1);
  if (!connection) {
    return c.json({ error: "Connection not found" }, 404);
  }

  if (connection.platform !== "facebook") {
    const rows = await db
      .select({
        id: posts.id,
        videoTitle: sourceVideos.title,
        publishedAt: posts.publishedAt,
        releaseUrl: posts.releaseUrl,
      })
      .from(posts)
      .innerJoin(clips, eq(posts.clipId, clips.id))
      .leftJoin(sourceVideos, eq(clips.sourceVideoId, sourceVideos.id))
      .where(
        and(
          eq(posts.socialConnectionId, connection.id),
          eq(posts.status, "published"),
        ),
      )
      .orderBy(desc(posts.publishedAt))
      .limit(5);

    return c.json({
      posts: rows.map((row) => ({
        id: row.id,
        message: row.videoTitle ?? undefined,
        createdTime: (row.publishedAt ?? new Date()).toISOString(),
        permalinkUrl: row.releaseUrl ?? undefined,
      })),
    });
  }

  const token = await getPostizFacebookToken(
    c.env,
    connection.postizIntegrationId,
  );
  if (!token) {
    return c.json({ error: "No Facebook Page token available" }, 503);
  }

  try {
    const recentPosts = await getPagePosts(token.pageId, token.accessToken);
    return c.json({ posts: recentPosts });
  } catch (err) {
    return c.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      502,
    );
  }
});

// The published Data Deletion Instructions page promises disconnecting
// an account revokes access, not just stops SceneStealer from using
// it — so this actually calls Postiz's own delete, not only our row.
social.delete("/connections/:id", async (c) => {
  const tenantId = c.get("tenantId");
  const db = createDb(c.env.DATABASE_URL);

  const [connection] = await db
    .select()
    .from(socialConnections)
    .where(
      and(
        eq(socialConnections.id, c.req.param("id")),
        eq(socialConnections.tenantId, tenantId),
      ),
    )
    .limit(1);
  if (!connection) {
    return c.json({ error: "Connection not found" }, 404);
  }

  await deleteIntegration(c.env, connection.postizIntegrationId);

  // posts.socialConnectionId was NOT NULL until this was fixed for real
  // (2026-09-10): any connection with post history at all — a queued,
  // scheduled, failed, or even successfully published post — could never
  // be disconnected, since deleting it would violate that foreign key.
  // Confirmed live: the route's own deleteIntegration call above
  // succeeded fine, but the row delete below then threw a raw
  // NeonDbError the tenant only ever saw as a generic
  // "Failed to disconnect account". A queued/scheduled/failed/cancelled
  // post has no value once its connection is gone, so those are deleted
  // outright; a genuinely "published" post is real history worth
  // keeping, so its reference is nulled instead of destroying the row.
  await db.transaction(async (tx) => {
    await tx
      .delete(posts)
      .where(
        and(
          eq(posts.socialConnectionId, connection.id),
          inArray(posts.status, ["queued", "scheduled", "failed", "cancelled"]),
        ),
      );
    await tx
      .update(posts)
      .set({ socialConnectionId: null })
      .where(eq(posts.socialConnectionId, connection.id));
    await tx
      .delete(socialConnections)
      .where(eq(socialConnections.id, connection.id));
  });

  return c.json({ deleted: true });
});

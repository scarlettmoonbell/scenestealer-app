import { and, asc, eq } from "drizzle-orm";
import { Hono } from "hono";
import {
  clips,
  createDb,
  posts,
  socialConnections,
  sourceVideos,
} from "@scenestealer/db";
import { requireTenant } from "../auth.js";
import { cancelPost } from "../postiz.js";
import type { Env } from "../index.js";
import type { Variables } from "../auth.js";

export const postsRoute = new Hono<{ Bindings: Env; Variables: Variables }>();

postsRoute.use("*", requireTenant);

// Scheduled posts live in our own table already scoped by tenant (via
// socialConnections), so listing them never has to touch Postiz's own
// /posts — which isn't tenant-scoped at all and would return every
// tenant's posts sharing this Postiz account.
postsRoute.get("/scheduled", async (c) => {
  const tenantId = c.get("tenantId");
  const db = createDb(c.env.DATABASE_URL);

  const rows = await db
    .select({
      id: posts.id,
      clipId: posts.clipId,
      scheduledAt: posts.scheduledAt,
      platform: socialConnections.platform,
      videoTitle: sourceVideos.title,
    })
    .from(posts)
    .innerJoin(
      socialConnections,
      eq(posts.socialConnectionId, socialConnections.id),
    )
    .innerJoin(clips, eq(posts.clipId, clips.id))
    .innerJoin(sourceVideos, eq(clips.sourceVideoId, sourceVideos.id))
    .where(
      and(
        eq(socialConnections.tenantId, tenantId),
        eq(posts.status, "scheduled"),
      ),
    )
    .orderBy(asc(posts.scheduledAt));

  return c.json({ posts: rows });
});

postsRoute.delete("/:id", async (c) => {
  const tenantId = c.get("tenantId");
  const postId = c.req.param("id");
  const db = createDb(c.env.DATABASE_URL);

  const [row] = await db
    .select({
      id: posts.id,
      status: posts.status,
      externalPostId: posts.externalPostId,
    })
    .from(posts)
    .innerJoin(
      socialConnections,
      eq(posts.socialConnectionId, socialConnections.id),
    )
    .where(and(eq(posts.id, postId), eq(socialConnections.tenantId, tenantId)))
    .limit(1);
  if (!row) {
    return c.json({ error: "Post not found" }, 404);
  }
  if (row.status !== "scheduled") {
    return c.json({ error: "Only scheduled posts can be cancelled" }, 400);
  }

  if (row.externalPostId) {
    await cancelPost(c.env, row.externalPostId);
  }
  const [updated] = await db
    .update(posts)
    .set({ status: "cancelled" })
    .where(eq(posts.id, postId))
    .returning();

  return c.json({ post: updated });
});

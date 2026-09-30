import { and, asc, desc, eq, gte, isNotNull, lte, or } from "drizzle-orm";
import { Hono } from "hono";
import {
  clips,
  createDb,
  posts,
  socialConnections,
  sourceVideos,
} from "@scenestealer/db";
import { requireTenant } from "../auth.js";
import { cancelPost, getPostStatus } from "../postiz.js";
import { notifyPublishFailure } from "../notify.js";
import { getPostizPublishedPost } from "../postiz-db.js";
import {
  CommentNotOnPostError,
  getEngagement,
  replyToComment,
} from "../meta-engagement.js";
import type { Env } from "../index.js";
import type { Variables } from "../auth.js";

export const postsRoute = new Hono<{ Bindings: Env; Variables: Variables }>();

postsRoute.use("*", requireTenant);

// Checks any post Postiz might have a real, resolved outcome for by now
// — a "scheduled" post whose time has already passed, or a "queued"
// one (an immediate "publish now") — against its real per-post state,
// and writes the real outcome. Nothing here assumes success just
// because time passed. Best-effort: a Postiz hiccup leaves a row
// untouched rather than failing the caller, since this only ever runs
// as a side effect of a read.
//
// "queued" specifically was a real gap, not just a nice-to-have
// (2026-09-12): Scheduler's own poll after a "publish now" request was
// the *only* thing that ever reconciled a "queued" post — nothing else
// in the app touched it, and that component only polls for a bounded
// window (extended, but still bounded) before giving up. A post that
// took longer than that to actually land was stuck at "queued" forever,
// invisible everywhere (not shown by GET /scheduled below either, which
// only returns "scheduled"/recently-"failed"), even though it had
// genuinely published. This closes that permanently, independent of
// whether any particular tab is still open polling it.
async function reconcilePendingPosts(
  env: Env,
  db: ReturnType<typeof createDb>,
  tenantId: string,
) {
  const pending = await db
    .select({
      id: posts.id,
      externalPostId: posts.externalPostId,
      platform: socialConnections.platform,
    })
    .from(posts)
    .innerJoin(
      socialConnections,
      eq(posts.socialConnectionId, socialConnections.id),
    )
    .where(
      and(
        eq(socialConnections.tenantId, tenantId),
        isNotNull(posts.externalPostId),
        or(
          and(
            eq(posts.status, "scheduled"),
            lte(posts.scheduledAt, new Date()),
          ),
          eq(posts.status, "queued"),
        ),
      ),
    );

  for (const row of pending) {
    if (!row.externalPostId) continue;
    const remote = await getPostStatus(env, row.externalPostId);
    if (remote?.state === "PUBLISHED") {
      await db
        .update(posts)
        .set({
          status: "published",
          publishedAt: new Date(),
          error: null,
          releaseUrl: remote.releaseURL,
        })
        .where(eq(posts.id, row.id));
    } else if (remote?.state === "ERROR") {
      const error = remote.error ?? "Publish failed";
      await db
        .update(posts)
        .set({ status: "failed", error })
        .where(eq(posts.id, row.id));
      await notifyPublishFailure(env, tenantId, {
        platform: row.platform,
        error,
      });
    }
  }
}

// Scheduled posts live in our own table already scoped by tenant (via
// socialConnections), so listing them never has to touch Postiz's own
// /posts — which isn't tenant-scoped at all and would return every
// tenant's posts sharing this Postiz account.
postsRoute.get("/scheduled", async (c) => {
  const tenantId = c.get("tenantId");
  const db = createDb(c.env.DATABASE_URL);

  await reconcilePendingPosts(c.env, db, tenantId);

  const rows = await db
    .select({
      id: posts.id,
      clipId: posts.clipId,
      status: posts.status,
      scheduledAt: posts.scheduledAt,
      error: posts.error,
      platform: socialConnections.platform,
      videoTitle: sourceVideos.title,
    })
    .from(posts)
    .innerJoin(
      socialConnections,
      eq(posts.socialConnectionId, socialConnections.id),
    )
    .innerJoin(clips, eq(posts.clipId, clips.id))
    // Left, not inner — a post from a clip whose source video was
    // since deleted (to save storage; the clip itself is deliberately
    // kept, see schema.ts) would otherwise silently vanish from this
    // list instead of just showing no video title.
    .leftJoin(sourceVideos, eq(clips.sourceVideoId, sourceVideos.id))
    .where(
      and(
        eq(socialConnections.tenantId, tenantId),
        // "scheduled" still upcoming, plus recently-failed so a post
        // that failed after its scheduled time (or a same-day "publish
        // now" failure) doesn't just silently vanish with nothing in
        // the UI explaining why — the exact gap that made the original
        // stuck-post bug invisible.
        or(
          eq(posts.status, "scheduled"),
          and(
            eq(posts.status, "failed"),
            gte(
              posts.createdAt,
              new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
            ),
          ),
        ),
      ),
    )
    .orderBy(asc(posts.scheduledAt));

  return c.json({ posts: rows });
});

// Lets a tenant manage a post directly on the platform it was published
// to — releaseUrl is captured once, when reconcilePendingPosts/GET
// /:id/status above first confirms "published", not fetched live here.
// Most-recent-first, capped at 50: this is a browse/reference list, not
// something that needs full pagination yet.
postsRoute.get("/published", async (c) => {
  const tenantId = c.get("tenantId");
  const db = createDb(c.env.DATABASE_URL);

  const rows = await db
    .select({
      id: posts.id,
      platform: socialConnections.platform,
      videoTitle: sourceVideos.title,
      publishedAt: posts.publishedAt,
      releaseUrl: posts.releaseUrl,
    })
    .from(posts)
    .innerJoin(
      socialConnections,
      eq(posts.socialConnectionId, socialConnections.id),
    )
    .innerJoin(clips, eq(posts.clipId, clips.id))
    .leftJoin(sourceVideos, eq(clips.sourceVideoId, sourceVideos.id))
    .where(
      and(
        eq(socialConnections.tenantId, tenantId),
        eq(posts.status, "published"),
      ),
    )
    .orderBy(desc(posts.publishedAt))
    .limit(50);

  return c.json({ posts: rows });
});

// Polled by the Scheduler right after a "publish now" request — that
// request only means Postiz *accepted* the post, not that it actually
// reached the platform (see clips.ts's /:id/publish). Reconciles this
// one post against Postiz's real state before returning, so the caller
// never has to wait for the next full-list reconciliation above.
// Resolves a tenant's own published Facebook/Instagram post to the
// platform id + Page token needed for engagement calls. Returns a
// ready-to-send error response instead when it can't.
async function resolveEngagementTarget(
  env: Env,
  tenantId: string,
  postId: string,
) {
  const db = createDb(env.DATABASE_URL);
  const [row] = await db
    .select({
      status: posts.status,
      externalPostId: posts.externalPostId,
      platform: socialConnections.platform,
      postizIntegrationId: socialConnections.postizIntegrationId,
    })
    .from(posts)
    .innerJoin(
      socialConnections,
      eq(posts.socialConnectionId, socialConnections.id),
    )
    .where(and(eq(posts.id, postId), eq(socialConnections.tenantId, tenantId)))
    .limit(1);
  if (!row) return { error: "Post not found", status: 404 as const };
  if (row.status !== "published" || !row.externalPostId) {
    return { error: "Post isn't published yet", status: 409 as const };
  }
  if (row.platform !== "facebook" && row.platform !== "instagram") {
    return {
      error:
        "Comments and insights are available for Facebook and Instagram posts",
      status: 400 as const,
    };
  }
  const target = await getPostizPublishedPost(
    env,
    row.externalPostId,
    row.postizIntegrationId,
  );
  if (!target) {
    return {
      error: "Couldn't find this post on the platform",
      status: 404 as const,
    };
  }
  return { target };
}

// Comments and basic insights for one published post, read live from
// Meta (see meta-engagement.ts for which permission each part uses).
postsRoute.get("/:id/engagement", async (c) => {
  const resolved = await resolveEngagementTarget(
    c.env,
    c.get("tenantId"),
    c.req.param("id"),
  );
  if ("error" in resolved) {
    return c.json({ error: resolved.error }, resolved.status);
  }
  const { provider, releaseId, pageAccessToken } = resolved.target;
  try {
    const engagement = await getEngagement(
      provider,
      releaseId,
      pageAccessToken,
    );
    return c.json({ platform: provider, ...engagement });
  } catch (err) {
    console.error("GET /posts/:id/engagement failed", err);
    return c.json({ error: "Couldn't load comments from the platform" }, 502);
  }
});

// Replies, as the Page / Instagram account, to one top-level comment on
// a published post.
postsRoute.post("/:id/comments/:commentId/replies", async (c) => {
  const commentId = c.req.param("commentId");
  if (!/^[0-9_]+$/.test(commentId)) {
    return c.json({ error: "Invalid comment id" }, 400);
  }
  const body: { message?: unknown } = await c.req
    .json<{ message?: unknown }>()
    .catch(() => ({}));
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (message.length === 0 || message.length > 2000) {
    return c.json({ error: "Reply must be 1–2000 characters" }, 400);
  }

  const resolved = await resolveEngagementTarget(
    c.env,
    c.get("tenantId"),
    c.req.param("id"),
  );
  if ("error" in resolved) {
    return c.json({ error: resolved.error }, resolved.status);
  }
  const { provider, releaseId, pageAccessToken } = resolved.target;
  try {
    const reply = await replyToComment(
      provider,
      releaseId,
      commentId,
      message,
      pageAccessToken,
    );
    return c.json({ id: reply.id });
  } catch (err) {
    if (err instanceof CommentNotOnPostError) {
      return c.json({ error: err.message }, 404);
    }
    console.error("POST /posts/:id/comments/:commentId/replies failed", err);
    return c.json({ error: "Couldn't post the reply to the platform" }, 502);
  }
});

postsRoute.get("/:id/status", async (c) => {
  const tenantId = c.get("tenantId");
  const postId = c.req.param("id");
  const db = createDb(c.env.DATABASE_URL);

  const [row] = await db
    .select({
      id: posts.id,
      status: posts.status,
      error: posts.error,
      externalPostId: posts.externalPostId,
      platform: socialConnections.platform,
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

  if (row.status === "queued" && row.externalPostId) {
    const remote = await getPostStatus(c.env, row.externalPostId);
    if (remote?.state === "PUBLISHED") {
      const [updated] = await db
        .update(posts)
        .set({
          status: "published",
          publishedAt: new Date(),
          error: null,
          releaseUrl: remote.releaseURL,
        })
        .where(eq(posts.id, postId))
        .returning();
      return c.json({ post: updated });
    }
    if (remote?.state === "ERROR") {
      const error = remote.error ?? "Publish failed";
      const [updated] = await db
        .update(posts)
        .set({ status: "failed", error })
        .where(eq(posts.id, postId))
        .returning();
      await notifyPublishFailure(c.env, tenantId, {
        platform: row.platform,
        error,
      });
      return c.json({ post: updated });
    }
  }

  return c.json({ post: row });
});

// "scheduled" -> cancel (Postiz has a real, live post to call off, so
// that happens first; the row itself is kept, marked "cancelled", same
// as always). "failed" -> dismiss: a failed post never has anything
// live on Postiz's side worth cancelling (either the create call itself
// never succeeded, or Postiz's own state is already a terminal ERROR),
// so this just clears the row outright — requested for real
// (2026-09-12) after a tenant found "Already scheduled" cluttered with
// weeks-old, already-understood failures with no way to clear them
// short of waiting out GET /scheduled's own 7-day window.
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

  if (row.status === "failed") {
    await db.delete(posts).where(eq(posts.id, postId));
    return c.json({ ok: true });
  }

  if (row.status !== "scheduled") {
    return c.json(
      { error: "Only scheduled or failed posts can be cancelled/dismissed" },
      400,
    );
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

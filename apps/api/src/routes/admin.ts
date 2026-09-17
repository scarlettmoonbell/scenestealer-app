import { Hono } from "hono";
import { eq, desc, sql, isNotNull } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  createDb,
  tenants,
  sourceVideos,
  clips,
  posts,
  socialConnections,
} from "@scenestealer/db";
import { requireAdmin, type AdminVariables } from "../auth.js";
import type { Env } from "../index.js";

// Phase 1 scope only, per the admin-interface plan: read-only reporting,
// no destructive support actions yet (those get their own admin_actions
// audit table when they're actually built). Every route here is gated by
// requireAdmin at mount time below, not per-route — this whole sub-app
// has no legitimate unauthenticated route, unlike admin-auth.ts.
export const adminRoute = new Hono<{
  Bindings: Env;
  Variables: AdminVariables;
}>();
adminRoute.use("*", requireAdmin);

// Tenant list with summary stats — the cross-tenant view requireTenant
// structurally can't provide, since it always scopes to one org.
adminRoute.get("/tenants", async (c) => {
  const db = createDb(c.env.DATABASE_URL);
  // Real bug hit in production (2026-09-16), confirmed by reproducing
  // this exact query against prod with the same drizzle-orm/neon-
  // serverless driver: interpolating a Column object into a raw `sql`
  // template (${sourceVideos.tenantId}, ${tenants.id}, etc.) never
  // qualifies it with its table — drizzle renders just the bare column
  // name. Inside these correlated subqueries that's ambiguous the
  // instant a subquery's own table has a same-named column (every one
  // of them has an "id"), so Postgres rejected the query outright
  // ("column reference "id" is ambiguous") — a 500 on every load, not
  // an edge case. Fixed by manually qualifying every reference as
  // ${table}."column_name" (interpolating the table renders its quoted
  // name/alias correctly; the column name is appended as a literal).
  // `t` aliases tenants so its own qualified references
  // (${t}."id") don't collide with the literal "tenants" text used by
  // the FROM clause.
  const t = alias(tenants, "t");
  const rows = await db
    .select({
      id: t.id,
      name: t.name,
      clerkOrgId: t.clerkOrgId,
      createdAt: t.createdAt,
      sourceVideoCount: sql<number>`(select count(*) from ${sourceVideos} where ${sourceVideos}."tenant_id" = ${t}."id")`,
      clipCount: sql<number>`(select count(*) from ${clips} where ${clips}."tenant_id" = ${t}."id")`,
      connectionCount: sql<number>`(select count(*) from ${socialConnections} where ${socialConnections}."tenant_id" = ${t}."id")`,
      publishedPostCount: sql<number>`(select count(*) from ${posts} join ${clips} on ${posts}."clip_id" = ${clips}."id" where ${clips}."tenant_id" = ${t}."id" and ${posts}."status" = 'published')`,
    })
    .from(t)
    .orderBy(desc(t.createdAt));
  return c.json({ tenants: rows });
});

// One tenant's detail — connections, recent videos/clips, so a support
// action later (disconnect a stuck integration, etc.) has context to
// act on without dropping into a direct DB query by hand.
adminRoute.get("/tenants/:id", async (c) => {
  const tenantId = c.req.param("id");
  const db = createDb(c.env.DATABASE_URL);

  const [tenant] = await db
    .select()
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  if (!tenant) {
    return c.json({ error: "Tenant not found" }, 404);
  }

  const connections = await db
    .select()
    .from(socialConnections)
    .where(eq(socialConnections.tenantId, tenantId));

  const recentVideos = await db
    .select()
    .from(sourceVideos)
    .where(eq(sourceVideos.tenantId, tenantId))
    .orderBy(desc(sourceVideos.createdAt))
    .limit(20);

  return c.json({ tenant, connections, recentVideos });
});

// Cross-tenant failure feed — the exact shape of query that got run by
// hand this session for the stale-failures cleanup, now a real endpoint
// instead of a one-off. Three failure kinds unified into one list.
adminRoute.get("/failures", async (c) => {
  const db = createDb(c.env.DATABASE_URL);

  const failedPosts = await db
    .select({
      kind: sql<string>`'post'`,
      id: posts.id,
      tenantId: clips.tenantId,
      error: posts.error,
      occurredAt: posts.createdAt,
    })
    .from(posts)
    .innerJoin(clips, eq(posts.clipId, clips.id))
    .where(eq(posts.status, "failed"))
    .orderBy(desc(posts.createdAt))
    .limit(50);

  const failedAnalyses = await db
    .select({
      kind: sql<string>`'analysis'`,
      id: sourceVideos.id,
      tenantId: sourceVideos.tenantId,
      error: sourceVideos.analysisError,
      occurredAt: sourceVideos.createdAt,
    })
    .from(sourceVideos)
    .where(eq(sourceVideos.status, "failed"))
    .orderBy(desc(sourceVideos.createdAt))
    .limit(50);

  const failedRenders = await db
    .select({
      kind: sql<string>`'render'`,
      id: clips.id,
      tenantId: clips.tenantId,
      error: clips.renderError,
      occurredAt: clips.createdAt,
    })
    .from(clips)
    .where(isNotNull(clips.renderError))
    .orderBy(desc(clips.createdAt))
    .limit(50);

  const combined = [...failedPosts, ...failedAnalyses, ...failedRenders].sort(
    (a, b) => (b.occurredAt?.getTime() ?? 0) - (a.occurredAt?.getTime() ?? 0),
  );

  return c.json({ failures: combined });
});

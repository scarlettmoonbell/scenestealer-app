import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { createDb, tenants } from "@scenestealer/db";
import { requireTenant } from "../auth.js";
import type { Env } from "../index.js";
import type { Variables } from "../auth.js";

// Settings page — currently just publish-failure notification
// preferences. Deliberately tenant-scoped (one address per org, not
// per Clerk user) to match how everything else in this app (templates,
// social connections) is already tenant-scoped, and because there's no
// per-post "who published this" attribution to target a specific user
// with (unlike analyze's triggeredByClerkUserId).
export const tenantRoute = new Hono<{ Bindings: Env; Variables: Variables }>();

tenantRoute.use("*", requireTenant);

tenantRoute.get("/settings", async (c) => {
  const tenantId = c.get("tenantId");
  const db = createDb(c.env.DATABASE_URL);

  const [tenant] = await db
    .select({
      notificationEmail: tenants.notificationEmail,
      notifyOnPublishFailure: tenants.notifyOnPublishFailure,
    })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  if (!tenant) {
    return c.json({ error: "Tenant not found" }, 404);
  }

  return c.json({ settings: tenant });
});

tenantRoute.patch("/settings", async (c) => {
  const tenantId = c.get("tenantId");
  const body = await c.req.json<{
    notificationEmail?: string | null;
    notifyOnPublishFailure?: boolean;
  }>();

  const db = createDb(c.env.DATABASE_URL);
  const [updated] = await db
    .update(tenants)
    .set({
      ...(body.notificationEmail !== undefined
        ? { notificationEmail: body.notificationEmail?.trim() || null }
        : {}),
      ...(body.notifyOnPublishFailure !== undefined
        ? { notifyOnPublishFailure: body.notifyOnPublishFailure }
        : {}),
    })
    .where(eq(tenants.id, tenantId))
    .returning({
      notificationEmail: tenants.notificationEmail,
      notifyOnPublishFailure: tenants.notifyOnPublishFailure,
    });
  if (!updated) {
    return c.json({ error: "Tenant not found" }, 404);
  }

  return c.json({ settings: updated });
});

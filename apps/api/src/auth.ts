import { eq } from "drizzle-orm";
import { getAuth } from "@clerk/hono";
import { createDb, tenants } from "@scenestealer/db";
import type { Context, MiddlewareHandler } from "hono";
import type { Env } from "./index.js";

export type Variables = {
  tenantId: string;
};

/**
 * Verifies the Clerk session (via clerkMiddleware(), applied globally in
 * index.ts) and resolves it to this app's internal tenant UUID, so route
 * handlers never trust a client-supplied tenantId. Requires an active
 * Clerk Organization on the session — Clerk Organizations are how this
 * product models tenants, see packages/db's schema.ts tenants.clerkOrgId
 * comment.
 *
 * Known gap: nothing yet provisions a `tenants` row when a Clerk
 * Organization is created, so a valid session for a brand-new org still
 * 403s here until that row exists. Needs an `organization.created` Clerk
 * webhook — tracked in ROADMAP.md, not solved by this middleware.
 */
export const requireTenant: MiddlewareHandler<{
  Bindings: Env;
  Variables: Variables;
}> = async (c: Context<{ Bindings: Env; Variables: Variables }>, next) => {
  const auth = getAuth(c);
  if (!auth.userId || !auth.orgId) {
    return c.json(
      { error: "Sign-in with an active organization is required" },
      401,
    );
  }

  const db = createDb(c.env.DATABASE_URL);
  const [tenant] = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.clerkOrgId, auth.orgId))
    .limit(1);

  if (!tenant) {
    return c.json({ error: "No tenant provisioned for this organization" }, 403);
  }

  c.set("tenantId", tenant.id);
  await next();
};

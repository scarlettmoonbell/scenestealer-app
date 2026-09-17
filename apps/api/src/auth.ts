import { eq, isNull, and, gt } from "drizzle-orm";
import { getAuth } from "@clerk/hono";
import { getCookie } from "hono/cookie";
import { createDb, tenants, adminSessions } from "@scenestealer/db";
import type { Context, MiddlewareHandler } from "hono";
import type { Env } from "./index.js";
import { sha256Hex } from "./admin-crypto.js";

export type Variables = {
  tenantId: string;
  userId: string;
};

export type AdminVariables = {
  adminSessionId: string;
};

export const ADMIN_SESSION_COOKIE = "admin_session";

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
    return c.json(
      { error: "No tenant provisioned for this organization" },
      403,
    );
  }

  c.set("tenantId", tenant.id);
  // auth.userId was already being read above (just for the presence
  // check) but never exposed to route handlers — needed so
  // POST /:id/analyze can record who triggered a run, to know who to
  // email once it finishes (see routes/videos.ts).
  c.set("userId", auth.userId);
  await next();
};

/**
 * Gates the operator-only admin surface (routes/admin.ts,
 * routes/admin-auth.ts' own register/recovery-regenerate endpoints).
 * Deliberately shares no code path with requireTenant/Clerk above — the
 * whole point of standalone WebAuthn here is an auth boundary a Clerk-
 * side bug or compromise can't cross. Reads an opaque session token from
 * a cookie (never a header — see routes/admin-auth.ts for why HttpOnly/
 * Secure/SameSite=Strict matters here), hashes it, and checks
 * admin_sessions for a live, unexpired, unrevoked row.
 */
export const requireAdmin: MiddlewareHandler<{
  Bindings: Env;
  Variables: AdminVariables;
}> = async (c: Context<{ Bindings: Env; Variables: AdminVariables }>, next) => {
  const token = getCookie(c, ADMIN_SESSION_COOKIE);
  if (!token) {
    return c.json({ error: "Admin sign-in required" }, 401);
  }

  const tokenHash = await sha256Hex(token);
  const db = createDb(c.env.DATABASE_URL);
  const [session] = await db
    .select({ id: adminSessions.id })
    .from(adminSessions)
    .where(
      and(
        eq(adminSessions.tokenHash, tokenHash),
        isNull(adminSessions.revokedAt),
        gt(adminSessions.expiresAt, new Date()),
      ),
    )
    .limit(1);

  if (!session) {
    return c.json({ error: "Admin session expired or revoked" }, 401);
  }

  c.set("adminSessionId", session.id);
  await next();
};

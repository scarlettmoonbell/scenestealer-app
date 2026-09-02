import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { createDb, socialConnections } from "@scenestealer/db";
import { requireTenant } from "../auth.js";
import {
  deleteIntegration,
  getConnectUrl,
  getIntegrations,
  getIntegrationSettings,
} from "../postiz.js";
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

social.get("/connections", async (c) => {
  const tenantId = c.get("tenantId");
  const db = createDb(c.env.DATABASE_URL);

  const connections = await db
    .select()
    .from(socialConnections)
    .where(eq(socialConnections.tenantId, tenantId));

  return c.json({ connections });
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
  await db
    .delete(socialConnections)
    .where(eq(socialConnections.id, connection.id));

  return c.json({ deleted: true });
});

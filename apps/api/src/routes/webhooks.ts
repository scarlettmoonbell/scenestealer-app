import { Hono } from "hono";
import { verifyWebhook } from "@clerk/hono/webhooks";
import { createDb, tenants } from "@scenestealer/db";
import type { Env } from "../index.js";

export const webhooks = new Hono<{ Bindings: Env }>();

/**
 * Provisions a `tenants` row the moment a Clerk Organization is created,
 * so a brand-new org's session doesn't 403 in requireTenant (see
 * ../auth.ts) before anyone's had a chance to set anything up manually.
 * `onConflictDoNothing` makes this safe against Svix's at-least-once
 * delivery retrying the same event.
 */
webhooks.post("/clerk", async (c) => {
  let event;
  try {
    event = await verifyWebhook(c, {
      signingSecret: c.env.CLERK_WEBHOOK_SIGNING_SECRET,
    });
  } catch {
    return c.json({ error: "Invalid webhook signature" }, 400);
  }

  if (event.type === "organization.created") {
    const db = createDb(c.env.DATABASE_URL);
    await db
      .insert(tenants)
      .values({ clerkOrgId: event.data.id, name: event.data.name })
      .onConflictDoNothing({ target: tenants.clerkOrgId });
  }

  return c.json({ received: true });
});

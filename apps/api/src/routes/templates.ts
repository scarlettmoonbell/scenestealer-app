import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { createDb, templates } from "@scenestealer/db";
import { requireTenant } from "../auth.js";
import type { Env } from "../index.js";
import type { Variables } from "../auth.js";

export const templatesRoute = new Hono<{
  Bindings: Env;
  Variables: Variables;
}>();

templatesRoute.use("*", requireTenant);

templatesRoute.get("/", async (c) => {
  const tenantId = c.get("tenantId");
  const db = createDb(c.env.DATABASE_URL);

  const rows = await db
    .select()
    .from(templates)
    .where(eq(templates.tenantId, tenantId));

  return c.json({ templates: rows });
});

templatesRoute.post("/", async (c) => {
  const tenantId = c.get("tenantId");
  const body = await c.req.json<{
    name: string;
    captionTemplate: string;
    platform?: (typeof templates.$inferSelect)["platform"];
  }>();

  if (!body.name || !body.captionTemplate) {
    return c.json({ error: "name and captionTemplate are required" }, 400);
  }

  const db = createDb(c.env.DATABASE_URL);
  const [created] = await db
    .insert(templates)
    .values({
      tenantId,
      name: body.name,
      captionTemplate: body.captionTemplate,
      platform: body.platform ?? null,
    })
    .returning();

  return c.json({ template: created });
});

templatesRoute.patch("/:id", async (c) => {
  const tenantId = c.get("tenantId");
  const templateId = c.req.param("id");
  const body = await c.req.json<{
    name?: string;
    captionTemplate?: string;
    platform?: (typeof templates.$inferSelect)["platform"];
  }>();

  const db = createDb(c.env.DATABASE_URL);
  const [existing] = await db
    .select({ id: templates.id })
    .from(templates)
    .where(and(eq(templates.id, templateId), eq(templates.tenantId, tenantId)))
    .limit(1);
  if (!existing) {
    return c.json({ error: "Template not found" }, 404);
  }

  const [updated] = await db
    .update(templates)
    .set({
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.captionTemplate !== undefined
        ? { captionTemplate: body.captionTemplate }
        : {}),
      ...(body.platform !== undefined ? { platform: body.platform } : {}),
    })
    .where(eq(templates.id, templateId))
    .returning();

  return c.json({ template: updated });
});

templatesRoute.delete("/:id", async (c) => {
  const tenantId = c.get("tenantId");
  const templateId = c.req.param("id");
  const db = createDb(c.env.DATABASE_URL);

  const [existing] = await db
    .select({ id: templates.id })
    .from(templates)
    .where(and(eq(templates.id, templateId), eq(templates.tenantId, tenantId)))
    .limit(1);
  if (!existing) {
    return c.json({ error: "Template not found" }, 404);
  }

  await db.delete(templates).where(eq(templates.id, templateId));
  return c.json({ deleted: true });
});

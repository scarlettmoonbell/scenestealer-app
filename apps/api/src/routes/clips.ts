import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { clips, createDb } from "@scenestealer/db";
import { requireTenant } from "../auth.js";
import { getOwnedSourceVideo } from "./videos.js";
import type { Env } from "../index.js";
import type { Variables } from "../auth.js";

export const clipsRoute = new Hono<{ Bindings: Env; Variables: Variables }>();

clipsRoute.use("*", requireTenant);

clipsRoute.patch("/:id", async (c) => {
  const tenantId = c.get("tenantId");
  const clipId = c.req.param("id");
  const body = await c.req.json<{
    startSec?: number;
    endSec?: number;
    status?: (typeof clips.$inferSelect)["status"];
  }>();

  const db = createDb(c.env.DATABASE_URL);

  const [existing] = await db
    .select({ sourceVideoId: clips.sourceVideoId })
    .from(clips)
    .where(eq(clips.id, clipId))
    .limit(1);
  if (!existing) {
    return c.json({ error: "Clip not found" }, 404);
  }
  // Clips don't carry tenantId themselves — ownership is checked through
  // the parent source video, same as the videos routes.
  const owningVideo = await getOwnedSourceVideo(
    db,
    tenantId,
    existing.sourceVideoId,
  );
  if (!owningVideo) {
    return c.json({ error: "Clip not found" }, 404);
  }

  if (
    body.startSec !== undefined &&
    body.endSec !== undefined &&
    body.startSec >= body.endSec
  ) {
    return c.json({ error: "startSec must be before endSec" }, 400);
  }

  const [updated] = await db
    .update(clips)
    .set({
      ...(body.startSec !== undefined ? { startSec: body.startSec } : {}),
      ...(body.endSec !== undefined ? { endSec: body.endSec } : {}),
      ...(body.status !== undefined ? { status: body.status } : {}),
    })
    .where(eq(clips.id, clipId))
    .returning();

  return c.json({ clip: updated });
});

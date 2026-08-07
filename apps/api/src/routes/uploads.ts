import { Hono } from "hono";
import { createDb, sourceVideos } from "@scenestealer/db";
import { createPresignedUploadUrl } from "../r2.js";
import { requireTenant } from "../auth.js";
import type { Env } from "../index.js";
import type { Variables } from "../auth.js";

export const uploads = new Hono<{ Bindings: Env; Variables: Variables }>();

uploads.use("*", requireTenant);

uploads.post("/presign", async (c) => {
  const tenantId = c.get("tenantId");
  const body = await c.req.json<{
    filename: string;
    contentType?: string;
  }>();
  if (!body.filename) {
    return c.json({ error: "filename is required" }, 400);
  }

  const ext = body.filename.includes(".")
    ? body.filename.split(".").pop()
    : "bin";
  const r2Key = `${tenantId}/source-videos/${crypto.randomUUID()}.${ext}`;

  const uploadUrl = await createPresignedUploadUrl(
    {
      accountId: c.env.R2_ACCOUNT_ID,
      accessKeyId: c.env.R2_ACCESS_KEY_ID,
      secretAccessKey: c.env.R2_SECRET_ACCESS_KEY,
      bucket: c.env.R2_BUCKET_NAME,
    },
    r2Key,
  );

  return c.json({ uploadUrl, r2Key });
});

uploads.post("/complete", async (c) => {
  const tenantId = c.get("tenantId");
  const body = await c.req.json<{
    r2Key: string;
    title?: string;
  }>();
  if (!body.r2Key) {
    return c.json({ error: "r2Key is required" }, 400);
  }

  const db = createDb(c.env.DATABASE_URL);
  const [row] = await db
    .insert(sourceVideos)
    .values({
      tenantId,
      r2Key: body.r2Key,
      title: body.title,
    })
    .returning();

  return c.json({ sourceVideo: row }, 201);
});

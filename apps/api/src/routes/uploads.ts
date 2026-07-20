import { Hono } from "hono";
import { createDb, sourceVideos } from "@scenestealer/db";
import { createPresignedUploadUrl } from "../r2.js";
import type { Env } from "../index.js";

export const uploads = new Hono<{ Bindings: Env }>();

/**
 * SECURITY GAP, temporary: `tenantId` is trusted directly from the request
 * body because Clerk auth isn't wired into this app yet (no live Clerk
 * account exists — see scenestealer-infra's Known Gaps). This lets any
 * caller write into any tenant. Fine for proving the R2 presign/upload
 * mechanism works end-to-end; NOT fine once this is reachable from a real
 * client. Replace with a tenantId derived from the verified Clerk session
 * the moment auth is wired in — see scenestealer-app's ROADMAP.md Phase 2.
 */

uploads.post("/presign", async (c) => {
  const body = await c.req.json<{
    tenantId: string;
    filename: string;
    contentType?: string;
  }>();
  if (!body.tenantId || !body.filename) {
    return c.json({ error: "tenantId and filename are required" }, 400);
  }

  const ext = body.filename.includes(".")
    ? body.filename.split(".").pop()
    : "bin";
  const r2Key = `${body.tenantId}/source-videos/${crypto.randomUUID()}.${ext}`;

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
  const body = await c.req.json<{
    tenantId: string;
    r2Key: string;
    title?: string;
  }>();
  if (!body.tenantId || !body.r2Key) {
    return c.json({ error: "tenantId and r2Key are required" }, 400);
  }

  const db = createDb(c.env.DATABASE_URL);
  try {
    const [row] = await db
      .insert(sourceVideos)
      .values({
        tenantId: body.tenantId,
        r2Key: body.r2Key,
        title: body.title,
      })
      .returning();

    return c.json({ sourceVideo: row }, 201);
  } catch (err) {
    // Postgres foreign-key violation (23503) — most likely an unknown
    // tenantId, which is a client error (400), not a server failure (500).
    // Verified against a real violation during testing, not guessed.
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      err.code === "23503"
    ) {
      return c.json({ error: "Unknown tenantId" }, 400);
    }
    throw err;
  }
});

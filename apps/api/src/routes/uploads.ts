import { Hono } from "hono";
import { createDb, sourceVideos } from "@scenestealer/db";
import {
  abortMultipartUpload,
  completeMultipartUpload,
  createMultipartUpload,
  createPresignedUploadUrl,
  presignUploadPart,
} from "../r2.js";
import { requireTenant } from "../auth.js";
import type { Env } from "../index.js";
import type { Variables } from "../auth.js";

export const uploads = new Hono<{ Bindings: Env; Variables: Variables }>();

uploads.use("*", requireTenant);

function r2ConfigFrom(env: Env) {
  return {
    accountId: env.R2_ACCOUNT_ID,
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    bucket: env.R2_BUCKET_NAME,
  };
}

function r2KeyFor(tenantId: string, filename: string): string {
  const ext = filename.includes(".") ? filename.split(".").pop() : "bin";
  return `${tenantId}/source-videos/${crypto.randomUUID()}.${ext}`;
}

uploads.post("/presign", async (c) => {
  const tenantId = c.get("tenantId");
  const body = await c.req.json<{
    filename: string;
    contentType?: string;
  }>();
  if (!body.filename) {
    return c.json({ error: "filename is required" }, 400);
  }

  const r2Key = r2KeyFor(tenantId, body.filename);

  const uploadUrl = await createPresignedUploadUrl(r2ConfigFrom(c.env), r2Key);

  return c.json({ uploadUrl, r2Key });
});

// Multipart path — required for anything over R2's 5 GiB single-PUT cap
// (see r2.ts's createMultipartUpload comment for the real incident that
// surfaced this). apps/web decides which path to use based on file
// size; POST /complete below is unchanged and shared by both paths —
// it only records the finished object in Postgres, so it doesn't care
// how the object got there.
uploads.post("/multipart/create", async (c) => {
  const tenantId = c.get("tenantId");
  const body = await c.req.json<{
    filename: string;
    contentType?: string;
  }>();
  if (!body.filename) {
    return c.json({ error: "filename is required" }, 400);
  }

  const r2Key = r2KeyFor(tenantId, body.filename);
  const uploadId = await createMultipartUpload(
    r2ConfigFrom(c.env),
    r2Key,
    body.contentType,
  );

  return c.json({ r2Key, uploadId });
});

uploads.post("/multipart/sign-part", async (c) => {
  const body = await c.req.json<{
    r2Key?: string;
    uploadId?: string;
    partNumber?: number;
  }>();
  if (!body.r2Key || !body.uploadId || !body.partNumber) {
    return c.json(
      { error: "r2Key, uploadId, and partNumber are required" },
      400,
    );
  }

  const url = await presignUploadPart(
    r2ConfigFrom(c.env),
    body.r2Key,
    body.uploadId,
    body.partNumber,
  );

  return c.json({ url });
});

uploads.post("/multipart/complete", async (c) => {
  const body = await c.req.json<{
    r2Key?: string;
    uploadId?: string;
    parts?: { partNumber: number; etag: string }[];
  }>();
  if (!body.r2Key || !body.uploadId || !body.parts?.length) {
    return c.json({ error: "r2Key, uploadId, and parts are required" }, 400);
  }

  try {
    await completeMultipartUpload(
      r2ConfigFrom(c.env),
      body.r2Key,
      body.uploadId,
      body.parts,
    );
  } catch (e) {
    const message =
      e instanceof Error ? e.message : "Failed to complete upload";
    return c.json({ error: message }, 502);
  }

  return c.json({ ok: true });
});

// Best-effort cleanup when the client gives up on a multipart upload
// (a part failed after retries, the user navigated away) — see
// abortMultipartUpload's own comment for why this matters even though
// nothing downstream depends on it succeeding.
uploads.post("/multipart/abort", async (c) => {
  const body = await c.req.json<{ r2Key?: string; uploadId?: string }>();
  if (!body.r2Key || !body.uploadId) {
    return c.json({ error: "r2Key and uploadId are required" }, 400);
  }

  await abortMultipartUpload(r2ConfigFrom(c.env), body.r2Key, body.uploadId);
  return c.json({ ok: true });
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

import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { AwsClient } from "aws4fetch";

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

/**
 * Direct server-to-server R2 GET, streamed straight to disk — unlike
 * apps/api's r2.ts, this doesn't need a presigned URL (that exists only
 * because a *browser* needs a URL it can hit directly). This worker
 * holds the R2 credentials itself, so AwsClient.fetch() signs and
 * performs the request in one step.
 *
 * Streams rather than buffering the whole response (the previous
 * `res.arrayBuffer()` + `Buffer.from()` + `writeFile()` shape): that
 * held two full copies of the video in memory at once before a single
 * byte reached disk. Confirmed for real (2026-09-06) as a major
 * contributor to a 1.24GB upload's analyze job OOMing at a 4GB ceiling
 * — RSS jumped to ~2.4GB from the download step alone, before any of
 * the actual analysis work even started. See ROADMAP.md.
 */
export async function downloadFromR2ToFile(
  config: R2Config,
  key: string,
  destPath: string,
): Promise<void> {
  const client = new AwsClient({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    region: "auto",
    service: "s3",
  });

  const url = `https://${config.accountId}.r2.cloudflarestorage.com/${config.bucket}/${key}`;
  const res = await client.fetch(url, { method: "GET" });
  if (!res.ok) {
    throw new Error(`R2 download failed for ${key}: ${res.status}`);
  }
  if (!res.body) {
    throw new Error(`R2 download for ${key} returned no response body`);
  }
  await pipeline(Readable.fromWeb(res.body), createWriteStream(destPath));
}

export async function uploadToR2(
  config: R2Config,
  key: string,
  body: Uint8Array,
  contentType = "video/mp4",
): Promise<void> {
  const client = new AwsClient({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    region: "auto",
    service: "s3",
  });

  const url = `https://${config.accountId}.r2.cloudflarestorage.com/${config.bucket}/${key}`;
  const res = await client.fetch(url, {
    method: "PUT",
    body,
    headers: { "Content-Type": contentType },
  });
  if (!res.ok) {
    throw new Error(`R2 upload failed for ${key}: ${res.status}`);
  }
}

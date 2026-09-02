import { AwsClient } from "aws4fetch";

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

/**
 * Generates a presigned PUT URL so the browser uploads straight to R2,
 * bypassing this Worker for the actual bytes. Uses aws4fetch, not the
 * official AWS SDK — the SDK needs Node.js APIs Workers don't have.
 *
 * Deliberately does NOT sign Content-Type: with signQuery (query-string
 * signing, required for a browser-usable presigned URL), aws4fetch only
 * signs the `host` header. Sending any other header the client sets
 * (e.g. Content-Type) makes R2 see an unsigned header and reject the
 * request — a real gotcha, not a guess, confirmed against current R2
 * presigned-URL guidance before writing this.
 */
export async function createPresignedUploadUrl(
  config: R2Config,
  key: string,
  expiresInSeconds = 3600,
): Promise<string> {
  const client = new AwsClient({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    region: "auto",
    service: "s3",
  });

  const url = new URL(
    `https://${config.accountId}.r2.cloudflarestorage.com/${config.bucket}/${key}`,
  );
  url.searchParams.set("X-Amz-Expires", String(expiresInSeconds));

  const signed = await client.sign(url.toString(), {
    method: "PUT",
    aws: { signQuery: true },
  });

  return signed.url;
}

/**
 * Deletes an object directly — unlike the presigned helpers above, this
 * runs server-side with real R2 credentials, so it just signs and sends
 * the request itself rather than handing back a URL for someone else to
 * use.
 */
export async function deleteR2Object(
  config: R2Config,
  key: string,
): Promise<void> {
  const client = new AwsClient({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    region: "auto",
    service: "s3",
  });

  const url = `https://${config.accountId}.r2.cloudflarestorage.com/${config.bucket}/${key}`;
  const res = await client.fetch(url, { method: "DELETE" });
  // R2 returns 204 whether or not the key existed — only a genuine
  // error (e.g. bad credentials) should surface here.
  if (!res.ok && res.status !== 404) {
    throw new Error(`Failed to delete R2 object ${key}: ${res.status}`);
  }
}

/**
 * Presigned GET URL for the clip editor's video playback + wavesurfer.js
 * waveform generation — same signing shape as the upload URL above, just
 * GET instead of PUT.
 */
export async function createPresignedGetUrl(
  config: R2Config,
  key: string,
  expiresInSeconds = 3600,
): Promise<string> {
  const client = new AwsClient({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    region: "auto",
    service: "s3",
  });

  const url = new URL(
    `https://${config.accountId}.r2.cloudflarestorage.com/${config.bucket}/${key}`,
  );
  url.searchParams.set("X-Amz-Expires", String(expiresInSeconds));

  const signed = await client.sign(url.toString(), {
    method: "GET",
    aws: { signQuery: true },
  });

  return signed.url;
}

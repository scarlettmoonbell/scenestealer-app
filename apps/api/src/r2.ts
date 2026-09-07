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
 * Starts a multipart upload and returns its UploadId. Required for
 * anything over R2's (and S3's) 5 GiB single-PUT object cap — confirmed
 * for real (2026-09-07): a 5.38GB test upload got a flat HTTP 400 from
 * `createPresignedUploadUrl`'s plain PUT, which has no path for objects
 * over that limit. Runs server-side with real credentials (like
 * deleteR2Object below), not as a presigned URL — this call moves no
 * object bytes itself, so there's no reason to let the browser hold
 * R2 credentials for it.
 *
 * R2's CreateMultipartUpload response is a small, fixed-shape XML
 * document — parsed with a regex rather than pulling in an XML parser
 * dependency (or reaching for `DOMParser`, which the Workers runtime
 * doesn't provide) for one tag.
 */
export async function createMultipartUpload(
  config: R2Config,
  key: string,
  contentType?: string,
): Promise<string> {
  const client = new AwsClient({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    region: "auto",
    service: "s3",
  });

  const url = `https://${config.accountId}.r2.cloudflarestorage.com/${config.bucket}/${key}?uploads`;
  const res = await client.fetch(url, {
    method: "POST",
    headers: contentType ? { "Content-Type": contentType } : undefined,
  });
  if (!res.ok) {
    throw new Error(
      `Failed to create multipart upload for ${key}: ${res.status}`,
    );
  }
  const body = await res.text();
  const match = /<UploadId>([^<]+)<\/UploadId>/.exec(body);
  if (!match) {
    throw new Error(
      `CreateMultipartUpload response for ${key} had no UploadId: ${body.slice(0, 200)}`,
    );
  }
  return match[1]!;
}

/**
 * Presigned PUT for one part of a multipart upload — same shape as
 * createPresignedUploadUrl, just with partNumber/uploadId added to the
 * signed query string so R2 knows which upload and which slot this
 * part's bytes belong to. The browser PUTs the part's bytes here
 * directly, same as the single-shot path; the response's `ETag` header
 * must be captured by the caller and passed to completeMultipartUpload.
 */
export async function presignUploadPart(
  config: R2Config,
  key: string,
  uploadId: string,
  partNumber: number,
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
  url.searchParams.set("partNumber", String(partNumber));
  url.searchParams.set("uploadId", uploadId);
  url.searchParams.set("X-Amz-Expires", String(expiresInSeconds));

  const signed = await client.sign(url.toString(), {
    method: "PUT",
    aws: { signQuery: true },
  });

  return signed.url;
}

/**
 * Finalizes a multipart upload, stitching R2's per-part objects into
 * the real, final object — the part ETags (as returned by each part's
 * own PUT response, not invented client-side) must be supplied in
 * ascending partNumber order; R2 rejects the request otherwise.
 */
export async function completeMultipartUpload(
  config: R2Config,
  key: string,
  uploadId: string,
  parts: { partNumber: number; etag: string }[],
): Promise<void> {
  const client = new AwsClient({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    region: "auto",
    service: "s3",
  });

  const sorted = [...parts].sort((a, b) => a.partNumber - b.partNumber);
  const body =
    `<CompleteMultipartUpload>` +
    sorted
      .map(
        (p) =>
          `<Part><PartNumber>${p.partNumber}</PartNumber><ETag>${p.etag}</ETag></Part>`,
      )
      .join("") +
    `</CompleteMultipartUpload>`;

  const url = `https://${config.accountId}.r2.cloudflarestorage.com/${config.bucket}/${key}?uploadId=${uploadId}`;
  const res = await client.fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/xml" },
    body,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Failed to complete multipart upload for ${key}: ${res.status} ${text.slice(0, 300)}`,
    );
  }
}

/**
 * Best-effort cleanup for a multipart upload the client gave up on
 * (part failed after retries, user navigated away) — R2 keeps
 * uploaded-but-never-completed parts around (and billed) until either
 * completed or explicitly aborted. Swallows its own failure the same
 * way deleteR2Object's callers already tolerate a delete not landing;
 * the upload never completing is the real outcome either way.
 */
export async function abortMultipartUpload(
  config: R2Config,
  key: string,
  uploadId: string,
): Promise<void> {
  const client = new AwsClient({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    region: "auto",
    service: "s3",
  });

  const url = `https://${config.accountId}.r2.cloudflarestorage.com/${config.bucket}/${key}?uploadId=${uploadId}`;
  await client.fetch(url, { method: "DELETE" });
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
 * Presigned GET URL — same signing shape as the upload URL above, just
 * GET instead of PUT. Used for the clip editor's <video> playback (and,
 * separately, its own precomputed waveform-peaks JSON — see routes/
 * videos.ts's GET /:id/waveform-url); wavesurfer.js itself no longer
 * fetches or decodes the raw video for waveform generation, since doing
 * that client-side is what used to crash iOS Safari on a large upload.
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

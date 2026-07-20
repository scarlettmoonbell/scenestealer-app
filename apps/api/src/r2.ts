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

import { AwsClient } from "aws4fetch";

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

/**
 * Direct server-to-server R2 GET — unlike apps/api's r2.ts, this doesn't
 * need a presigned URL (that exists only because a *browser* needs a URL
 * it can hit directly). This worker holds the R2 credentials itself, so
 * AwsClient.fetch() signs and performs the request in one step.
 */
export async function downloadFromR2(
  config: R2Config,
  key: string,
): Promise<ArrayBuffer> {
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
  return res.arrayBuffer();
}

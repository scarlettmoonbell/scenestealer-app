import { createWriteStream } from "node:fs";
import { open } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { AwsClient } from "aws4fetch";

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

function r2Client(config: R2Config): AwsClient {
  return new AwsClient({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    region: "auto",
    service: "s3",
  });
}

/**
 * Presigned GET URL — unlike downloadFromR2ToFile above, this exists
 * specifically so a *separate subprocess* (ffmpeg, for render.ts) can
 * fetch the object itself; this worker's own in-process AwsClient
 * signing has no way to hand ffmpeg an authenticated request. Same
 * signing shape as apps/api's own createPresignedGetUrl (a distinct
 * copy, not a shared import — R2Config/AwsClient setup already exists
 * separately in each app, and this is the only presigned URL apps/worker
 * itself needs to generate).
 *
 * Confirmed for real (2026-09-07): ffmpeg's `-ss <start> -to <end> -i
 * <url>` (both -ss/-to as *input* options, already how
 * ffmpeg-renderer.ts invokes it) performs true HTTP range-based seeking
 * against a presigned R2 URL, not a sequential read from byte 0 — timed
 * a 15s extraction at both the ~5s mark and the ~1010s mark of a
 * real 1031s/1.24GB source and both completed in ~2-4s, not the ~85s+ a
 * full download of that file takes. Lets render skip downloading the
 * entire source file just to encode a short clip out of it.
 */
export async function createPresignedGetUrl(
  config: R2Config,
  key: string,
  expiresInSeconds = 3600,
): Promise<string> {
  const client = r2Client(config);
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

// 6 concurrent ranged GETs — a real, single-TCP-stream download of this
// object measured ~90-100 Mbps sustained (confirmed for real, 2026-09-07:
// a ~1.1GB analyze source took ~90-100s), consistent with one
// connection's own congestion-control ceiling over a multi-hop path
// rather than R2 or Fly's network itself being the limit; splitting the
// transfer across several concurrent connections isn't bound by any one
// connection's ceiling the same way. Not tuned beyond a reasonable
// default — revisit if real timing data suggests a different number
// pays off better.
const PARALLEL_DOWNLOAD_CHUNKS = 6;
// Below this, the per-request overhead of splitting into ranges isn't
// worth it — a single streamed GET is simpler and plenty fast for a
// small object anyway.
const MIN_SIZE_FOR_PARALLEL_DOWNLOAD_BYTES = 32 * 1024 * 1024; // 32MB

/**
 * Direct server-to-server R2 GET, streamed straight to disk — unlike
 * apps/api's r2.ts, this doesn't need a presigned URL (that exists only
 * because a *browser* needs a URL it can hit directly). This worker
 * holds the R2 credentials itself, so AwsClient.fetch() signs and
 * performs each request directly.
 *
 * Splits large objects into several concurrent ranged GETs rather than
 * one streamed GET (still how uploadToR2 and small objects work) — see
 * PARALLEL_DOWNLOAD_CHUNKS above for why. Each range streams straight to
 * its own byte offset in the destination file (`fs.createWriteStream`'s
 * `start` + `flags: "r+"`, writing into a pre-created file, not
 * buffering a chunk in memory before writing it) — same rationale as
 * the original single-stream version this replaced: streaming avoids
 * holding multiple copies of a very large file in memory at once
 * (confirmed for real, 2026-09-06, as a major OOM contributor before
 * that first streaming fix — see ROADMAP.md), and splitting into ranges
 * doesn't reintroduce that risk since each range's own chunk size
 * (total size / PARALLEL_DOWNLOAD_CHUNKS) is still streamed, never
 * buffered whole.
 */
export async function downloadFromR2ToFile(
  config: R2Config,
  key: string,
  destPath: string,
): Promise<void> {
  const client = r2Client(config);
  const url = `https://${config.accountId}.r2.cloudflarestorage.com/${config.bucket}/${key}`;

  const headRes = await client.fetch(url, { method: "HEAD" });
  if (!headRes.ok) {
    throw new Error(`R2 HEAD failed for ${key}: ${headRes.status}`);
  }
  const contentLength = Number(headRes.headers.get("content-length"));
  const acceptsRanges = headRes.headers.get("accept-ranges") === "bytes";

  if (
    !acceptsRanges ||
    !Number.isFinite(contentLength) ||
    contentLength < MIN_SIZE_FOR_PARALLEL_DOWNLOAD_BYTES
  ) {
    await downloadWholeStream(client, url, key, destPath);
    return;
  }

  // Pre-create the destination file so each concurrent range's own
  // write stream can open it with `flags: "r+"` (write-in-place at a
  // byte offset) — 'r+' requires the file to already exist; a fresh
  // empty file is fine, POSIX filesystems handle each stream extending/
  // sparse-filling its own region without the others needing to exist
  // yet.
  const fh = await open(destPath, "w");
  await fh.close();

  const chunkSize = Math.ceil(contentLength / PARALLEL_DOWNLOAD_CHUNKS);
  const ranges: Array<[number, number]> = [];
  for (let start = 0; start < contentLength; start += chunkSize) {
    ranges.push([start, Math.min(start + chunkSize, contentLength) - 1]);
  }

  await Promise.all(
    ranges.map(([start, end]) =>
      downloadRange(client, url, key, destPath, start, end),
    ),
  );
}

async function downloadRange(
  client: AwsClient,
  url: string,
  key: string,
  destPath: string,
  start: number,
  end: number,
): Promise<void> {
  const res = await client.fetch(url, {
    method: "GET",
    headers: { Range: `bytes=${start}-${end}` },
  });
  // 206 Partial Content is the only correct success status for a
  // satisfied Range request — a plain 200 here would mean the server
  // ignored the Range header and sent the whole object instead, which
  // would silently corrupt the file if written at this range's offset.
  if (res.status !== 206) {
    throw new Error(
      `R2 ranged download failed for ${key} bytes=${start}-${end}: ${res.status}`,
    );
  }
  if (!res.body) {
    throw new Error(
      `R2 ranged download for ${key} bytes=${start}-${end} returned no response body`,
    );
  }
  await pipeline(
    Readable.fromWeb(res.body),
    createWriteStream(destPath, { start, flags: "r+" }),
  );
}

async function downloadWholeStream(
  client: AwsClient,
  url: string,
  key: string,
  destPath: string,
): Promise<void> {
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
  const client = r2Client(config);
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

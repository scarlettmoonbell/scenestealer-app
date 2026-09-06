import { createServer, type ServerResponse } from "node:http";
import { runAnalyze } from "./analyze.js";
import { runRender } from "./render.js";

// Always-on entrypoint for the Fly app deployment — see fly.toml. Deferred:
// the full PLAN.md architecture (Cloudflare Queue -> Fly Machines API ->
// per-job dynamic Machine spawn); this is a deliberately smaller first cut,
// a single small Fly app apps/api proxies to directly. index.ts's one-shot
// CLI mode is what the future per-job model will actually invoke.

const PORT = Number(process.env.PORT ?? 8080);
const SHARED_SECRET = process.env.WORKER_SHARED_SECRET;
if (!SHARED_SECRET) {
  throw new Error("WORKER_SHARED_SECRET is required");
}

function readBody(req: import("node:http").IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk: Buffer) => (body += chunk.toString()));
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

const KEEPALIVE_INTERVAL_MS = 20_000;

// Fly's own proxy closes a connection after 60s with no data sent in
// either direction — confirmed against Fly's own community docs, not
// assumed, after real 524s hit production 2026-09-06 on a large
// upload once memory was no longer the bottleneck (that fix landed
// first — see fly.toml). analyze/render can both run well past 60s
// for a large file, and this handler previously did all its work
// silently before writing one response at the end.
//
// Commits to a 200 status immediately, then writes a bare newline
// periodically while `work` is in flight to keep the connection
// active. This is safe for the final payload: a JSON value may have
// arbitrary leading whitespace per spec, and JSON.parse on the
// caller's side ignores it, so the real result is still parsed
// correctly once it's the last thing written. Because the status is
// already committed before `work` even starts, a caught failure is
// reported via the JSON body's own `error` field rather than a
// non-2xx status — callers (apps/api's runAnalyzeJob and clips.ts's
// /:id/render route) check for that field regardless of HTTP status
// now, not just workerRes.ok.
async function runWithKeepAlive(
  res: ServerResponse,
  work: () => Promise<unknown>,
): Promise<void> {
  res.writeHead(200, { "content-type": "application/json" });
  const keepAlive = setInterval(() => res.write("\n"), KEEPALIVE_INTERVAL_MS);
  try {
    const result = await work();
    res.end(JSON.stringify(result));
  } catch (err) {
    res.end(
      JSON.stringify({
        error: err instanceof Error ? err.message : "Failed",
      }),
    );
  } finally {
    clearInterval(keepAlive);
  }
}

const server = createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/healthz") {
    res.writeHead(200).end("ok");
    return;
  }

  if (
    req.method !== "POST" ||
    (req.url !== "/analyze" && req.url !== "/render")
  ) {
    res.writeHead(404).end();
    return;
  }

  if (req.headers.authorization !== `Bearer ${SHARED_SECRET}`) {
    res
      .writeHead(401, { "content-type": "application/json" })
      .end(JSON.stringify({ error: "Unauthorized" }));
    return;
  }

  if (req.url === "/analyze") {
    let sourceVideoId: string | undefined;
    try {
      ({ sourceVideoId } = JSON.parse(await readBody(req)) as {
        sourceVideoId?: string;
      });
    } catch (err) {
      console.error(err);
      res
        .writeHead(400, { "content-type": "application/json" })
        .end(JSON.stringify({ error: "Invalid request body" }));
      return;
    }
    if (!sourceVideoId) {
      res
        .writeHead(400, { "content-type": "application/json" })
        .end(JSON.stringify({ error: "sourceVideoId is required" }));
      return;
    }

    const id = sourceVideoId;
    await runWithKeepAlive(res, () => runAnalyze(id));
    return;
  }

  let clipId: string | undefined;
  try {
    ({ clipId } = JSON.parse(await readBody(req)) as { clipId?: string });
  } catch (err) {
    console.error(err);
    res
      .writeHead(400, { "content-type": "application/json" })
      .end(JSON.stringify({ error: "Invalid request body" }));
    return;
  }
  if (!clipId) {
    res
      .writeHead(400, { "content-type": "application/json" })
      .end(JSON.stringify({ error: "clipId is required" }));
    return;
  }

  const id = clipId;
  await runWithKeepAlive(res, () => runRender(id));
});

server.listen(PORT, () => {
  console.log(`scenestealer-worker listening on :${PORT}`);
});

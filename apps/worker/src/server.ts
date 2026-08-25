import { createServer } from "node:http";
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
    try {
      const { sourceVideoId } = JSON.parse(await readBody(req)) as {
        sourceVideoId?: string;
      };
      if (!sourceVideoId) {
        res
          .writeHead(400, { "content-type": "application/json" })
          .end(JSON.stringify({ error: "sourceVideoId is required" }));
        return;
      }

      const result = await runAnalyze(sourceVideoId);
      res
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify(result));
    } catch (err) {
      console.error(err);
      res.writeHead(500, { "content-type": "application/json" }).end(
        JSON.stringify({
          error: err instanceof Error ? err.message : "Analysis failed",
        }),
      );
    }
    return;
  }

  try {
    const { clipId } = JSON.parse(await readBody(req)) as {
      clipId?: string;
    };
    if (!clipId) {
      res
        .writeHead(400, { "content-type": "application/json" })
        .end(JSON.stringify({ error: "clipId is required" }));
      return;
    }

    const result = await runRender(clipId);
    res
      .writeHead(200, { "content-type": "application/json" })
      .end(JSON.stringify(result));
  } catch (err) {
    console.error(err);
    res.writeHead(500, { "content-type": "application/json" }).end(
      JSON.stringify({
        error: err instanceof Error ? err.message : "Render failed",
      }),
    );
  }
});

server.listen(PORT, () => {
  console.log(`scenestealer-worker listening on :${PORT}`);
});

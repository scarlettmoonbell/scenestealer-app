/**
 * Spawns a disposable, dedicated-vCPU Fly Machine to run one job, via
 * Fly's Machines API — replaces the always-on `[http_service]` worker
 * app (removed 2026-09-07; see apps/worker/fly.toml's own comment for
 * the full incident history that led here: an idle-connection auto-stop
 * killing a still-running job, then `shared-cpu-2x` throttling hard
 * under sustained load once always-on). `auto_destroy: true` cleans the
 * Machine up the instant its process exits, billed per-second only
 * while it actually runs — no idle cost between jobs, no throttling
 * during them, and no per-request tuning of a shared always-on pool.
 *
 * `init.exec` overrides the image's default CMD to run apps/worker's
 * one-shot CLI mode (`dist/index.js`, see that file) instead — it reads
 * `JOB_TYPE` plus `SOURCE_VIDEO_ID`/`CLIP_ID` from `env` and exits 0/1,
 * exactly the shape this needs. The spawned Machine owns writing its own
 * final status directly to Postgres once done (see apps/worker/src/
 * analyze.ts and render.ts) — this function only confirms the Machine
 * was *created*, not that the job succeeded; a non-2xx response here is
 * a fast, structural dispatch failure (bad image ref, Fly outage, bad
 * token), not the job's real outcome.
 *
 * Field shapes confirmed against Fly's Machines API docs (2026-09-07):
 * `auto_destroy`, `init.exec`, `guest.cpu_kind`/`cpus`/`memory_mb`
 * (mutually exclusive with a `size` shorthand).
 */
export async function spawnWorkerMachine(
  env: { FLY_API_TOKEN: string; WORKER_IMAGE_REF: string },
  jobEnv: Record<string, string>,
): Promise<{ ok: true } | { ok: false; status: number; body: string }> {
  const res = await fetch(
    "https://api.machines.dev/v1/apps/scenestealer-worker/machines",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.FLY_API_TOKEN}`,
      },
      body: JSON.stringify({
        config: {
          image: env.WORKER_IMAGE_REF,
          init: { exec: ["node", "dist/index.js"] },
          env: jobEnv,
          guest: { cpu_kind: "performance", cpus: 2, memory_mb: 4096 },
          auto_destroy: true,
          restart: { policy: "no" },
        },
      }),
    },
  );

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return { ok: false, status: res.status, body: body.slice(0, 500) };
  }
  return { ok: true };
}

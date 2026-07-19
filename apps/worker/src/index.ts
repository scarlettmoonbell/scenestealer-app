// Entry point for a single job run — this Machine is started per job by
// Cloudflare Queues (via the Fly Machines API) and exits when done, not a
// long-running server. See ../../README.md's Infra choices table.
//
// Not implemented yet — this is the Phase 1 scaffold. See README.md's
// Status section for the build sequence.

async function main() {
  const jobType = process.env.JOB_TYPE;
  switch (jobType) {
    case "ingest":
    case "transcribe":
    case "analyze":
    case "render":
    case "publish":
      throw new Error(
        `not implemented — job type "${jobType}" (see README.md Status section)`,
      );
    default:
      throw new Error(`unknown or missing JOB_TYPE env var: ${jobType}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

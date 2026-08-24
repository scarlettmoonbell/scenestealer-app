// One-shot CLI entry point — the shape the future per-job Fly Machine
// model will actually invoke (see ../../README.md's Infra choices
// table). Today's real trigger is server.ts's always-on HTTP mode
// (see fly.toml); this stays for local testing (`JOB_TYPE=analyze
// SOURCE_VIDEO_ID=... pnpm --filter @scenestealer/worker dev`) and as
// the target shape once the Queue/Machines-API wiring exists.

import { runAnalyze } from "./analyze.js";

async function main() {
  const jobType = process.env.JOB_TYPE;
  switch (jobType) {
    case "analyze": {
      const sourceVideoId = process.env.SOURCE_VIDEO_ID;
      if (!sourceVideoId) {
        throw new Error("SOURCE_VIDEO_ID env var is required for analyze");
      }
      const result = await runAnalyze(sourceVideoId);
      console.log(`Created ${result.clipsCreated} clip(s)`);
      break;
    }
    case "ingest":
    case "transcribe":
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

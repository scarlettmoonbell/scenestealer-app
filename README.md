# SceneStealer

Turns a live-theater/performing-arts operator's full-length show recordings
into published social content, automatically: ingest from cloud storage (or
direct upload), publish the full cut to YouTube, use AI to find engaging
moments, let the operator fine-tune clips on a scrubbing/trim UI, apply a
reusable caption template, and publish the resulting clips to Instagram and
Facebook in platform-optimized formats. Real multi-tenant SaaS, billed via
Stripe.

This repo is the deployable product itself. The generically reusable pieces
live in two sibling repos this one depends on:
[`scenestealer-connectors`](https://github.com/scarlettmoonbell/scenestealer-connectors)
(storage/publish connectors) and
[`scenestealer-pipeline`](https://github.com/scarlettmoonbell/scenestealer-pipeline)
(the video-processing engine). Infrastructure is provisioned by the sibling
[`scenestealer-infra`](https://github.com/scarlettmoonbell/scenestealer-infra)
repo — this repo doesn't provision its own Cloudflare/Fly.io/Neon resources,
it deploys onto what that repo creates.

The full product plan — architecture rationale, cost analysis, license
decision, build sequence — is [`PLAN.md`](PLAN.md).

## Status

Phase 1 scaffold. `apps/web`, `apps/api`, `apps/worker`, and `packages/db`
all exist with real, typechecking code, but no external account is wired up
yet (no live Clerk/Stripe/Neon/R2/Postiz credentials) and no business logic
is implemented — every handler is either a placeholder or throws
`not implemented`. See [`ROADMAP.md`](ROADMAP.md) for exactly what's done
and what's next, phase by phase.

## Operations

Infrastructure, the deploy pipeline for provisioned resources, and the
operations roadmap for infra itself live in the sibling
[`scenestealer-infra`](https://github.com/scarlettmoonbell/scenestealer-infra)
repo. This repo's own build/CI is documented in
[`.github/workflows/README.md`](.github/workflows/README.md) (once
workflows exist — Phase 1 scaffold has none yet, see Known Gaps below).

## Repository structure

```text
scenestealer-app/
├── apps/
│   ├── web/     # Next.js dashboard (Cloudflare Pages) — signup/org mgmt,
│   │            #   connection OAuth flows, clip review + scrubbing editor,
│   │            #   template builder, scheduling calendar, Stripe billing
│   ├── api/     # Cloudflare Worker (Hono) — REST API, OAuth/Stripe webhook
│   │            #   receivers, enqueues jobs to Cloudflare Queues
│   └── worker/  # Fly.io Machine (Docker: Node + ffmpeg + rclone +
│                #   scenedetect) — one Machine per job, started on demand,
│                #   not a long-running server
├── packages/
│   └── db/      # Drizzle ORM schema/migrations (Neon Postgres) —
│                #   app-specific, not reusable outside this product
├── pnpm-workspace.yaml
├── turbo.json
├── PLAN.md      # Full product/architecture plan
└── ROADMAP.md   # Phased build sequence: done / next
```

## Dependencies

**Runtime:** Node `>=22.12.0`, `pnpm@9.15.0`, TypeScript `^5.7`.

**Key packages** (see each app/package's own `package.json` for the full
list): `@clerk/nextjs` (auth + multi-tenant Organizations — see PLAN.md for
why Clerk over building this by hand), `drizzle-orm` +
`@neondatabase/serverless` (DB layer), `hono` (lightweight router for the
Cloudflare Worker API), `stripe` (billing), `wavesurfer.js` (waveform +
region-select for the manual scrubbing editor), `@scenestealer/connectors`
and `@scenestealer/pipeline` (git dependencies on the two sibling repos,
until formal npm publishing is worth doing).

**External services this repo depends on** (all provisioned by
`scenestealer-infra`, none created by this repo):

- **Clerk** — auth, Organizations as tenants.
- **Neon** — serverless Postgres.
- **Cloudflare** — Pages (`apps/web`), Workers (`apps/api`), R2 (media
  storage), Queues (job handoff to `apps/worker`).
- **Fly.io** — `apps/worker`'s Machines (pay-per-second, scale-to-zero).
- **Stripe** — subscription billing.
- **Groq, Anthropic** — via `@scenestealer/pipeline`, transcription and
  highlight scoring.
- **rclone, Postiz** (both self-hosted) — via `@scenestealer/connectors`,
  storage access and social publishing.

**Deploy targets:** `apps/web` → Cloudflare Pages. `apps/api` → Cloudflare
Workers (`wrangler deploy`). `apps/worker` → a Docker image run as Fly.io
Machines, started per job. All three provisioned by
`scenestealer-infra` — see that repo's `opentofu/README.md` once written.

## Known Gaps

- **CI is basic.** `.github/workflows/checks.yml` runs
  install/typecheck/lint/format/build on every PR — all four steps verified
  locally end to end (real `pnpm-lock.yaml` committed, `next build`
  actually runs, not just `tsc --noEmit`). No SHA-pinning, Trivy, or
  gitleaks yet.
- **No live credentials.** Every `.env.example` in `apps/*` lists what's
  needed; none are wired to real accounts yet — creating those accounts
  (Clerk, Stripe, Neon, Cloudflare, Fly.io) requires a human, not something
  this repo's code can do for itself.
- **`apps/worker`'s Dockerfile is written to spec but not build-verified.**
  The TS build it depends on (`pnpm --filter @scenestealer/worker build`)
  passes; the actual `docker build` was attempted and could not be
  verified in this environment (no Docker daemon running). Verify for real
  before Phase 2 relies on it.

## Where to go next

- **Full architecture/product plan**: [`PLAN.md`](PLAN.md)
- **What's done and what's next, in build-sequence order**:
  [`ROADMAP.md`](ROADMAP.md)
- **Storage/publish connectors**:
  [`scenestealer-connectors`](https://github.com/scarlettmoonbell/scenestealer-connectors)
- **Video processing engine**:
  [`scenestealer-pipeline`](https://github.com/scarlettmoonbell/scenestealer-pipeline)
- **Infrastructure**:
  [`scenestealer-infra`](https://github.com/scarlettmoonbell/scenestealer-infra)

## License

BSL 1.1 — see [`LICENSE`](LICENSE). Converts to Apache-2.0 four years after
each version's release; free for self-hosting and non-competing use, all use
grant details in the license file. `scenestealer-connectors` and
`scenestealer-pipeline` are separately licensed MIT/Apache-2.0 — see
`PLAN.md`'s license-compatibility section for why depending on those and on
AGPL-licensed Postiz doesn't affect this repo's own license.

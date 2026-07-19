## Development

```
pnpm install
pnpm dev          # turbo run dev — starts apps/web (Next.js) and apps/api
                   # (wrangler dev) together; apps/worker has no persistent
                   # dev server, see below
pnpm build
pnpm typecheck
pnpm lint
```

Per-app, when you only need one:

- **`apps/web`** (Next.js dashboard): `pnpm --filter @scenestealer/web dev`
  — `localhost:3000`. Needs `apps/web/.env.local` filled in from
  `.env.example` (Clerk keys, `DATABASE_URL`, Stripe keys).
- **`apps/api`** (Cloudflare Worker): `pnpm --filter @scenestealer/api dev`
  — runs `wrangler dev` locally. Secrets are set via `wrangler secret put`,
  never committed; see `apps/api/wrangler.toml`'s comment.
- **`apps/worker`** (Fly.io job runner): no long-running dev server — it's a
  one-shot-per-job process. Run a single job locally with
  `JOB_TYPE=<type> pnpm --filter @scenestealer/worker dev`. Building the
  actual Docker image: `docker build -t scenestealer-worker apps/worker`
  (untested as of Phase 1 — see README.md Known Gaps).

## Documentation

- [Next.js App Router docs](https://nextjs.org/docs) — `apps/web`.
- [Clerk + Next.js docs](https://clerk.com/docs/quickstarts/nextjs) —
  auth/Organizations wiring in `apps/web`.
- [Cloudflare Workers docs](https://developers.cloudflare.com/workers/) and
  [Hono docs](https://hono.dev/) — `apps/api`.
- [Fly.io Machines docs](https://fly.io/docs/machines/) — how `apps/worker`
  gets started per job (provisioning side lives in `scenestealer-infra`).
- [Drizzle ORM docs](https://orm.drizzle.team/docs/overview) — `packages/db`.
- [`PLAN.md`](PLAN.md) — read before touching architecture, infra choices,
  or the AI/build-vs-buy reasoning; it's the source of truth those
  decisions trace back to.

# SceneStealer Build Roadmap

A phased record of what's built and what's next, tracking the build
sequence from [`PLAN.md`](PLAN.md). Unlike a pure ops backlog, most of this
is a strict sequential build order rather than "revisit when triggered" —
noted where an item genuinely is situational instead.

## ✅ Phase 0 — Done (2026-07-18)

- **Product name and license decided**: SceneStealer; BSL 1.1 for
  `scenestealer-app` (4-year Change Date, Apache-2.0 Change License),
  MIT/Apache-2.0 for the two library repos. Full reasoning, including the
  license-compatibility check against every dependency (rclone, Postiz,
  PySceneDetect, the SamurAIGPT reference, ffmpeg), in `PLAN.md`.
- **Full architecture plan written** (`PLAN.md`): repo layout, infra choices
  with cost rationale, the AI build-vs-buy decision with real pricing,
  video pipeline design, data model, platform constraints researched
  against current docs, and the open-source tools this build leans on
  (rclone, Postiz, PySceneDetect, SamurAIGPT reference, wavesurfer.js)
  instead of hand-rolling every integration.

## ✅ Phase 1 — Done (2026-07-19)

- **All four repos created** under `scarlettmoonbell`:
  `scenestealer-connectors` (public, MIT), `scenestealer-pipeline` (public,
  Apache-2.0), `scenestealer-app` (this repo, public, BSL 1.1),
  `scenestealer-infra` (private).
- **`scenestealer-connectors`**: `StorageProvider` (rclone-backed) and
  `PublishProvider` (Postiz-backed) interfaces, final-shaped;
  implementations stubbed.
- **`scenestealer-pipeline`**: transcribe/scenes/highlight/render module
  interfaces, final-shaped and adapted from the SamurAIGPT reference
  pipeline's approach; implementations stubbed except `snapToScenes` (pure
  function, implemented for real).
- **`scenestealer-app` workspace**: `pnpm` + Turborepo monorepo with
  `apps/web` (Next.js + Clerk dashboard shell), `apps/api` (Cloudflare
  Worker, Hono router, `/healthz` only), `apps/worker` (Dockerfile with
  ffmpeg/rclone/scenedetect, one-shot-per-job entry point), `packages/db`
  (full Drizzle schema for the core data model — one deliberate deviation
  from `PLAN.md`: no `Membership` table, since Clerk Organizations already
  own that).
- **Documentation conventions applied across all four repos**, matching
  the pattern developed in `montage-a-trois`/`montage-a-trois-infra` —
  written up as a standalone reference in
  [`claude-docs-conventions`](https://github.com/scarlettmoonbell/claude-docs-conventions)
  so it doesn't have to be re-derived on the next project.
- **Verified for real, not just written**: `pnpm install` across the whole
  workspace succeeds (real `pnpm-lock.yaml` committed), and
  `typecheck`/`lint`/`format`/`build` all pass clean across all four
  packages — including a real `next build`, not just `tsc --noEmit`. The
  one thing that could _not_ be verified in this environment:
  `apps/worker`'s `docker build` (no Docker daemon available here) — see
  Accepted Gaps below.

**Real bug found and fixed during this work**: `next build` failed
prerendering `apps/web`'s one page — `@clerk/clerk-react` throws at
prerender time if `ClerkProvider` has no `publishableKey`, and there's no
live Clerk account yet (see Accepted Gaps below). The fix is not a dummy
key: `apps/web/app/layout.tsx` now sets `export const dynamic =
"force-dynamic"`, which is also the architecturally correct choice
independent of this bug — every route here is behind Clerk auth and
per-tenant, so nothing should be statically prerendered in the first
place. Static generation trying to run at all against an auth-gated app
was the actual bug; the missing key just surfaced it.

## ✅ Phase 2 (partial) — Done (2026-07-19/20): Direct upload backend

- **`packages/db`'s first migration generated and applied to the real
  database** — `drizzle-kit generate` then `migrate`, all 9 tables
  confirmed live via `psql \dt` (installed via the `libpq` Homebrew
  formula purely for verification). Real snag: `drizzle-kit generate`
  hung with zero output — waiting on an interactive prompt with no stdin
  attached in this environment; fixed with `< /dev/null`.
- **Direct-upload backend built and proven end-to-end against real
  infrastructure, not mocked**: `apps/api` gained a presigned-URL
  R2 upload flow (`POST /uploads/presign` → `POST /uploads/complete`),
  using `aws4fetch` (the official AWS SDK doesn't run in Workers — no
  Node.js APIs). Verified for real: called `/presign`, took the returned
  URL and did an actual `curl -X PUT` with a test file, confirmed the
  object landed in `scenestealer-media` via a direct signed `ListBucket`
  call, called `/complete`, confirmed the resulting `source_videos` row
  via `psql`. Test tenant/row/object all cleaned up afterward.
- **Real bug caught by the schema itself**: the first `/complete` test
  hit a foreign-key violation (`23503`) because the test `tenantId` had
  no matching `tenants` row — correct behavior, but the endpoint returned
  a bare 500. Fixed by catching `23503` specifically and returning a
  clean `400 Unknown tenantId` instead of leaking a raw DB error.
- **Real R2 presigned-URL gotcha, confirmed via research before writing
  code**: with query-string signing (required for a browser-usable
  presigned URL), `aws4fetch` only signs the `host` header — sending
  `Content-Type` from the client makes R2 see an unsigned header and
  reject the request. Documented directly in `r2.ts`'s comments, not
  just here, so it isn't rediscovered the hard way later.
- **Environment finding, not a code bug**: `npx <tool>` and `pnpm run
  <script>` both hung indefinitely (near-zero CPU, genuinely blocked, not
  slow) for `eslint` specifically in this session, while the identical
  `tsc`/`drizzle-kit` commands only needed `< /dev/null` to unstick.
  Root cause not fully isolated; workaround confirmed reliable: invoke
  the binary directly (`node_modules/.bin/eslint` or via `turbo run
  lint`, not `npx eslint`/`pnpm lint`). Also found `next build` hangs
  specifically when forced via `turbo run build --force` — unforced
  (relying on turbo's normal cache invalidation) works fine. Neither is
  a config or code problem; noted here so the next session doesn't
  re-diagnose the same thing.

- **Separately, a real pre-existing gap fixed while investigating the
  above**: root `eslint.config.js` didn't exclude `next-env.d.ts`
  (gitignored, Next.js-generated) from linting — its triple-slash
  reference tripped `@typescript-eslint/triple-slash-reference`. Not
  caused by this session's changes, just never exercised by a full
  workspace lint run until now.
- **`.dev.vars` (Wrangler's local-secrets file) was missing from
  `.gitignore` entirely** — added before it was ever used, not after.

**Still remaining in this phase:**

- **`apps/web`'s actual upload UI doesn't exist yet** — blocked on Clerk,
  not on the backend above. `apps/web` is wrapped in `ClerkProvider`,
  which needs a real `publishableKey` to render at all; no live Clerk
  account exists yet (see `scenestealer-infra`'s Known Gaps). The backend
  proven above is ready for a frontend the moment Clerk is set up.
- **The temporary security gap in `apps/api/src/routes/uploads.ts`**:
  `tenantId` is trusted directly from the request body, since there's no
  Clerk session yet to derive it from. Fine for proving the mechanism
  (done above); replace with a session-derived `tenantId` the moment
  Clerk auth exists — anyone can currently write into any tenant if this
  endpoint were reachable from a real client.
- Stand up rclone; register an OAuth app for Google Drive first; implement
  `RcloneStorageProvider` in `scenestealer-connectors`.
- Then Dropbox, OneDrive/SharePoint, Box (OAuth-consent group); then S3,
  Azure Blob, GCS (credential-based group). _Genuinely situational within
  this phase_: the credential-based group can slip later if no early
  customer needs it — not blocking the rest of the build.

## 🗓 Phase 3 — Next: First real publish loop

- Deploy self-hosted Postiz (`scenestealer-infra`).
- Implement `PostizPublishProvider`; verify a manual YouTube full-video
  publish through it end-to-end. Chosen first deliberately: no Meta App
  Review gate, so this proves the Postiz integration before Meta enters
  the picture.

## 🗓 Phase 4 — Next: AI auto-clip + manual editor

- Implement `GroqTranscriber`, `PySceneDetectDetector.detectScenes`,
  `detectAudioEnergyEvents`, `ClaudeHighlightScorer` in
  `scenestealer-pipeline`.
- Build the scrubbing/trim editor UI in `apps/web` (wavesurfer.js).

## 🗓 Phase 5 — Next: Templates + rendering

- Templating engine (caption variables) in `apps/web`/`apps/api`.
- Implement `FfmpegRenderer` (platform-spec encode + face-tracked vertical
  reframe) in `scenestealer-pipeline`.

## 🗓 Phase 6 — Next: Meta

- **Submit Meta App Review** — should actually start in parallel with
  Phase 2, not wait until here; it's the single longest lead-time
  dependency in the whole project (2-4 weeks per submission).
- Wire IG/FB publish through Postiz once approved.

## 🗓 Phase 7 — Next: Scheduling, billing, polish

- Post scheduling, onboarding polish for a non-technical audience.
- **Stripe billing — integration shape decided (2026-07-19), real tiers
  still deferred.** Full plan and reasoning in `scenestealer-infra`'s
  `ROADMAP.md` Phase 2b: Stripe-hosted Checkout with Managed Payments,
  flat-rate pricing (one Product per tier), card-on-file trial (auto-
  converts), Stripe-hosted Customer Portal for self-service, Smart
  Retries for failed payments. `scenestealer-infra`'s `stripe.tf` already
  has 3 **placeholder** tiers (Starter/Pro/Studio, $29/$79/$199/mo) live
  in the test-mode account for integration testing — names, amounts, and
  usage caps are round numbers with zero cost analysis or pricing-
  strategy behind them, not real decisions. This phase's actual billing
  work is: (1) build the Checkout Session + webhook + Customer Portal
  code against the placeholder Price IDs (`stripe_price_id_starter`/
  `_pro`/`_studio` outputs), (2) separately, do real cost/pricing
  analysis and replace the placeholder Products before charging anyone
  for real — treat these as two different tasks, not one.
- **Processing add-on packs — designed 2026-07-19, not yet built.** Lets
  a tenant buy extra processing capacity for the current period instead
  of upgrading tiers. Full design in `PLAN.md`'s "Billing: tier add-ons"
  section: one-time (not recurring) Checkout purchase, a new
  `addon_purchases` table in `packages/db`, quota computed from tier cap
  - purchased add-on units − `SourceVideo` count for the period. Depends
    on: (a) the Checkout/webhook code from the item above existing first,
    (b) `scenestealer-infra`'s `stripe.tf` gaining a placeholder add-on
    Product/Price the same way the tiers did. Pack size and price are
    deferred pending cost analysis, same as tier pricing — don't invent
    numbers when building this, wire the mechanism against another
    placeholder.

## 📌 Accepted gaps today, named explicitly

- **CI is basic across all three code repos** — typecheck/lint/format/build
  (+ test where applicable) on every PR, no SHA-pinning/Trivy/gitleaks yet.
  Verified for real, not just written: `pnpm install` (generated a real
  `pnpm-lock.yaml`, now committed) and `pnpm typecheck` both pass clean
  across all four `scenestealer-app` packages. _Revisit_: before the first
  real external contributor, or once Phase 2 code actually needs a
  stronger merge gate.
- **BSL 1.1 `LICENSE` text needs a legal read**, specifically the
  "Covenants of Licensor" clause's GPL-compatibility requirement on the
  Change License choice (Apache-2.0) — reproduced from the canonical
  template but not independently verified against a lawyer. _Revisit_:
  before this license is truly load-bearing (i.e., before any real
  external usage/contribution happens under it).
- **`apps/worker`'s Dockerfile is written to spec but not build-verified.**
  The TS build it depends on passes (`pnpm --filter @scenestealer/worker
build`); the actual `docker build -t scenestealer-worker apps/worker`
  was attempted and could not complete in this environment (no Docker
  daemon running) — genuinely unverified, not just "probably fine."
  _Revisit_: before Phase 2 relies on this image for real.
- **No live external accounts** (Clerk, Stripe, Neon, Cloudflare, Fly.io,
  Groq, Anthropic) — every `.env.example` documents what's needed;
  creating the accounts themselves is a manual, human step. _Revisit_:
  immediately, this blocks all of Phase 2 onward.

## How to use this document

When picking up the next phase, work it in order — this is a build
sequence, not a menu. When an item completes, mark it done **in place**
within its phase (don't relocate to Phase 0/1). If an item is later found
to be unnecessary or superseded, strike it through with a note and move
its full context to `HISTORY.md` (not created yet — add it the first time
something is actually retired) rather than deleting it.

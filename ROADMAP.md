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
- **Environment finding, not a code bug**: both `npx <tool>` and a
  `pnpm run`-invoked script hung indefinitely (near-zero CPU, genuinely
  blocked, not slow) for `eslint` specifically in this session, while
  the identical `tsc`/`drizzle-kit` commands only needed `< /dev/null`
  to unstick.
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

## ✅ Phase 2 (partial) — Done (2026-07-20): Clerk

- **Real Clerk application created** (`SceneStealer`, Email + Google
  sign-in), **Organizations enabled** — verified two ways before writing
  keys anywhere: `GET /v1/organizations` succeeded (Clerk's API errors
  outright if Organizations isn't enabled for the instance, so success
  here is real confirmation, not just "the key works"), and a plain
  `GET /v1/instance` call for good measure. Publishable + secret keys
  wired into `apps/web/.env.local` and `apps/api/.dev.vars` (both
  gitignored, neither committed).

**`next dev`/`next build` hang — root-caused and fixed.** Two distinct bugs
were involved, found in sequence:

1. **Workspace-root misinference** (real, but not the whole story): with no
   `outputFileTracingRoot` set, Next.js walks up from `apps/web` looking for
   a lockfile to infer the monorepo root — and SceneStealer's sibling repos
   (`scenestealer-connectors`, `-pipeline`, `-infra`) each carry their own,
   so the walk went past this repo's actual root. The user reproduced this
   directly in their own terminal and got a concrete error instead of a
   silent hang: `EPERM: operation not permitted, scandir
   '/Users/scarlettb/.Trash'` (TCC-protected on macOS). Fixed by setting
   `outputFileTracingRoot: path.join(__dirname, "../..")` in
   `apps/web/next.config.ts`. **This fix alone did not resolve the hang** —
   confirmed by reproducing the build directly (not just trusting the fix):
   it still stalled at "Creating an optimized production build" with the
   config value verified correct via a temporary debug print (so it wasn't
   a case of the config silently not loading).
2. **A genuine upstream Next.js regression**, found by actually inspecting
   the stuck process rather than guessing further: `sample <pid> 3` showed
   every thread — including the Rust `tokio-runtime-worker` threads inside
   `next-swc`'s native binary — parked in `kevent`/`__psynch_cvwait` with
   about 1ms of real CPU time across the full 3-second sample. That's a
   genuine deadlock in the native output-file-tracing engine, not a slow
   directory scan. Ruled out a corrupted local install first (`pnpm install
   --force`, full re-link from the store — hang persisted, so not cache
   corruption) before treating it as version-specific and testing an older
   Next release directly: **Next 15.2.3 builds and starts `next dev`
   cleanly (`Ready in 1732ms`); the `^15.1.3` range had resolved to 15.5.20,
   which reproducibly deadlocks.** Something regressed in Next's tracing
   engine between those two versions for this pnpm-monorepo shape. Fixed by
   pinning `apps/web/package.json`'s `next` dependency to the exact string
   `"15.2.3"` (no caret) so a future `pnpm install` can't silently re-resolve
   back into the broken range, and reinstalling to lock that into
   `pnpm-lock.yaml`. `eslint-config-next` was left at `^15.1.3` —
   unaffected, still resolves fine.

**Verified working, not just "build completed"**: `next dev` started
(`Ready in 1732ms`), the dashboard shell loaded in a real browser at
`localhost:3000` (title "SceneStealer", the Phase 1 scaffold text), and the
browser console showed Clerk initializing successfully with only the
expected "loaded with development keys" warning — no errors. `next build`
and `tsc --noEmit` both pass clean on the pinned version.

_Revisit_: watch for a Next.js 15.x patch release that fixes this
tracing-engine deadlock upstream (bisecting the exact regressing version
between 15.2.3 and 15.5.20 wasn't done — 15.2.3 was chosen because it's the
lowest version satisfying `@clerk/nextjs`'s peer range of `^15.2.3`, not
because it's necessarily the newest working version), then re-test before
unpinning.

- **Closed (2026-07-20): `apps/web`'s upload UI.** `middleware.ts` runs
  `clerkMiddleware()` (matcher copied from Clerk's current official Next.js
  15 guidance, verified via their docs rather than assumed — Next 16 uses a
  differently-named `proxy.ts` instead, doesn't apply here). `app/page.tsx`
  is now a real Server Component: `<SignedOut>` shows `<SignIn />`;
  `<SignedIn>` shows an `<OrganizationSwitcher hidePersonal />` +
  `<UserButton />` header, then either `<CreateOrganization />` (no active
  org yet) or the new `app/upload-panel.tsx` Client Component (active org
  present). The upload panel drag-and-drops or file-picks a video, calls
  `apps/api`'s `/uploads/presign` with the Clerk session as a Bearer token
  (via `useAuth().getToken()`), PUTs straight to the returned R2 URL, then
  calls `/uploads/complete` — exercising the real `requireTenant` auth path
  built earlier this session, not a mocked one.

  **New wiring this needed, not anticipated until now**: `apps/api` had no
  CORS handling at all — a browser calling it cross-origin (different port
  in dev, different subdomain in prod) with an `Authorization` header
  triggers a preflight `OPTIONS` request that Hono doesn't handle by
  default. Added `hono/cors` as the very first middleware (ahead of
  `clerkMiddleware()`, so preflight requests short-circuit before hitting
  auth logic at all), with `origin` as a per-request callback reading
  `c.env.WEB_ORIGIN` — same Workers-env-isn't-available-at-setup-time
  constraint already worked around for Clerk's own middleware. New
  `WEB_ORIGIN` var: `http://localhost:3000` in `.dev.vars`,
  `https://scenestealer.app` in `wrangler.toml`'s `[vars]` (non-secret).

  **Verified, with an honest limit on how far**: loaded `localhost:3000` in
  a real browser against both dev servers running together — signed-out
  state renders Clerk's actual `<SignIn>` form correctly with a clean
  console (only the expected dev-key warning). Typechecked and linted
  clean across both apps. **Did not** sign in and exercise the
  signed-in/upload path end-to-end — that needs a real account, and
  creating one isn't something to do without you; the code path is
  typechecked and reuses the already-independently-verified
  presign/complete/requireTenant backend, but hasn't been clicked through
  live. Try it yourself with `pnpm dev` and a real sign-in when you get a
  chance — flag anything that doesn't work as expected.

- **Closed (2026-07-20): the `apps/api/src/routes/uploads.ts` security
  gap.** `tenantId` is no longer accepted from the request body at all —
  `apps/api/src/auth.ts`'s `requireTenant` middleware (applied to every
  `/uploads/*` route) verifies the Clerk session via `@clerk/hono`'s
  `clerkMiddleware()`/`getAuth()`, then looks up the internal `tenants.id`
  by the session's `orgId` against `tenants.clerkOrgId`, and only that
  server-derived value is ever written to the DB. Chose `@clerk/hono` over
  `@hono/clerk-auth`, which is now deprecated in favor of it (visible
  directly in that package's own source as a runtime deprecation warning).
  Verified against a live `wrangler dev` instance, not just typechecked:
  `/healthz` stays public (200), `/uploads/presign` with no `Authorization`
  header and with a garbage bearer token both correctly 401 with "Sign-in
  with an active organization is required" — confirming the middleware
  fails closed rather than silently letting requests through.
  **New gap this surfaced**: nothing currently provisions a `tenants` row
  when a Clerk Organization is created, so even a fully valid session for
  a brand-new org will 403 with "No tenant provisioned for this
  organization" until one exists. Needs an `organization.created` Clerk
  webhook — see below, now closed.

- **Closed (2026-07-20): `organization.created` Clerk webhook.** New
  `apps/api/src/routes/webhooks.ts`, mounted at `POST /webhooks/clerk`.
  Verifies the Svix signature via `@clerk/hono/webhooks`'s
  `verifyWebhook(c, { signingSecret })` — had to pass `signingSecret`
  explicitly rather than relying on its documented env-var fallback,
  because that fallback reads `CLERK_WEBHOOK_SIGNING_SECRET` through
  `@clerk/shared`'s Node-style `getEnvVariable` (effectively
  `process.env`), which doesn't exist in Cloudflare Workers — found by
  reading the installed package's actual source rather than trusting the
  JSDoc, not by trial and error. On `organization.created`, inserts a
  `tenants` row keyed by `clerkOrgId`/`name` from the event payload, with
  `onConflictDoNothing({ target: tenants.clerkOrgId })` for idempotency
  against Svix's at-least-once delivery.

  **Verified for real, against a live `wrangler dev` instance and the
  actual Neon database** — not just typechecked: wrote a throwaway script
  using the same `standardwebhooks` package Clerk's SDK uses internally to
  sign a synthetic `organization.created` payload with a matching test
  secret, POSTed it, and confirmed a real `tenants` row landed in Neon
  with the right `clerk_org_id`/`name` (queried directly via
  `@neondatabase/serverless`, since this environment has no `psql`).
  Replayed the identical event a second time and confirmed still exactly
  one row — the `onConflictDoNothing` idempotency guard works, not just
  compiles. Cleaned up the synthetic row afterward. One real bug caught
  during this: the first signed payload failed verification with
  "Message timestamp too old" — not a code bug, just `standardwebhooks`'
  timestamp-freshness check rejecting a payload signed several tool-calls
  earlier; resolved by signing and POSTing in the same step.

  **Still a manual/pending step, same shape as the Clerk CLI note above**:
  `CLERK_WEBHOOK_SIGNING_SECRET` in `.dev.vars` right now is a locally
  generated synthetic secret, not one issued by Clerk — real webhook
  _registration_ (Clerk Dashboard → Webhooks → Add Endpoint, or
  eventually the Clerk CLI) needs a public HTTPS URL for `apps/api`, which
  doesn't exist until its first real deploy. Swap in the real secret via
  `wrangler secret put CLERK_WEBHOOK_SIGNING_SECRET` at that point.
- Stand up rclone; register an OAuth app for Google Drive first; implement
  `RcloneStorageProvider` in `scenestealer-connectors`.
- Then Dropbox, OneDrive/SharePoint, Box (OAuth-consent group); then S3,
  Azure Blob, GCS (credential-based group). _Genuinely situational within
  this phase_: the credential-based group can slip later if no early
  customer needs it — not blocking the rest of the build.

## ✅ Phase 3 — Done (2026-08-02): First real publish loop proven end-to-end

- **Done (2026-08-02): real `PostizPublishProvider.publish()` call
  produced an actual published YouTube video** — polled `getStatus()`
  until Postiz's own `Post.state` reached `PUBLISHED`, then confirmed a
  real, live `releaseURL` came back (not just a "scheduled" response).
  This is the core Phase 3 goal, now proven, not assumed. Two real bugs
  found and fixed getting here — `UPLOAD_DIRECTORY` path mismatch with
  nginx's hardcoded `/uploads/` alias, and a still-unexplained pattern
  where the backend or orchestrator can hang silently post-deploy (fixed
  each time with a plain `machine restart`) — full writeup in
  `scenestealer-infra`'s ROADMAP.md Phase 3, Fifth incident.
- **Done (2026-07-20): self-hosted Postiz deployed** to
  `https://scenestealer-postiz.fly.dev` — `fly.toml` lives in this repo's
  new `postiz/` directory (not `scenestealer-infra`, matching that repo's
  own stated Fly.io convention). Verified live, not just "deploy
  succeeded": real HTTP response with `<title>Postiz Register</title>`,
  and all ~45 expected Prisma tables confirmed present in its dedicated
  Neon database via a direct `information_schema.tables` query. Full
  writeup — the Redis/storage/volume decisions and the real OOM bug hit
  and fixed along the way — is in `scenestealer-infra`'s ROADMAP.md Phase
  3, since that's where the underlying infra (Neon project, Fly Redis)
  was provisioned.
- **Done and already retired (both 2026-07-21):
  `scenestealer-postiz-db-keepalive`** — an interim always-on Fly Machine
  that pinged the Postiz Neon database every 3 minutes to stop free-tier
  auto-suspend from crashing Postiz's backend. Replaced same day by the
  real fix: Neon org upgraded to the Launch plan and auto-suspend
  disabled outright on the Postiz compute (had to be applied via Neon's
  API directly — the Terraform provider silently failed to apply it, a
  real bug caught by testing actual suspend behavior). Fly app destroyed,
  directory removed. Full incident writeup in `scenestealer-infra`'s
  ROADMAP.md Phase 3.
- **Done (2026-07-20): `PostizPublishProvider` implemented** in
  `scenestealer-connectors` (`src/publish/postiz-provider.ts`) — calls
  Postiz's public API directly (`/public/v1/upload-from-url` to hand off
  the R2-hosted clip, `/public/v1/posts` to create it, `GET /public/v1/posts`
  date-range list to poll status, since Postiz has no single-post-by-ID
  endpoint). Request/response shapes and the per-platform `settings`
  object (YouTube's required `title`/`type`, Instagram's required
  `post_type`) came from reading Postiz's actual source on GitHub via
  `gh api`/`gh search code` — its own public API docs don't fully cover
  the create-post response or these settings shapes, a gap the Postiz
  maintainers themselves acknowledge in
  [issue #717](https://github.com/gitroomhq/postiz-app/issues/717).
  This also surfaced a real, pre-existing gap in `PublishRequest` itself
  (`scenestealer-connectors`' `publish/types.ts`): `caption` alone can't
  express YouTube's required title/visibility or Instagram's required
  post-type, so those became new optional `youtube`/`instagram` fields —
  safe to add now since nothing consumes this interface yet.
  Covered by a real test suite (13 cases, mocking `fetch`) that caught an
  actual bug before it shipped: settings validation ran _after_ the
  media-upload network call instead of before, so invalid input still
  triggered an upload first. Fixed and re-verified green. See
  `scenestealer-connectors`' own README.md Status section for more.
- **Done (2026-08-02): Postiz moved to `https://postiz.scenestealer.app`**,
  off the raw `scenestealer-postiz.fly.dev` subdomain — root cause of a
  multi-day "sign in but still land on the sign-in page" saga: `fly.dev`
  is on the Public Suffix List's private-domains section, and Postiz's
  own cookie-domain helper (`tldts.parse()` without
  `allowPrivateDomains: true`) scoped every auth cookie to the bare
  `.fly.dev` suffix, which every browser silently rejects. Verified fixed
  with a direct `curl` login test (`Set-Cookie: ...Domain=.scenestealer.app`)
  and a real user login on the new domain. Full incident writeup —
  including a separate `invalid_grant` Google OAuth bug that's still not
  fully root-caused — in `scenestealer-infra`'s ROADMAP.md Phase 3,
  Fourth incident.
- **Done (2026-08-02): first real YouTube channel connected to Postiz** —
  `Integration` row confirmed in the DB (`providerIdentifier: "youtube"`,
  `disabled: false`). `YOUTUBE_CLIENT_ID`/`YOUTUBE_CLIENT_SECRET` were
  already live as Fly secrets (done 2026-07-21), but three _additional_
  manual, non-scriptable steps in Google Cloud Console turned out to be
  required before a real channel-connect actually worked end-to-end — a
  human has to do each of these in Google's console, nothing here can
  automate them:
  1. **Authorized redirect URI must match the live frontend domain
     exactly.** Broke when Postiz moved to `postiz.scenestealer.app` (see
     `scenestealer-infra`'s ROADMAP.md Phase 3, Fourth incident) —
     `https://postiz.scenestealer.app/integrations/social/youtube` had to
     be added under the OAuth client's Authorized redirect URIs.
  2. **OAuth consent screen is deliberately kept in "Testing" status**
     (avoids the full Google verification review the sensitive
     `.../auth/youtube` scope would otherwise require — days-to-weeks,
     a near-identical gate to Meta App Review). Testing mode only allows
     explicitly-approved accounts: every Google account that will connect
     a channel or sign in via Google must be added under **OAuth consent
     screen → Test users** first, or the consent flow fails with `Error
     403: access_denied`.
  3. **YouTube Data API v3 must be manually enabled** on the Cloud
     project backing the OAuth client — creating the OAuth client/
     credentials does _not_ enable the API itself. Without this, consent
     succeeds but Postiz's own channel lookup
     (`youtube.provider.ts`'s `channels.list`) fails with a `403
     accessNotConfigured` from Google, which surfaces in Postiz's UI as
     nothing more than "channel not found" — root-caused by reading the
     real error out of `backend-error.log` via `flyctl ssh console`
     rather than guessing from the vague UI symptom. Enable at
     `https://console.developers.google.com/apis/api/youtube.googleapis.com/overview?project=401866276467`
     (a few minutes to propagate after enabling).

## ✅ Phase 4 — Done (2026-08-06): AI auto-clip + manual editor

- **Done: `GroqTranscriber`, `PySceneDetectDetector.detectScenes`,
  `detectAudioEnergyEvents`, `ClaudeHighlightScorer` implemented** in
  `scenestealer-pipeline`, replacing the Phase 1 "not implemented"
  scaffolds. 18 vitest tests (`fetch`/`child_process.execFile` mocked).
  Full writeup in that repo's own README.md Status section.
- **Done: scrubbing/trim editor UI** in `apps/web`
  (`app/videos/[id]/page.tsx` + `clip-editor.tsx`) — wavesurfer.js bound
  directly to the `<video>` element (one network fetch serves both
  playback and waveform decode, not two), one draggable/resizable region
  per AI-suggested clip, Accept/Reject buttons, edits saved via a new
  `PATCH /clips/:id` endpoint in `apps/api`.
- **New in `apps/api`**: `GET /videos/:id/playback-url` (presigned R2 GET
  — the browser can't sign R2 requests itself, only the Worker holds the
  credentials) and `PATCH /clips/:id` (ownership checked through the
  parent `source_videos.tenant_id`, since `clips` doesn't carry a
  `tenantId` column of its own). Home page now lists a tenant's uploaded
  videos linking into the editor.
- **Done (2026-08-24): the worker-job wiring** that was originally left
  open here — `apps/worker`'s `analyze` job now genuinely invokes all
  four pipeline functions in sequence against a real downloaded video
  and writes suggested `Clip` rows; `apps/api`'s new
  `POST /videos/:id/analyze` proxies to it. Verified for real multiple
  times over: locally, against the deployed Fly container directly,
  and through a real signed-in browser session accepting/rejecting the
  resulting clips. Full writeup and the real bugs it surfaced (in this
  repo and both `scenestealer-pipeline`/`scenestealer-connectors`) are
  in that day's commits — see the Accepted Gaps section below for the
  Groq file-size follow-up it also surfaced.
- Manual "draw a fully new clip" (vs. only adjusting AI suggestions) is
  still not implemented — the editor only edits/accepts/rejects clips
  that already exist as rows.

## ✅ Phase 5 (partial) — Done (2026-08-24): `FfmpegRenderer` + render loop

- **Done: `FfmpegRenderer`** in `scenestealer-pipeline`, replacing the
  Phase 1 "not implemented" scaffold — trims a clip's in/out points,
  center-crops to 9:16 for `instagram-reels` (h264, yuv420p, closed
  GOP), leaves `youtube-full`'s source aspect untouched, validates
  clip duration against the target platform spec before ever touching
  ffmpeg. 5 new vitest tests (`child_process.execFile` mocked, matching
  the package's established pattern).
- **Done: the render job wiring**, same shape as Phase 4's `analyze`
  job — `apps/worker`'s new `runRender(clipId)` downloads the source
  video from R2, calls `FfmpegRenderer`, uploads the output to R2
  under `<tenantId>/renders/<clipId>.mp4`, and flips the clip to
  `status: "ready"` with `renderedR2Key` set (or back to `"accepted"`
  on failure — never left stuck on `"rendering"`). `apps/api` gained
  `POST /clips/:id/render` (proxies to the worker, same shape as
  `POST /videos/:id/analyze`) and `GET /clips/:id/playback-url`
  (presigned R2 GET for the rendered file, same shape as the existing
  source-video playback-url route). `apps/web`'s clip editor now shows
  a "Render" button on accepted clips (a separate, explicit action —
  not auto-triggered by Accept, to avoid several concurrent ffmpeg
  encodes contending on the worker's single small Fly instance) and a
  "Get rendered clip" / download link once one's ready. Verified for
  real: local CLI run against a real accepted clip, downloaded the
  resulting R2 object and confirmed via `ffprobe` it's actually
  2160x3840 (9:16) h264/yuv420p/aac, then redeployed both
  `scenestealer-worker` (Fly) and `apps/api` (Workers) and smoke-tested
  the live `/render` route's auth gate.
- **Deferred to a beta-phase feature**: `smartReframe` (face-tracked
  vertical reframe, vs. this pass's plain center-crop) — requesting it
  throws explicitly rather than silently downgrading to a worse result.
  Real face detection/tracking is a meaningfully bigger undertaking
  than the mechanical encode/crop implemented here.
- **Still open**: templating engine (caption variables) in
  `apps/web`/`apps/api` — the rest of Phase 5.

## 🗓 Phase 6 — Resumed (2026-08-31): Meta

- **Resumed (2026-08-31)**: SceneStealer is now a registered LLC —
  the entity blocker noted below (2026-08-27) is cleared. Meta
  Business Verification can now use real business-name documents in
  SceneStealer's own legal name. Everything below was already ready
  to resume the moment this happened.
- **Submit Meta App Review** — should actually start in parallel with
  Phase 2, not wait until here; it's the single longest lead-time
  dependency in the whole project (2-4 weeks per submission).
  - **Done (2026-08-25): the hard prerequisite Meta checks for before
    letting an app request advanced permissions** — a live, linked
    Privacy Policy and Terms of Service. Added `apps/web/app/privacy/`
    and `apps/web/app/terms/`, footer-linked from every page. Both
    reflect this project's actual architecture (real data flows, real
    third-party processors, a dedicated section on exactly what
    Instagram/Facebook data is requested and why — Meta reviewers
    check that section specifically). **Needs a real legal read**
    before fully relied on, same as this project's software license
    (see the BSL entry below); Terms' "Governing law" section is a
    placeholder pending that.
  - **Done (2026-08-27)**: `support@scenestealer.app` — the contact
    address both new pages use — is a live, working mailbox; Migadu's
    own DNS "Check Configuration" pass has also confirmed the MX/DKIM/
    SPF/DMARC records in `scenestealer-infra` are correct. Both were
    the last "reviewers can and do check this" prerequisites blocking
    an actual submission, on top of the LLC itself.
  - **Exact requirements confirmed against Postiz's own docs**
    (`docs.postiz.com/providers/facebook`,
    `docs.postiz.com/providers/instagram`) — Postiz needs
    `FACEBOOK_APP_ID`/`FACEBOOK_APP_SECRET` as Fly secrets on
    `scenestealer-postiz` (the "Facebook Business" flow covers both
    Facebook Pages and Instagram-via-linked-Business-account; no
    separate Instagram app needed). Redirect URIs to register in the
    Meta app's Facebook Login product:
    `https://postiz.scenestealer.app/integrations/social/facebook` and
    `https://postiz.scenestealer.app/integrations/social/instagram`.
    Permissions to eventually request App Review for: `pages_show_list`,
    `pages_manage_posts`, `pages_manage_engagement`,
    `pages_read_engagement`, `read_insights`, `instagram_basic`,
    `instagram_content_publish`, `instagram_manage_comments`,
    `instagram_manage_insights`, `business_management`. (PLAN.md's
    infra-choices table names the permission
    `instagram_business_content_publish` — Meta has renamed Instagram
    Graph API permissions before; double-check the current exact name
    in the Meta dashboard at submission time rather than trusting
    either doc.)
  - **Still open, needs the account holder (not scriptable)**: create/
    confirm a Meta Business Manager account, a Facebook Page for
    SceneStealer, and an Instagram Professional account linked to that
    Page; create the Meta developer app itself and add the redirect
    URIs above; keep the app in Development mode with test users added
    while assembling the review submission (mirrors the YouTube
    OAuth-consent "Testing" status workaround below); record the
    required demo screencast showing the actual accept-clip ->
    render -> publish flow; then submit.
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

- **CI hardened across all four repos (2026-08-08)**: SHA-pinned actions,
  `docs.yml`/`actionlint.yml`, Trivy (`security-scan`) and gitleaks
  (`secret-scan`) added everywhere; `.pre-commit-config.yaml` mirrors it
  all locally. Verified live, not just written — every new workflow ran
  green on GitHub Actions after pushing.
- **Known, tracked risk: `next` is pinned to 15.4.11**, the actual
  ceiling `@cloudflare/next-on-pages@1.13.16` (latest release as of
  2026-08-20) can build — bisected directly against the real
  `pages:build` pipeline: every version from 15.2.8 through 15.4.11
  builds cleanly, 15.5.0 breaks immediately (`/_not-found` not
  configured for the Edge Runtime) and stays broken through at least
  15.5.15, so the ceiling is the 15.4→15.5 boundary itself, not
  next-on-pages's own declared `<=15.5.2` peer range (also broken in
  practice). Originally discovered as one CRITICAL CVE
  (CVE-2025-55182, pre-auth RCE via React Server Components request
  deserialization) plus ten HIGH CVEs (SSRF, DoS) while `next` was
  still on 15.2.3; getting to 15.4.11 (forced by an unrelated Clerk
  v7 bump requiring `next>=15.2.8`) already cleared the CRITICAL one
  and one HIGH, both fixed at 15.2.6/15.2.7. The remaining ten HIGH
  CVEs (nine originally found, plus CVE-2026-44574 — authorization
  bypass via crafted query — first caught 2026-08-25 when
  security-scan actually ran end-to-end against a PR again; full list
  and reasoning in `scenestealer-app/.trivyignore`) all have fix
  floors at 15.5.x+, unreachable within the working 15.4.x line. This
  app defines no `"use server"` Server Actions of its own, reducing
  the most direct exploitation path for what's left. _Revisit_: the
  moment next-on-pages ships a release that supports 15.5.x+, or
  sooner if real user traffic/data volume
  changes the risk calculus.
- **Fixed (2026-08-24): `apps/web` had no CI/CD deploy pipeline at
  all**, despite `scenestealer-infra`'s `cloudflare.tf` comment
  claiming "the site repo's CI builds and pushes via
  cloudflare/wrangler-action once checks pass" — `checks.yml` only ran
  `on: pull_request` (typecheck/lint/format/build, no deploy step),
  and no other workflow file deployed anything. Concretely surfaced
  when a real push to `main` (the render loop work) didn't show up
  live at scenestealer.app — the site had been deployed manually at
  some earlier point and simply never redeployed since. Fixed for real
  with a new `deploy.yml` (`on: push: branches: [main]`) that deploys
  all three targets — `apps/web` (Pages), `apps/api` (Workers),
  `apps/worker` (Fly) — each behind a shared `verify` job, using the
  `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID`/`FLY_API_TOKEN` repo
  secrets that already existed (provisioned but unused until now). See
  `.github/workflows/README.md` for the full per-job breakdown.
- **BSL 1.1 `LICENSE` text needs a legal read**, specifically the
  "Covenants of Licensor" clause's GPL-compatibility requirement on the
  Change License choice (Apache-2.0) — reproduced from the canonical
  template but not independently verified against a lawyer. _Revisit_:
  before this license is truly load-bearing (i.e., before any real
  external usage/contribution happens under it).
- **`apps/worker`'s Dockerfile is now build-verified and deployed for
  real** (2026-08-24) — three real bugs found and fixed doing so
  (missing `unzip`/`git` in the base image, `workspace:*` not
  resolvable by plain `npm install`); see that commit for the full
  writeup. Deployed as a small always-on-when-warm Fly app
  (`scenestealer-worker.fly.dev`, scaled to zero via auto-stop/start)
  exposing one HTTP route (`/analyze`) that `apps/api` proxies to —
  still the smaller first cut described in Phase 4's writeup below,
  not PLAN.md's eventual Cloudflare Queue -> Fly Machines API
  architecture.
- **Live external accounts**: Clerk, Neon, Cloudflare, Fly.io, Groq,
  and Anthropic are all live and in real use as of Phase 4. Stripe is
  configured (test-mode placeholder tiers, see Phase 7) but no billing
  code exists yet to actually call it.
- **Known, accepted limit: Groq's free-tier 25MB file-size cap on the
  transcription endpoint** (100MB on their paid dev tier) caps how
  long a recording `runAnalyze` can transcribe — confirmed for real,
  a 30.5MB raw video 413'd. Extracting audio-only first (64kbps mono
  mp3, already done — see `analyze.ts`) buys real headroom: ~55
  minutes of audio fits in 25MB, ~3.6 hours in 100MB. Since this
  product's actual target (full live-theater show recordings) can
  exceed either ceiling, the real fix is chunking long recordings into
  segments and stitching the timestamped transcript back together —
  deliberately deferred to a beta-phase feature, not needed while
  still developing against short test clips. Free tier is fine for
  now. _Revisit_: before onboarding a real tenant with real
  show-length recordings, or sooner if a 413 shows up again.

## How to use this document

When picking up the next phase, work it in order — this is a build
sequence, not a menu. When an item completes, mark it done **in place**
within its phase (don't relocate to Phase 0/1). If an item is later found
to be unnecessary or superseded, strike it through with a note and move
its full context to `HISTORY.md` (not created yet — add it the first time
something is actually retired) rather than deleting it.

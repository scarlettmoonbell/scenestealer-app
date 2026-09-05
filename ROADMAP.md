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
- **Done (2026-09-01): Meta Business Verification** — completed in
  Meta Business Manager against SceneStealer's real LLC documents.
  Clears the way for advanced access on the permissions listed below;
  what's left is the account-holder setup, screencast, and reviewer
  instructions noted further down.
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
  - **Ground truth (2026-09-02), read straight off Postiz's live
    generated OAuth URLs (`GET /social/facebook` and `/social/instagram`
    against the real deployed instance), not docs**: facebook scope is
    `pages_show_list,business_management,pages_manage_posts,
    pages_manage_engagement,pages_read_engagement,read_insights`;
    instagram scope is `instagram_basic,pages_show_list,
    pages_read_engagement,business_management,instagram_content_publish,
    instagram_manage_comments,instagram_manage_insights`. Union is 10
    unique permissions — **resolves** the naming question below:
    Postiz actually requests `instagram_content_publish`, not
    PLAN.md's `instagram_business_content_publish`.
  - **One Meta Developer App, not two.** Postiz only has one
    `FACEBOOK_APP_ID`/`FACEBOOK_APP_SECRET` slot — there's no way to
    wire in a second app even if one existed — and nothing else in this
    codebase uses Facebook login (Clerk auth here doesn't touch it), so
    a single app covering both the "Manage everything on your Page" and
    "Manage messaging & content on Instagram" use cases is correct and
    sufficient. (Two apps — SceneStealerAuth, SceneStealerContent — got
    created while exploring the Meta dashboard's setup wizard;
    SceneStealerContent already has the right use cases and is the one
    to keep.)
  - **Still open, needs the account holder (not scriptable)**: create/
    confirm a Meta Business Manager account, a Facebook Page for
    SceneStealer, and an Instagram Professional account linked to that
    Page; create the Meta developer app itself and add the redirect
    URIs above; keep the app in Development mode with test users added
    while assembling the review submission (mirrors the YouTube
    OAuth-consent "Testing" status workaround below); record the
    required demo screencast showing the actual accept-clip ->
    render -> publish flow; then submit.
  - **Confirmed live (2026-09-02)**: clicking "Connect Facebook" in
    `/connections` now reaches Facebook's real OAuth screen (Postiz
    secrets were the earlier blocker — see below) but Facebook itself
    rejects it: `Invalid Scopes: pages_show_list, business_management,
    pages_manage_posts, pages_manage_engagement, pages_read_engagement,
    read_insights`. This is exactly the gap named above, now confirmed
    firsthand rather than assumed — the Meta Developer App either
    doesn't exist yet or wasn't set up with the **Facebook Login for
    Business** product (plain Facebook Login doesn't expose these
    scopes at all, App Review or not). Fixing this needs the
    account-holder steps above; adding yourself as a Developer/Tester
    on that Meta app once it exists lets these permissions work
    immediately in Development mode without waiting on App Review.
  - **Fixed (2026-09-02): stale `POSTIZ_API_KEY`/`POSTIZ_API_URL`
    secrets on the production `apps/api` Worker** — every connect
    attempt (YouTube included) was failing with `Postiz GET
    /social/{platform} failed: 404`, confirmed via `wrangler tail`
    against a real click-through, even though the same URL/key worked
    calling Postiz directly. Re-synced both secrets via `wrangler
    secret put` to the values already known-good in `apps/api/.dev.vars`;
    YouTube's connect flow now succeeds end-to-end. Root cause of the
    drift (a stale value from before some earlier rotation, most
    likely) wasn't tracked down — worth a second look if it recurs.
- **Done (2026-09-02): the whole connect → template → publish loop,
  built and shipped as four sequential PRs** (#42–#45). Everything
  below was verified against the real, deployed Postiz instance
  (`https://postiz.scenestealer.app`), not just its docs — several real
  facts turned out to differ from what the docs alone said:
  - **Real API facts confirmed live, not assumed**: the working base
    URL is `https://postiz.scenestealer.app/api/public/v1` (the bare
    `/public/v1` path from the docs 307-redirects to Postiz's own
    frontend login, it isn't the API route); auth is the raw API key in
    `Authorization`, no `Bearer` prefix; the integration-settings
    endpoint is `GET /integration-settings/{id}` (not
    `/integrations/:id/settings` as the docs page implied) and returns
    a real per-platform `required` fields list — confirmed for the
    existing YouTube connection: it needs a video `title` (2-100 chars)
    and a `public`/`private`/`unlisted` `type`, **separate from** the
    caption, something the create-post docs alone didn't show.
  - **The open attribution question is resolved**: Postiz's connect
    endpoint (`GET /social/{integration}` → `{ url }`) accepts no
    customer/state param and has no callback `apps/api` can intercept —
    confirmed for real, not assumed. So tenant attribution is a
    before/after diff against `GET /integrations`, snapshotted when the
    connect flow starts and diffed once the tenant's done connecting.
    Real tenant isolation stays where it already lived: the
    `socialConnections` table (`tenantId` + `postizIntegrationId`) and
    `apps/api`'s ownership checks, same pattern as every other
    per-tenant resource in this app — Postiz's own "customers" grouping
    feature was never relied on for this.
  - **Built**: `apps/api/src/postiz.ts` (client), `routes/social.ts`
    (connect/finalize/list/settings-proxy/disconnect — disconnect also
    revokes on Postiz's side, matching what the Data Deletion
    Instructions page already promises), `routes/templates.ts` (CRUD,
    `{{video_title}}`/`{{date}}`/`{{organization}}` substitution — the
    three variables actually backed by existing data, `organization`
    read from the active tenant rather than added as new schema), and
    `POST /clips/:id/publish`
    on `routes/clips.ts` (mints a presigned R2 URL for the rendered
    clip, calls Postiz's create-post endpoint, records a `posts` row
    either way). Frontend: `/connections` and `/templates` pages, and a
    schema-driven Publish control on the clip editor — it reads a
    connection's real `GET /integration-settings/:id` and renders one
    input per required field, so it works correctly for whatever
    Instagram/Facebook turn out to need without new code, the same way
    it already works for YouTube's real title+type requirement.
  - **Not yet done**: a real, live test publish. Every piece up through
    minting the presigned URL and calling Postiz is implemented and
    typechecked, but an actual `POST /posts` call would really publish
    to the connected YouTube channel — a real, externally-visible
    action needing a go-ahead, not something to fire off unprompted
    while building. This is the next concrete step, and doubles as the
    real dry run for the Meta App Review demo screencast.
  - Also shipped alongside this: a delete-video action (`DELETE
    /videos/:id`, cascades through clips and their R2 objects, nulls
    rather than drags down any `posts` history) — self-serve cleanup
    that didn't exist anywhere before.
- **Done: richer template variables from video file metadata**
  (`{{duration}}`, `{{recorded_date}}`, `{{venue}}`, `{{city}}`,
  alongside the existing `{{video_title}}`/`{{date}}`/`{{organization}}`).
  `apps/worker`'s `analyze` job now runs `ffprobe` against the
  already-downloaded source video (confirmed for real: ffprobe ships in
  the same Debian `ffmpeg` apt package already in the worker's Docker
  image, no Dockerfile change needed) and writes
  `sourceVideos.recordedAt`/`deviceModel`/`gpsLat`/`gpsLon` — best-effort,
  never fails the analyze job over a missing tag or a geocoding hiccup.
  GPS (from QuickTime's `location.ISO6709` tag, common on phone-recorded
  MOV files) gets reverse-geocoded via **OpenStreetMap Nominatim — a
  deliberate alpha-phase choice, free and no API key, chosen with the
  explicit understanding that a paid provider (Mapbox/Google/OpenCage)
  should be re-evaluated in beta if real tenant volume puts pressure on
  Nominatim's ~1 req/sec usage policy.** Confirmed for real against the
  live Nominatim API before relying on it: the field that flags a
  business/POI is `category` (not `class`, which the initial plan
  assumed) — `venueName` only gets set when `category` is one of
  `amenity`/`shop`/`tourism`/`leisure`/`office`, `cityName` always gets
  the coarse city/town/village breakdown. Never stores or exposes exact
  coordinates or a street address. `{{ai_reason}}` was considered and
  deliberately **not** added — `clips.aiReason` is reviewer shorthand
  (checked the real `ClaudeHighlightScorer` prompt and its own test
  fixture, e.g. `"applause + strong line"`), not written for public
  copy. `{{device}}` shipped, then was deliberately dropped as a
  template variable — not useful for promoting the actual content — but
  `sourceVideos.deviceModel` still gets extracted and stored; only its
  exposure as a caption variable was removed.
- **Done (2026-09-04): Postiz connect-flow auto-close, fixed via a
  Cloudflare Worker reverse-proxy.** Postiz's connect flow is
  UI-forward, not API-only — after authorizing on
  Facebook/Instagram/YouTube's own site, Postiz always routes the
  browser through its own branded UI first (a Page-picker "Configure
  Your Channel" step, then its `/launches` calendar) before control
  ever returns to us. The existing `<a target="_blank">` +
  synchronous second-click `window.open()` workaround's window handle
  still went dead once the tenant was deep in Postiz's own calendar
  UI: `Cross-Origin-Opener-Policy` headers from Facebook/Google's own
  OAuth pages sever the opener/popup relationship, so opener-side
  `.close()` could silently no-op, leaving tenants stuck looking at
  Postiz's calendar with no automatic way back. Considered and
  rejected (unchanged from the original investigation): iframing
  (Facebook/Google both send `X-Frame-Options`/CSP headers refusing to
  be framed — a hard wall, not a timing issue); redirecting Facebook's
  OAuth `redirect_uri` to our own domain instead of Postiz's (would
  mean duplicating `FACEBOOK_APP_SECRET` onto `apps/api` and
  reimplementing the code exchange ourselves, with no documented
  Postiz API for registering an externally-obtained token).

  **Fix**: `apps/postiz-proxy`, a thin Cloudflare Worker
  reverse-proxying `postiz.scenestealer.app` (previously DNS-only
  straight to Fly) that injects a **self-closing** script — not
  reliant on opener-side `.close()` — into the `/launches` response
  via `HTMLRewriter`. Self-close uses a different browser permission
  model than the one that was failing: COOP restricts cross-window
  reference/communication, not a document's own ability to close
  itself, and eligibility tracks "was this window opened via script,"
  which the existing `window.open()` flow already satisfies. Falls
  back to redirecting to `https://scenestealer.app/connections` after
  ~500ms if self-close is refused (e.g. a tenant bookmarked/typed the
  Postiz URL directly). Postiz's own container is completely
  untouched — no fork, fully upgradable.

  **Confirmed empirically, not assumed:**
  - The `added=`/`msg=` connect-success query params never reach
    Postiz's server — `/launches` behaves identically with or without
    them (direct passthrough-parity `curl` checks), confirming it's a
    client-side-routed SPA view. The injected script reads
    `location.search` at execution time rather than gating
    server-side, which this confirms was the right call.
  - Self-close and the fallback redirect both work correctly against a
    real, authenticated session in **Chrome and Safari** (Firefox not
    tested). Safari specifically showed no close-confirmation dialog
    or gesture-timing issue.
  - Postiz's own session cookie (`auth`) is scoped to the
    `.scenestealer.app` apex (its `tldts`-based cookie-domain logic),
    not the exact host — useful for testing (a canary hostname under
    the same apex shares the session automatically), and a reminder
    this is the same class of cookie-domain behavior that already bit
    this hostname once (see `scenestealer-infra`'s `cloudflare-dns.tf`
    incident).
  - **Canary-hostname limitation, not a proxy defect**: a canary
    hostname (`postiz-proxy-test.scenestealer.app`, used for
    pre-cutover verification) can never fully render Postiz's own UI —
    Postiz's frontend bundle calls its API via a hardcoded absolute URL
    (`NEXT_PUBLIC_BACKEND_URL`/`FRONTEND_URL`, fixed to
    `postiz.scenestealer.app` at build time, not derived per-request),
    so any other hostname makes those calls cross-origin and Postiz's
    CORS allow-list rejects them (confirmed via `fetch()`: a
    credentialed request throws `TypeError: Failed to fetch`, while a
    `no-cors` fetch to the same URL completes fine — proving it's a
    CORS rejection, not a real backend/connectivity failure). Inherent
    to self-hosting stock Postiz, not something this Worker introduced.
  - **WebSocket passthrough**: the `/launches` calendar view itself
    does not open a WebSocket connection on load (confirmed by scanning
    every loaded JS chunk for actual `new WebSocket(...)` calls, not
    just the Performance API, which can't see WebSockets at all). One
    genuine on-demand WebSocket code path exists elsewhere in the
    bundle, gated behind a feature not exercised during this
    verification — not yet live-tested, but Cloudflare Workers proxy
    WebSocket upgrades automatically through a plain `fetch()`
    passthrough (exactly what this Worker does for anything outside
    the `/launches` rewrite), so there's no code reason to expect it
    wouldn't work.

  **Rollout**: canary custom domain
  (`postiz-proxy-test.scenestealer.app`, provisioned via
  `apps/postiz-proxy/wrangler.toml`'s own `routes`) verified first,
  then cut over for real in `scenestealer-infra`'s OpenTofu
  (`cloudflare-dns.tf`): destroyed the old DNS-only `postiz_a`/
  `postiz_aaaa` records, created a `cloudflare_workers_custom_domain`
  binding `postiz.scenestealer.app` to the Worker. The canary route was
  later removed entirely (see below) rather than kept as a permanent
  comparison target.

  **Post-cutover fixes (2026-09-05), found via real live connect
  attempts — the above verification, done before cutover, wasn't
  sufficient on its own:**
  - **Canary route removed.** Every `wrangler deploy` was re-syncing it
    against Cloudflare's Workers Routes API, which the
    `CLOUDFLARE_API_TOKEN` GitHub secret (rotated via
    `scenestealer-infra`'s OpenTofu) doesn't have permission for — a
    real CI failure, unrelated to the Worker's own code, which deployed
    fine regardless. The canary already did its job (self-close/
    redirect verified against it); the real binding lives entirely in
    Tofu now (`cloudflare_workers_custom_domain`), the same pattern
    `apps/api` already uses.
  - **The client-side-navigation gap — the actual reason real connects
    still left tenants on Postiz's calendar.** A real connect success
    never reloads the page: Postiz's OAuth callback page
    (`/integrations/social/[provider]`, confirmed against Postiz's own
    source — `ContinueIntegration`'s `navigateOrShow`,
    `apps/frontend/src/components/launches/continue.integration.tsx`)
    transitions to `/launches?added=...` via Next.js's `router.push` —
    client-side History API navigation, no new HTTP request. This
    Worker's `HTMLRewriter` only sees real responses, so it never had a
    chance to inject anything for that transition; the self-close
    script only ever fired for a _directly-loaded_ `/launches?added=...`
    URL (this Worker's own manual pre-cutover verification), never the
    real flow. Fixed by widening the rewrite target to
    `/integrations/social/*` alongside `/launches`, and having the
    injected script patch `history.pushState`/`replaceState` so it
    catches the transition wherever it actually happens.
  - **The real root cause of the visible symptom that followed (two
    Facebook tabs, one left defunct).** Not primarily a double-click
    race, though one existed and was fixed too (a synchronous `useRef`
    guard — a fast double-click on the two-click UI's lingering link
    could fire `window.open()` twice with the identical URL before
    React re-rendered the link away). The actual culprit, found after
    that fix alone didn't resolve it: `apps/web/app/connections/
    page.tsx`'s `window.open()` calls passed `"noreferrer"` as a
    window-features argument. Per MDN, that forces `noopener`
    semantics too, and `noopener` makes `window.open()` return `null`
    **unconditionally, in every modern browser** — not a Safari-specific
    quirk, not COOP, not a probabilistic popup-blocker thing. Verified
    directly with a real physical click (a script-dispatched click
    isn't a trusted gesture and would give a false read):
    `window.open(url, "_blank", "noreferrer")` → `null`; the identical
    call without `"noreferrer"` → a real, controllable `Window`. This
    means the original "COOP breaks opener-side `.close()`" diagnosis
    that kicked off this whole project was only ever partially right —
    this specific handle was broken by `"noreferrer"` unconditionally,
    before COOP ever entered into it. The self-close proxy fix is still
    correct and necessary for popups that navigate through Facebook/
    Google's own pages (third-party origins this app doesn't control),
    just not sufficient by itself.
  - **Connect flow redesigned to a single click**, chasing the above:
    replaced the two-click UI (a button, then a second click on a real
    link — which existed only to keep `window.open()` inside a genuine
    synchronous click, working around the same Safari trusted-gesture
    issue) with opening a blank popup synchronously on the first click
    and redirecting it to the real URL once the connect-URL fetch
    resolves. Same gesture-trust guarantee, no second click, and no
    lingering clickable link for a double-click to land in. The
    two-click UI still exists as a fallback for the rare case the blank
    popup itself gets blocked.
  - **Confirmed live end-to-end, 2026-09-05**: a real Facebook connect
    completes in a single click and lands the tenant back on the
    Connected Accounts view automatically — the actual bug this project
    set out to fix, now genuinely resolved rather than just verified in
    isolation.
  - **Ayrshare flagged as a possible longer-term replacement** if this
    UI-forward friction keeps recurring beyond just the connect screen.
    Confirmed (via its own docs, not assumed): explicitly built for
    embedded multi-tenant SaaS — "no end-user interface... your brand,
    customer portal, and workflow stay yours entirely" — with per-
    tenant JWT-based profile isolation on its Business plan. Caveat:
    account-linking still goes through an Ayrshare-hosted "linking
    page" (inherent to OAuth, not a Postiz-specific flaw), so it
    wouldn't eliminate the redirect-out-and-back step entirely, just
    make the surrounding UI ours instead of the provider's. Not a
    small swap — would mean re-architecting the connect/publish/
    schedule work this phase just built around Postiz's specific API
    shape. Worth a proper eval later, not a snap decision now.

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
- **Usage tiers (Free / Small / Medium / Large) — requested 2026-09-02,
  not yet defined.** Tenant wants tiers named/scoped this way,
  specifically. Note this doesn't match `scenestealer-infra`'s existing
  placeholder tiers above (Starter/Pro/Studio, $29/$79/$199/mo) —
  reconcile naming and figure out whether "Free" is a new zero-cost
  tier or just the trial, as part of the real cost/pricing analysis
  already called for above, not as a separate rename.
- **User profile management page — requested 2026-09-02, not yet
  built.** No page exists today for a tenant to manage their own
  account. This is where moving between billing tiers (via the Stripe
  Customer Portal above) is meant to live once both exist. Scope
  beyond billing (org name/settings, user info, etc.) not yet decided.

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
  exposing one HTTP route (`/analyze`) that `apps/api` dispatches to
  via a queue (see below) — still the smaller first cut described in
  Phase 4's writeup below, not PLAN.md's eventual dynamic-per-job Fly
  Machines API architecture (a fresh Machine spawned per job, rather
  than this one shared always-on-when-warm app).
- **Fixed (2026-09-05): large uploads' analysis hit a Cloudflare edge
  524, unrelated to file size validation.** A 1.24GB file's real
  transcription + AI scoring took longer than apps/api's Custom
  Domain's edge-proxy timeout (~100s, confirmed against Cloudflare's
  own docs — a fixed limit on the browser-facing hop, independent of
  the Workers runtime's own much more generous execution model) to
  respond, since `POST /videos/:id/analyze` awaited the entire Fly job
  synchronously before ever replying. Two "obvious" fixes were checked
  and ruled out as actively unsafe rather than assumed to work:
  `ctx.waitUntil()` has a hard 30-second cap after the response is
  sent (confirmed against Cloudflare's docs) — nowhere near enough for
  a multi-minute job, the promise would just get silently canceled;
  having `apps/worker` respond immediately and keep working in the
  background was ruled out too, since Fly's own docs confirm its
  auto-stop-when-idle is based purely on active connection/traffic
  count with no other signal — the machine could be suspended mid-job
  with no open connection to notice, a silent failure worse than the
  loud one this was fixing.
  **Real fix**: finally wired up the `scenestealer-jobs` Cloudflare
  Queue that `cloudflare-dns.tf` (`scenestealer-infra`) had already
  provisioned back on 2026-07-19 but nothing ever consumed — `POST
  /videos/:id/analyze` now just enqueues a message and returns
  immediately; a queue consumer (same Worker, `apps/api/src/index.ts`)
  runs the actual Fly call and DB status update. A queue consumer
  invocation isn't behind the Custom Domain's edge-proxy path at all,
  and gets a 15-minute wall-time ceiling instead of ~100s — and since
  it does the exact same long synchronous `fetch` to Fly the old
  synchronous code did, the connection to Fly stays open for the whole
  job just like before, so the Fly-autostop risk above never actually
  applies here. `apps/web`'s already-existing status-polling UI
  (`analyze-control.tsx`) needed one real fix alongside this: the
  guard tracking "is this mount's own initiating request still in
  flight" was a ref, not state, so flipping it back to false once the
  fast enqueue call resolved would never actually re-trigger the
  polling effect (refs aren't reactive) — converted to state so
  polling correctly arms itself once the initiating call returns.
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
- **No dev/staging site exists — every `apps/web` change this phase
  ships straight to production against live data, verified (if at
  all) after the fact.** Surfaced repeatedly on 2026-09-05: several
  UI changes (the clip table redesign, table-header styling, the
  centralized Scheduling page) had to ship without ever being seen
  running, because this session's local preview sandbox hit a
  persistent `shell-init: error retrieving current directory: getcwd:
  cannot access parent directories: Operation not permitted` that
  blocked `next dev` outright — typecheck/lint/prettier passing was
  the only signal before merge, and the tenant confirmed the actual
  behavior live afterward each time (real bugs were caught this way
  more than once, e.g. the connect-flow `window.open()` "noreferrer"
  regression). That gap exists independent of any one session's local
  environment being broken, though: there is still no staging
  deployment at all — `deploy.yml` only triggers `on: push: branches:
  [main]`, straight to the real `scenestealer.app`/`scenestealer-api`/
  `scenestealer-worker` targets, with no intermediate environment a
  change could be checked against first. **Not yet built:** a second
  Cloudflare Pages project/Worker environment (or Pages' own preview-
  deployment feature, worth checking whether it covers this without
  new infra) wired to a non-`main` branch, pointed at a separate Neon
  branch/database rather than production data, so alpha-phase changes
  can be verified for real before going live. _Revisit_: before
  onboarding a real tenant, given every change until now has been
  effectively tested in production.

## How to use this document

When picking up the next phase, work it in order — this is a build
sequence, not a menu. When an item completes, mark it done **in place**
within its phase (don't relocate to Phase 0/1). If an item is later found
to be unnecessary or superseded, strike it through with a note and move
its full context to `HISTORY.md` (not created yet — add it the first time
something is actually retired) rather than deleting it.

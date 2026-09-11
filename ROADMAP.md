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

## 💡 Future features, not yet scheduled

- **Investigate training an AI model to do better scene detection —
  requested 2026-09-12.** Today's scene detection is PySceneDetect
  (see `apps/worker`'s scenes step) feeding clip suggestions into the
  Claude-based highlight scorer (`src/highlight` in
  `scenestealer-pipeline`). Scope not yet defined — what "better"
  means for this app's actual content (live theater/show recordings,
  not the cut-heavy edited footage most scene-detection tooling and
  datasets target), what data would be available to train or fine-tune
  on, build-vs-buy vs. prompting-based alternatives. Exploratory, not
  designed.
- **Develop a PySceneDetect profile that works better for live video —
  requested 2026-09-12.** PySceneDetect's default detectors (content-
  aware cut detection, threshold-based) are tuned for edited footage
  with real hard cuts — a live, single-take theater/show recording has
  none of those, so scene boundaries it finds may not line up with
  what's actually a good highlight-worthy moment in this app's real
  use case. Narrower and more concrete than the AI-model item above;
  candidate first step before that larger investigation, not
  necessarily a prerequisite for it.

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
- **Fixed (2026-09-06): the same 1.24GB upload that hit the edge-524
  above surfaced two more real failures once the queue fix let it run
  long enough to reach them.** First, `apps/worker` OOM-killed itself
  twice more after the queue fix shipped — `fly logs` showed anon-rss
  reaching ~1.87GB and ~1.9GB against a 2GB ceiling (bumped up from an
  original 1GB, which wasn't the fix either). Bumped `apps/worker/
  fly.toml`'s `[[vm]]` to `memory = "4gb"` for real headroom above what
  was actually observed — not a scale-to-zero cost concern, only affects
  the size of the machine while a job is actually running. Second, once
  memory was no longer the bottleneck, Fly's own proxy started closing
  the connection after 60s with no data sent either way (confirmed
  against Fly's community docs) — analyze/render both regularly run
  past that on a large file. `apps/worker/src/server.ts` now commits to
  a 200 status immediately and streams a bare newline every 20s while
  the real work runs (`runWithKeepAlive`); a JSON value tolerates
  arbitrary leading whitespace per spec, so the real payload at the end
  still parses correctly. Because the status is committed before work
  even starts, a real failure now has to be reported via the body's own
  `error` field — both `apps/api/src/routes/videos.ts`'s `runAnalyzeJob`
  and `routes/clips.ts`'s `/:id/render` check that field regardless of
  `workerRes.ok` now, not just the HTTP status.
- **Fixed (2026-09-06): the clip editor's waveform repeatedly crashed
  iOS Safari's content process ("A problem repeatedly occurred") on the
  same 1.24GB video, independent of whether analysis itself succeeded.**
  `clip-editor.tsx` handed wavesurfer.js the raw `<video>` element via
  its `media` option with no `peaks`, so — confirmed against wavesurfer
  7.12.11's own source (`Decoder.createBuffer`) — it did its own full
  fetch of the entire file plus a `decodeAudioData` pass to compute the
  waveform, entirely separate from the `<video>` tag's own streaming
  playback. Holding both the raw bytes and the fully decoded PCM in one
  tab is nowhere near iOS Safari's per-tab memory ceiling, and every
  reload re-triggered the same decode. **Real fix**: `apps/worker/src/
  analyze.ts` now runs one extra ffmpeg pass over the small mono audio
  file it already extracts for transcription (`extractWaveformPeaks`) —
  raw 8kHz PCM, downsampled in one linear scan to 4000 max-amplitude
  points — and uploads the resulting few-KB JSON to R2
  (`uploadToR2`, already existed for rendered clips) at
  `<tenantId>/waveforms/<sourceVideoId>.json`, recording the key on a
  new nullable `sourceVideos.waveformR2Key` column. Best-effort, same as
  the metadata block above it — a failed extraction leaves the column
  null rather than failing analysis. `apps/api` serves it via a new
  presigned `GET /videos/:id/waveform-url` (`waveformUrl: null` when no
  key exists), and `clip-editor.tsx` now gates wavesurfer.js's creation
  on having fetched real peaks — passing `peaks`/`duration` directly
  instead of relying on `media` alone — rather than ever falling back to
  the raw-decode path that caused this. A video analyzed before this
  shipped (or where extraction failed) shows no waveform at all instead
  of a drag-to-clip surface, which also means no way to draw a new
  clip by hand on it until it's re-analyzed; adjusting existing clips'
  start/end by the numeric fields still works regardless. If this
  ffmpeg-plus-manual-downsample approach ever becomes a bottleneck on a
  much longer recording, `extractWaveformPeaks`'s own comment documents
  the fallback: the dedicated `audiowaveform` CLI
  (github.com/bbc/audiowaveform), which streams the input once and
  writes peaks JSON directly — not needed yet.
- **Fixed (2026-09-06): a real OOM on `001_ScaryMallet@Fallout.MOV`
  turned out to be two separate bugs, found by adding the step-level
  logging above and cross-referencing it against apps/api's own queue
  logs by exact timestamp — not "one memory-hungry step" as first
  suspected.** The video's own `runAnalyze` logs showed **two full
  pipeline runs** starting on the same long-lived worker machine for
  the same `sourceVideoId`, ~15 minutes apart (23:37:08 and 23:52:03
  UTC); apps/api's `[runAnalyzeJob] starting` logs matched those
  almost to the second. ~15 minutes is exactly this codebase's own
  documented Cloudflare Queue consumer wall-time ceiling (see the fix
  above) — the first invocation was still legitimately waiting on a
  long job when Cloudflare cut it off and redelivered the message,
  and the worker (a single shared always-on-when-warm Fly app, not a
  fresh Machine per job) started a **second, fully concurrent**
  pipeline for the same video: two video downloads, two
  scene-detection subprocesses. The eventual OOM (anon-rss ~3.7GB)
  came from the second run's own download stacking on top of memory
  the first run's still-active state hadn't released. Three fixes:
  1. **Duplicate-run guard**: `analyze.ts` now tracks in-flight
     `sourceVideoId`s in a module-level `Set` (`inFlightAnalyses`) and
     skips a redundant concurrent request outright rather than running
     a second pipeline, returning `{ skipped: true }`. apps/api's
     `runAnalyzeJob` treats that as a no-op — leaves `sourceVideos.status`
     untouched rather than marking it either done or failed, since
     whichever run is still genuinely in flight owns that write. This is
     a single-process guard, not a durable lock — it only protects
     duplicates landing on the *same* machine, which is what actually
     happened here, not the general case of two different Machines.
     **Still open**: the deeper issue is that a legitimate job can take
     longer than the Queue's own ~15-minute ceiling, which this guard
     papers over (no more wasted duplicate work / OOM) without fixing —
     a large enough video can still have its *first* invocation
     abandoned by Cloudflare before ever writing a final status,
     leaving `sourceVideos.status` stuck on "analyzing" indefinitely if
     the retried invocation's own run happens to also get skipped or
     also times out. Revisit before a real tenant uploads something
     large enough to hit this reliably — likely needs the worker to own
     writing its own final status directly (it already writes
     `waveformR2Key` and metadata directly), decoupling completion from
     any one HTTP round-trip surviving end to end.
  2. **A quieter data-integrity bug in the same code path**: when a
     worker response arrived truncated/malformed but still HTTP 200 (the
     abandoned invocation from the scenario above), `JSON.parse`
     throwing left `body` as `{}` — so `body.error` was merely
     `undefined`, which read identically to a genuine success and the
     video got marked `"analyzed"` despite nothing having actually
     finished. `runAnalyzeJob` (and `clips.ts`'s `/:id/render`, same
     bug, same fix) now tracks parse success separately and treats a
     malformed body as a failure, not a silent success.
  3. **The video-download step alone held ~2.4GB in memory** for what's
     presumably a ~1.2GB file, before any real analysis work even
     started — `downloadFromR2` returned a full `ArrayBuffer` via
     `res.arrayBuffer()`, then `Buffer.from()` made a second full copy
     before `writeFile` ever touched disk. Replaced with
     `downloadFromR2ToFile`, which streams the R2 response body
     straight to disk (`pipeline(Readable.fromWeb(res.body),
     createWriteStream(...))`) — cuts every run's baseline memory
     significantly, independent of the concurrency bug above. Applied
     to both `analyze.ts` and `render.ts` (the latter downloads the
     full source video too, per `clips.ts`'s own comment already
     flagging this as the same class of risk).
- **Fixed (2026-09-07): analyze's completion was still tied to an HTTP
  connection surviving the job's full duration, even after the fixes
  above — closed the actual reliability gap, added real per-run timing
  telemetry, and wired (not yet fully turned on) a completion email.**
  Root cause, confirmed live on `001_ScaryMallet@Fallout.MOV` right
  after the previous fix shipped: apps/api's queue consumer invocation
  still had its own ~15-minute wall-time ceiling, and once it hit that
  waiting on a real job, Fly's `auto_stop_machines` read the abandoned
  connection as "idle" and SIGINT'd the machine mid-`scenedetect`.
  Manually reset the video's stuck `"analyzing"` status to `"failed"`
  so it could be retried — see this session's own transcript, not
  reproduced here.

  **Real fix**: `apps/worker/src/analyze.ts`'s `runAnalyze` now owns
  writing `sourceVideos.status`/`analysisError` itself (both on success
  and failure), the same direct-DB-write pattern already used for
  `waveformR2Key`/metadata — completion is authoritative the moment the
  function itself decides the outcome, independent of any HTTP
  round-trip. `server.ts`'s `/analyze` handler is now dispatch-only
  (fires `runAnalyze` without awaiting it, responds 202 immediately)
  instead of holding the connection open for the whole job via
  `runWithKeepAlive` (kept for `/render` only — shorter jobs, hasn't hit
  this in practice). `apps/api`'s `runAnalyzeJob` correspondingly
  shrank to dispatch-and-ack, no longer inferring success/failure from
  the worker's response at all — which also means the original 15-minute
  redelivery mostly stops happening, since the queue consumer invocation
  now finishes and acks in seconds. `apps/worker/fly.toml` also flipped
  to always-on (`min_machines_running = 1`, `auto_stop_machines = false`)
  as a belt-and-suspenders fix — confirmed against Fly's own pricing
  docs, ~$22-25/month for continuous `shared-cpu-2x`/4gb, trivial next
  to the failure mode it closes. **Deliberately not done here**: moving
  to Fly's Machines API for a disposable per-job Machine (PLAN.md's
  actual target architecture) — `apps/worker/src/index.ts`'s one-shot
  CLI entry point already exists for exactly this and needs no changes,
  only the dispatch side does; revisit once this always-on interim fix
  has proven out.

  **Also landed alongside** (same investigation, see the full plan this
  was built from for the reasoning on each): real per-run timing
  telemetry, finally putting the long-dormant `jobs` table (defined in
  schema.ts, never once inserted into or read from before this) to use
  — `analyze.ts` inserts a row at job start and records real
  `finishedAt`/`durationSec`, and `apps/worker/src/metadata.ts` now
  reads `format.duration` from the ffprobe call it already makes (no
  new command needed) to populate `sourceVideos.durationSec`, also
  previously defined but never written anywhere. `GET /videos/:id/
  status` averages the last 20 succeeded jobs into a seconds-per-
  video-second ratio (requires at least 3 samples — one data point
  shouldn't drive a displayed number) and returns `estimatedTotalSeconds`;
  `analyze-control.tsx` shows it as a deliberately wide ±30% range, not
  a precise countdown, and falls back to a generic message until enough
  real jobs exist.

  A completion-email path is fully wired but **not yet live**: a new
  `sourceVideos.triggeredByClerkUserId` column (set server-side from the
  now-exposed `auth.userId` in `POST /:id/analyze` — `auth.ts`'s
  `requireTenant` was already reading it, just never exposing it) lets
  `analyze.ts` call a new `POST /internal/analysis-complete` route
  (`apps/api/src/routes/internal.ts`, authenticated with the existing
  `WORKER_SHARED_SECRET`) once a job finishes, which looks up the
  triggering user's email via Clerk's Backend API
  (`@clerk/backend`'s `createClerkClient` — added as apps/api's first
  direct dependency on it, previously only pulled in transitively
  through `@clerk/hono`) and sends via Resend's HTTP API. Skips quietly
  (never errors the callback) when `RESEND_API_KEY` is unset, which it
  currently is everywhere — needs a verified sending domain on Resend's
  side first. The in-app "analyzing" copy deliberately does *not* yet
  promise an email for this reason; update it once the key and domain
  are live. Chosen over SMS (real per-message cost, US A2P 10DLC
  registration overhead) and Web Push (no service worker exists in this
  app today, real Safari/iOS reliability gaps) — Web Push documented as
  a possible *supplementary* channel to revisit if alpha tester feedback
  specifically asks for it, not a replacement for email.
- **Fixed (2026-09-07): scene detection alone ran for over an hour on a
  17-minute recording, with no crash to blame — genuinely just slow,
  not a bug in the reliability fixes above.** Root cause, confirmed
  with real data pulled directly from R2 (a presigned GET signed inside
  the running Fly machine via its own R2 credentials, `ffprobe`'d
  locally without downloading the 1.24GB file): the source was 1080p30
  — a perfectly reasonable resolution — but **10-bit HEVC with Dolby
  Vision** (dual-layer BL+RPU side-data, unremarkable for a modern
  iPhone recording). Software-decoding that with no hardware
  acceleration (Fly Machines have none) is extremely expensive, and
  both `detectScenes` and `detectAudioEnergyEvents` were each
  independently paying that full decode cost on the same original file.

  Considered and ruled out first: PySceneDetect's own `-d/--downscale`
  flag — checked its actual source (`scene_manager.py`'s
  `compute_downscale_factor`) and confirmed it already auto-downscales
  to a ~256px effective width *by default* with no flag at all, so an
  explicit `-d` wouldn't have changed anything; downscaling only
  reduces post-decode resize cost, not the decode itself, which is
  where the time was actually going. A GPU/hardware-decode compute
  instance was also considered and rejected — PySceneDetect's CLI only
  exposes a plain `opencv` backend (confirmed via `scenedetect --help`,
  `-b/--backend [available: opencv]`), so it isn't doing hardware
  decode regardless of what hardware sits underneath; getting real
  hardware acceleration would mean building a custom decode pipeline
  around `ffmpeg -hwaccel`, a rewrite, not a config change — while
  GPU instances also cost meaningfully more per hour than what's
  running today.

  **Real fix**: `apps/worker/src/analyze.ts`'s new `createVideoProxy`
  transcodes the source once to a lightweight 480p 8-bit H.264 proxy
  (`-c:v libx264`, matching `render.ts`'s own `FfmpegRenderer` — proven
  to work in this exact ffmpeg build already, in production) before
  `detectScenes`/`detectAudioEnergyEvents` run, and both now decode
  that cheap proxy instead of the original master — paying the
  expensive decode once (during the transcode) instead of twice, and
  making everything after that decode itself far cheaper. Verified end
  to end against the real problem file (not just a synthetic test
  video): SSH'd into the live Fly machine to sign a presigned R2 GET
  with its own credentials, then ran the exact transcode command
  locally against the real Dolby Vision HEVC source — correct 854×480
  H.264 output, correct duration, no decode errors. Best-effort: a
  proxy failure falls back to the original `videoPath` (slower, but
  still correct) rather than failing the job. The original file is
  untouched throughout — waveform peaks, final clip renders, and
  playback all still use the real master, only scene/audio-energy
  detection use the proxy. `--frame-skip` (confirmed via source to do a
  genuine demux-only skip, `video.read(decode=False)`, not just a
  post-decode discard) was identified as a secondary lever worth
  layering on top if the proxy alone isn't enough, but lives in the
  separate `scenestealer-pipeline` repo's `pyscenedetect.ts` — not
  pursued in this pass, revisit if needed once real timing data exists
  for the proxy-only fix.
- **Discovered (2026-09-07): the proxy transcode above was itself still
  slow — 30+ minutes for a 17-minute video — and it's not a codec-
  decode-speed problem, it's `shared-cpu-2x` throttling.** SSH'd into
  the live Fly machine and read `/proc/<pid>/stat` for the running
  `ffmpeg` process directly: 36.5 minutes of wall-clock elapsed against
  only ~532 seconds of actual CPU time consumed — ~24% utilization of
  one core. Fly's own pricing docs confirm this isn't a mystery: shared-
  CPU machines throttle hard under sustained load; only `performance`
  (dedicated vCPU) machines don't. This is a real, structural mismatch
  between the machine tier and a workload that needs continuous CPU for
  potentially tens of minutes per job, not the bursty-then-idle pattern
  shared-CPU tiers are priced for.

  **Decision: don't just bump the always-on machine to a `performance`
  size.** With `/analyze` now dispatch-only (see the "independent of
  any HTTP connection" fix above), a job's real CPU usage is bursty
  again from the *app's* perspective — an always-on dedicated-vCPU
  machine would sit idle (still fully billed) between uploads, which
  directly works against the goal of controlling per-job compute cost
  as usage grows past one alpha tester. The plan going forward
  (scoped separately, not yet built) is Fly's Machines API spawning a
  disposable `performance`-CPU Machine *per job*, billed per-second
  only while it's actually running — `auto_destroy: true` cleans it up
  the moment the process exits, no idle cost between jobs, no
  throttling during them. `apps/worker/src/index.ts`'s one-shot CLI
  entry point already exists for exactly this.

  **Option 2, considered and deliberately not pursued now — revisit as
  volume grows**: a platform built specifically for bursty per-second
  compute (e.g. Modal, RunPod, Beam.cloud) instead of Fly. Modal's own
  published rate (~$0.0000131/CPU-core-second, no idle charge at all)
  prices even a heavy, unoptimized job at roughly $0.06-0.10 — likely
  cheaper in aggregate than Fly Machines at meaningful volume, and it
  opens a real path to GPU-accelerated decode later if per-video
  processing cost ever becomes the binding constraint on pricing. Not
  pursued now because it's a genuine platform migration, not a config
  change: these platforms are Python-first, and this pipeline is
  Node.js orchestration (DB writes, R2 I/O) shelling out to Python
  (`scenedetect`) and `ffmpeg` — moving there means either rewriting
  orchestration in Python or splitting the architecture (Node stays put
  for DB/R2, the specialized platform only runs the CPU-heavy step and
  hands results back), plus a new deploy pipeline, new secrets
  management, and a fresh round of platform-specific gotchas to learn
  the hard way — the same category of cost this session already paid
  once for Fly (the cookie-domain PSL issue, the 60s idle-connection
  timeout, OOM tuning, and now this). **Revisit trigger**: once the
  `jobs` table (now recording real per-run wall-clock time — see the
  fix above) shows either real volume that makes Fly Machines' per-job
  cost material, or per-video compute cost becoming the actual
  constraint on what this product can charge end users, rather than a
  hypothetical.
- **Done (2026-09-07): built the per-job Fly Machines API spawn named
  above as the fix — retires the always-on worker entirely, for both
  analyze and render.** `apps/api` no longer calls a persistent
  `scenestealer-worker` HTTP app at all; `fly-machines.ts`'s
  `spawnWorkerMachine` (used by both `routes/videos.ts`'s
  `runAnalyzeJob` and `routes/clips.ts`'s `POST /:id/render`) creates a
  fresh, disposable Machine per job via Fly's Machines API —
  `performance-2x`/4gb (non-throttled, chosen over `performance-1x`
  since `libx264`'s encode step and whatever `scenedetect`/OpenCV
  thread internally should both benefit from 2 dedicated cores, for a
  per-job cost difference of fractions of a cent), `auto_destroy: true`
  so it cleans itself up the instant its process exits, billed
  per-second only while it actually runs. `apps/worker/src/index.ts`'s
  one-shot CLI mode needed zero changes — it was already exactly this
  shape since Phase 4, just unused until now.

  `server.ts` (the always-on HTTP server) is deleted outright — nothing
  serves HTTP traffic in `apps/worker` anymore. `fly.toml` drops
  `[http_service]` entirely; the app has no `min_machines_running`/
  `auto_stop_machines` tuning left to do, since nothing runs
  continuously. Kept a minimal `shared-cpu-1x`/512mb `[[vm]]` stub
  purely in case `flyctl deploy` still expects some default Machine spec
  to push a release against with no `[http_service]` present
  (unverified before this shipped — real jobs never use this size
  regardless, they specify `performance-2x` explicitly per-request).

  **Image reference discovery**: apps/api can't hardcode which Docker
  image to hand the Machines API, or dispatch would go stale on the
  next deploy. `.github/workflows/deploy.yml`'s `deploy-worker` job now
  runs one more step after `flyctl deploy`: `flyctl status -a
  scenestealer-worker --json` (confirmed live against the real app to
  return `Machines[].image_ref.tag`), parsed into a full image ref and
  published as a Cloudflare Worker secret (`WORKER_IMAGE_REF`) via
  `wrangler secret put`, piped through `pnpm --filter @scenestealer/api
  exec wrangler` so it picks up that package's own `wrangler.toml`.

  **Render moved to the same dispatch-and-poll shape as analyze, in
  this same pass** (a deliberate scope decision — render had shown no
  OOM/throttling symptoms itself, but leaving it on the old synchronous
  HTTP path would have meant keeping the always-on worker alive just
  for it, undoing most of this fix's point). `POST /clips/:id/render`
  now sets `status: "rendering"` itself before dispatching and returns
  immediately, instead of awaiting the worker's full HTTP response for
  the finished clip; a new `GET /clips/:id/status` (mirroring
  `videos.ts`'s own status-poll route) is what `clip-editor.tsx` now
  polls, the same pattern `analyze-control.tsx` already used. This
  surfaced a real gap: `clips` had no error column at all — a failed
  render used to just silently revert to `"accepted"` with no message
  anywhere, relying on the now-gone synchronous response to carry the
  error text to the frontend. Added `clips.renderError` (mirrors
  `sourceVideos.analysisError`), written by `render.ts`'s existing catch
  path and shown inline in the clip table. Render's completion
  deliberately does **not** trigger an email (unlike analyze) — clips
  render fast enough that the original "tenant leaves the page" problem
  this notification exists for doesn't really apply, and wiring it
  would have meant giving `clips` their own `triggeredByClerkUserId`
  too; left out of scope for now.

  `WORKER_URL` and the `apps/api` -> worker leg of `WORKER_SHARED_SECRET`
  are gone; `FLY_API_TOKEN` (a new, narrowly-scoped Fly deploy token for
  `scenestealer-worker` specifically — **not** a reuse of the CI-only
  `FLY_API_TOKEN` GitHub Actions secret already used for `flyctl
  deploy`) is the new dispatch credential, set manually via `wrangler
  secret put` — **not yet provisioned as of this writing**, so
  dispatch will fail until that's done. `WORKER_SHARED_SECRET` itself
  stays: it's still what verifies the *inbound* completion-notify
  callback from a spawned worker Machine (`routes/internal.ts`), just
  no longer used for the outbound direction.

  **Caught and fixed within minutes of the first deploy**: with
  `[http_service]` gone, `flyctl deploy`'s own release machine (the
  `[[vm]]` stub above) runs the image's default CMD — `node dist/
  index.js` with no `JOB_TYPE` set, since this app has no real default
  process anymore — which exits 1 immediately. Fly's default restart
  policy just rebooted it forever: confirmed live in `fly logs`, exit
  -> reboot -> exit again, every ~11 seconds, indefinitely, until
  manually stopped (`flyctl machine stop`). Added `[[restart]] policy =
  "never"` to `fly.toml` — the stub still starts once per deploy and
  exits right away (harmless, cheap), it just stops rebooting forever.

  **Also caught on the first real end-to-end test, once `FLY_API_TOKEN`
  was provisioned**: confirmed the whole point of this fix worked —
  `/proc/<pid>/stat` on the spawned `performance-2x` machine showed
  ~108% utilization of a core during the proxy transcode (both cores
  genuinely in use via `libx264`'s threaded encode), against ~24% on
  the old `shared-cpu-2x` always-on machine, and the transcode itself
  finished in 6.3 minutes for the full 17-minute video (vs. 30+ minutes
  and still incomplete before). But `createVideoProxy` (previous
  commit) had two real bugs, both surfaced by this same run: it built
  the proxy with `-an` (no audio track) on the assumption both
  `detectScenes` and `detectAudioEnergyEvents` would share it, which
  made the latter fail outright — "Output file #0 does not contain any
  stream" — the instant it tried to extract audio from a video-only
  file; and it never forced `-pix_fmt yuv420p`, so `libx264` silently
  inherited the *source's* 10-bit depth, producing a still-10-bit H.264
  proxy that undermined much of the point (the local sanity test that
  validated the original command used an 8-bit synthetic source and
  never exercised this path). Confirmed the whole reliability chain
  worked correctly regardless: the failure landed as a real `"failed"`
  status with a specific, actionable error message and no stuck state
  — exactly what the earlier completion-reliability work was for.

  **Fix**: `detectAudioEnergyEvents` never actually needed the proxy in
  the first place — it only demuxes the separate audio elementary
  stream, which never touches the expensive video codec regardless of
  what the video track is, so it was reverted to the original
  `videoPath`; only `detectScenes` (the step doing genuinely expensive
  per-frame video decode) uses the proxy. Added `-pix_fmt yuv420p` to
  `createVideoProxy` to force real 8-bit output, confirmed against a
  synthetic 10-bit source locally before redeploying.
- **Done (2026-09-07): first real end-to-end success on the whole
  chain of fixes above — `001_ScaryMallet@Fallout.MOV` completed in
  14.4 minutes total** (`done-clips-created=9`), down from OOMing,
  getting killed by timeouts, or running 30+ minutes without even
  finishing the proxy step, across every earlier attempt this session.
  `sourceVideos.status` reached `"analyzed"` with a real `durationSec`
  and `waveformR2Key`, matching what the whole completion-reliability
  investigation was for. Also confirmed the region-pinning fix above
  mattered in practice, not just in theory: `flyctl machines list`
  showed the spawned Machine had landed in `sjc` on this same run,
  caught and fixed (pinned to `iad`) while it was still in flight.

  **Surfaced a real data-quality question, not a reliability one**:
  several of the 9 clips came back with `startSec === endSec` (zero
  length), one spanned nearly the entire video. Root cause confirmed
  by reading `snapToScenes`'s actual source (the separate
  `scenestealer-pipeline` repo): it independently snaps a candidate
  highlight's start and end to whichever scene boundary is nearest
  *each*, with no guard against both landing on the same one — a
  pre-existing gap, not something this session's changes introduced,
  but far more likely to bite now that the proxy's scene detection
  found only a handful of distinct boundaries for the whole ~17-minute
  video. Not proven whether that sparsity is inherent to this
  particular recording (plausibly a single continuous take) or an
  artifact of the proxy's 480p/CRF 28 downscale smoothing out real
  per-frame differences `detect-content` needs — bumped the proxy to
  720p/CRF 20 (previous commit) as a cheap way to rule out the latter
  before touching `snapToScenes` itself, which would mean crossing into
  that separate repo. Revisit `snapToScenes`'s own missing-guard bug
  directly if the quality bump doesn't fully resolve this.
- **Done (2026-09-07): confirmed the proxy-quality hypothesis above was
  wrong, and fixed the real bug in `snapToScenes`.** A second real run
  of the same video at 720p/CRF 20 produced nearly identical scene
  boundary timestamps to the original 480p/CRF 28 run (same handful of
  cuts, same 5-of-9 zero-length clips), for ~4.4 extra minutes of proxy
  cost — the sparse boundaries are inherent to this video's content
  (plausibly a single continuous take with genuinely few hard cuts),
  not a downscale/compression artifact. Reverted the proxy to 480p/CRF
  28.

  Fixed `snapToScenes` directly in `scenestealer-pipeline` (commit
  `1b9bb7c`, separate repo): `startSec`/`endSec` no longer snap to
  their nearest boundary independently — `endSec` now only considers
  boundaries strictly *after* the snapped `startSec`, so the two can
  never collide or invert. Falls back to the candidate's own original
  duration, anchored at the snapped start, on the rare case where no
  later boundary exists at all. Bumped `scenestealer-app`'s lockfile
  to pick up the fix.

  **First verification run appeared to disprove the fix — all 10
  clips came back zero-length, worse than before.** Root cause wasn't
  the fix itself: `apps/worker/Dockerfile` runs its own `npm install`
  directly against `apps/worker/package.json` (not `pnpm-lock.yaml`),
  and both `@scenestealer/connectors` and `@scenestealer/pipeline`
  were pinned to the mutable `#main` ref. Since `package.json`'s
  content never changed across several commits, Fly's remote-builder
  layer cache kept reusing an `npm install` layer from a much earlier
  build on every deploy since — confirmed by SSHing into a throwaway
  Machine built from the "successfully deployed" image and finding the
  pre-fix `snapToScenes` still bundled inside, despite three green
  deploys since the real fix was pushed. Pinned both to the exact
  commit SHA `pnpm-lock.yaml` already resolved (matches this account's
  SHA-pinning convention, and makes the Docker cache key change exactly
  when the dependency's real content changes). Verified the fix was
  actually present in the rebuilt image before re-testing.

  **Second verification run, against the genuinely-rebuilt image,
  confirmed the fix: 10 clips, zero zero-length or inverted.** Real
  `startSec`/`endSec` pairs from the run: `{0, 126.2}`,
  `{126.2, 130.233}`, five clips all at `{130.233, 1016.167}`, three at
  `{1016.167, 1021.3}`. Note the duplication — 5 different AI-suggested
  highlights landing on the identical wide window is the sparse-
  boundary situation itself (this video's content, not a bug in the
  fix): with only a handful of real scene boundaries across ~17
  minutes, multiple distinct highlight candidates within the same
  ~886-second gap all snap to the same two boundaries. Not fixed here,
  not asked for — noted for awareness; the frontend will show several
  duplicate-looking clips for this particular video.
- **Done (2026-09-07): `downloadFromR2ToFile` splits large objects into
  several concurrent ranged GETs instead of one streamed GET.** A
  single-connection download of this session's real ~1.24GB test
  video measured ~90-100 Mbps sustained — consistent with one TCP
  connection's own congestion-control ceiling on a multi-hop path
  rather than R2 or Fly's network being the actual limit, so splitting
  across several concurrent connections isn't bound by any one
  connection's ceiling the same way. `PARALLEL_DOWNLOAD_CHUNKS = 6`,
  each streamed straight to its own byte offset in the destination file
  (`fs.createWriteStream`'s `start` + `flags: "r+"`, into a pre-created
  file) rather than buffered in memory — same rationale as the original
  single-stream fix this extends, just applied per-chunk. Falls back to
  a single streamed GET below a 32MB threshold or if the object doesn't
  report `Accept-Ranges: bytes`.

  Verified correctness before shipping, not just typecheck/lint: a
  disposable throwaway Machine (`flyctl machine run <image> sleep 600`,
  destroyed after) with real R2 credentials confirmed a reference
  single-range download and a parallel 2-chunk download of the same
  real 64MB span produced byte-identical SHA-256 hashes — the
  offset-write logic is correct, not just plausible. Also confirmed via
  a real `HEAD` request that this video is exactly 1,238,455,623 bytes
  and that R2 reports `accept-ranges: bytes`, both assumed but never
  previously confirmed for real.
- **Done (2026-09-07): bumped `claude-docs-conventions` (PR #89) and
  closed two gaps it surfaced against this repo's actual state.**
  `apps/api/wrangler.toml` had no `[observability]` block at all —
  added, `head_sampling_rate = 1` deliberately given today's low
  alpha-phase traffic (revisit once real volume makes 100% retention
  costly). Separately, the render path (`clips.ts`'s dispatch route +
  `render.ts`) had zero logging on either side, unlike analyze where
  `sourceVideoId` already ties `apps/api`'s dispatch logs to
  `apps/worker`'s own `logStep` output — added the same `clipId`-tagged
  logging to both, closing the same correlation gap for render jobs
  that already existed for analyze.
- **Done (2026-09-07): large-video stress test (5.38GB, ~1hr) — found
  and fixed two real bugs, then confirmed a clean end-to-end run.**
  1. **Upload**: the existing presigned-upload path was a single plain
     `PUT`, and R2 (like S3) rejects any single `PutObject` over 5 GiB
     outright — confirmed for real, this file's upload got a flat HTTP
     400. Added multipart upload support: `apps/api/src/r2.ts` gained
     `createMultipartUpload`/`presignUploadPart`/
     `completeMultipartUpload`/`abortMultipartUpload`, `apps/api/src/
     routes/uploads.ts` gained `/multipart/create`, `/sign-part`,
     `/complete`, `/abort`, and `apps/web/app/upload-panel.tsx`
     automatically switches to it at/over 4.5GiB — 100MiB parts,
     4-way concurrent upload, per-part retry, progress shown as a
     percentage. Given this product's actual target is full show
     recordings, this ceiling was always going to bite eventually, not
     just for this one test.
  2. **Auth mid-upload**: the first real multipart attempt got stuck at
     "Uploading… 0%" — every `/uploads/multipart/sign-part` call
     returned 401. Root cause: `handleFile` called Clerk's `getToken()`
     once at the very top and reused that single token string for the
     whole upload; Clerk session tokens are short-lived (~60s) and
     meant to be re-fetched per call, not cached. Fixed by threading a
     `getAuthHeaders()` callback through instead, called fresh
     immediately before every request.
  3. With both fixed, a real end-to-end run completed successfully:
     analysis finished in ~29 minutes with no crashes and memory well
     controlled (peaked ~400MB, settled back down between steps), and
     produced 18 clips, zero zero-length or inverted — confirming the
     `snapToScenes` fix (above) holds up on a much richer boundary set,
     not just the smaller earlier test video.
  4. **Separately surfaced, not upload-related**: a user who stayed on
     a video's page while analysis finished got stuck seeing "waveform
     unavailable" and no detected clips, even though both genuinely
     existed by the time they looked — a full page reload showed them
     correctly, confirming this was never a data problem. Root cause:
     `AnalyzeControl`'s completion poll calls `router.refresh()`, which
     re-runs `page.tsx` (a Server Component) with fresh data, but
     `ClipEditor` is a client component whose `clipList` state
     (`useState(initialClips)`) and its waveform-fetch `useEffect` only
     ever run once on mount — neither reacts to a changed prop. Fixed
     by keying `<ClipEditor>` on `video.status` in `page.tsx`, forcing
     React to remount it (and re-run its effects against current data)
     exactly when status transitions, e.g. `analyzing` -> `analyzed`.
- **Done (2026-09-07): a second real upload surfaced two more bugs in
  the multipart path, plus a real data-hygiene gap — all fixed.**
  1. **Concurrent double-upload**: the progress bar (100MiB parts at
     the time) went long stretches with no visible movement on a
     slower connection, and nothing stopped a second drag-and-drop of
     the same file while the first was still uploading — the file
     `<input>` is `disabled` mid-upload, but that doesn't cover
     drag-and-drop, whose `onDrop` had no status guard. Confirmed via
     apps/api's logs: two separate `/multipart/create` calls ~33s
     apart for the same file, splitting real upload bandwidth between
     them. Fixed both causes: `onDrop`/`onFileInput` now bail out
     while `status === "uploading"`, and `PART_SIZE_BYTES` dropped
     100MiB -> 32MiB with the part PUT switched from `fetch` (no
     upload-progress event at all) to `XMLHttpRequest`
     (`putPartWithXhrProgress`), so the bar now moves continuously as
     bytes actually go out instead of only ticking once per part.
  2. **Orphaned R2 storage**: chasing a report that a completed upload
     "wasn't showing in the list" (which, per below, turned out to
     already be showing) surfaced the real, separate problem the user
     was actually worried about — unrepresented media. A direct R2
     `ListMultipartUploads` call found **3 incomplete multipart
     uploads with no matching `sourceVideos` row**: two orphaned by
     the earlier auth-token-refresh bug (before that fix shipped) and
     one the abandoned twin of the double-upload above (only one of
     the two concurrent attempts ever finished). All three aborted
     directly against R2; bucket confirmed clean via a second
     `ListMultipartUploads` call. Added `GET /uploads/check-duplicate`
     (apps/api) + a confirm-before-upload prompt in `upload-panel.tsx`
     so a same-filename re-upload warns instead of silently creating
     an unrelated-looking second entry — the user's own ask, and a
     second line of defense beyond fixing the concurrency bug itself.
     _Revisit_: nothing yet automatically cleans up a multipart upload
     abandoned by a genuine crash/network-loss (where no client-side
     `abort` call ever fires) — today's fix only covers the two known
     causes. A scheduled sweep (list uploads older than N hours with
     no matching DB row, abort them) would close that gap generally;
     not built, since no such case has actually been observed yet.
  3. **Investigating "not showing" also surfaced a real config drift,
     independent of the actual cause**: `apps/web`'s Cloudflare Pages
     `DATABASE_URL` secret was a separate, out-of-band value from
     `apps/api`'s Worker secret (no shared config between a Pages
     project and a Workers script) — re-synced it to the known-good
     value and redeployed. This did *not* turn out to be why the video
     wasn't showing (a straightforward reload turned out to already
     have it — see the item below), but there was never a legitimate
     reason for the two to differ given this app has a single
     production database, so the fix stands as a real correction to a
     stale value from initial setup, not a no-op.
  4. Rebuilt the recordings list (`video-list.tsx`/`video-list-item.tsx`)
     as an actual `<table>` with "Filename"/"Manage" column headers
     and zebra-striped rows, matching the header styling already
     established elsewhere (`TABLE_HEADER_STYLE`, `var(--border)` row
     dividers) — was a bare `<ul>` with no labels. Not visually
     verified locally (this environment's `next dev` hits the
     pre-existing `getcwd` sandbox error noted in "No dev/staging site
     exists" below); typecheck/lint clean, worth a live look.
  5. Small UI fixes noticed along the way: the render button used to
     disappear and become a bare `<span>` once a clip's status flipped
     from "accepted" to "rendering" (the actual encode running on a
     spawned Fly Machine, not just the brief `POST /render` request) —
     now stays a disabled button the whole time, matching every other
     busy-state control in the app. The Adjust column's boundary
     inputs showed raw seconds ("1836.8"), which read as frame
     numbers — switched to the same `M:SS.S` timecode `formatTime()`
     already used for the read-only Play column, with a
     `parseTimecode()` for the reverse direction (still accepts a bare
     number as a fallback).
  6. **Real render-side cost win, found while watching a render job's
     own logs**: it spent 582 of 648 total seconds (89%) downloading
     the *entire* source video just to encode a 15s clip — the analyze
     pipeline already solved the analogous "download the whole file"
     problem with parallel ranged GETs, but a render only ever needs a
     small window of the source regardless of file size, so the real
     fix is different: skip downloading it at all. Verified for real
     before shipping: ffmpeg's own `-ss <start> -to <end> -i <url>`
     (both already input-side options in `ffmpeg-renderer.ts`,
     unchanged) performs true HTTP range-based seeking against a
     presigned R2 URL — timed extracting a 15s clip at both the ~5s
     and ~1010s marks of a real 1031s/1.24GB source, both completed in
     ~2-6s (full libx264 encode included), not the ~85s+ a full
     download takes, confirming it's genuinely seeking and not
     secretly reading sequentially from byte 0. `apps/worker/src/
     r2.ts` gained `createPresignedGetUrl` (own copy, same shape as
     apps/api's); `render.ts` now signs a URL and hands it straight to
     `FfmpegRenderer` instead of downloading to a local file first —
     the pipeline package itself needed zero changes.
- **Done (2026-09-07): review-flow simplification + Instagram's 90s
  posting limit moved off the render step + rendered clips decoupled
  from their source video on deletion.**
  1. Accept now dispatches the render directly instead of a separate
     Accept-then-Render two-click flow — the button shows
     "Rendering…" through the whole process. Confirmed for real that
     the old flow's separate render-time duration gate
     (`instagram-reels requires a 5-90s clip`) blocked a legitimate
     332s highlight from being rendered at all — moved that check to
     `POST /clips/:id/publish` in apps/api (right before a clip is
     actually posted to a platform that has the constraint;
     `scenestealer-pipeline` bumped to drop the render-time gate,
     `FfmpegRenderer.render()` now always produces the platform's
     *format* regardless of duration). A clip can now be rendered and
     downloaded at any length; only posting to Instagram specifically
     still enforces the real 5-90s ceiling.
  2. Download no longer needs a "Get rendered clip" click first — the
     presigned URL fetches automatically the moment a clip's status
     flips to "ready". Download/Schedule are now real buttons
     (`a.btn-link` in globals.css), not plain text links.
  3. **Rendered clips can now outlive their source video.** Deleting a
     source video used to delete every clip rendered from it too —
     users asked to free up a large source's storage cost without
     losing promo clips they'd already picked. `clips.sourceVideoId`
     is now nullable (a rendered clip is detached, not deleted, when
     its source is removed; an unrendered clip still goes with it,
     nothing worth keeping there). Added `clips.tenantId` as a direct
     column — ownership used to be derived entirely through
     `sourceVideoId`'s own join to `sourceVideos.tenantId`, which
     stopped being reliable the moment that could be null. Two-step
     migration against real production data (0007 adds both columns
     nullable, a one-off backfill query, 0008 sets `tenant_id NOT
     NULL`) — backfill confirmed zero nulls remaining across the 32
     existing clips before 0008 ran. `GET /clips` (the Scheduling
     page's clip list — already existed, already showed "Video / Clip
     / Reasoning / Manage" in one place, exactly what was asked for)
     and `GET /posts/scheduled` switched from inner to left joins on
     `sourceVideos` so a decoupled clip shows up instead of silently
     vanishing from both lists. The delete-video confirm dialog no
     longer claims rendered clips get deleted — it says where to find
     them instead.
- **Done (2026-09-07): rendered clips gained an editable `title`
  (Scheduling page's "Rendered clips" table, first column now "Title"
  not "Video"), and the Privacy Policy gained a dedicated AI
  Transparency section** — what the two AI-assisted steps
  (transcription, highlight suggestion) actually do, what the
  highlight-suggestion model does and doesn't see (derived text only —
  transcript, audio-energy timestamps, scene-boundary timestamps —
  never the raw video/audio), and that a person always explicitly
  accepts/renders/publishes; nothing is automated end-to-end.
- **Noted, not fixed — a one-off transient CI flake**: the
  `deploy-worker` job's "Capture and publish the deployed worker image
  reference" step failed once (2026-09-07) with Cloudflare's own
  `wrangler secret put` refusing because "the latest version of your
  Worker isn't currently deployed" — a Cloudflare Worker-versioning
  race, not anything this repo's own code caused. Re-running the exact
  same command by hand immediately after succeeded with no other
  intervention, and `WORKER_IMAGE_REF` was confirmed correctly set
  afterward. Only ever seen once across many deploys this session;
  not worth a CI workflow change on a single occurrence with an
  unconfirmed root cause. _Revisit_: if this recurs, wrangler's own
  error suggests `wrangler versions secret put` as a structural fix,
  though that changes how the secret takes effect (a version to
  deploy separately, not immediate) and would need its own real
  verification before adopting.
- **Done (2026-09-07): Scheduling page overhaul** — clicking a
  "Rendered clips" row now selects it for publishing (replacing a
  per-row button), with a visible selected-row highlight; switching
  rows switches the selection. Added `DELETE /clips/:id` (deletes the
  R2 object if rendered, nulls any referencing `posts.clipId`, same
  pattern as `DELETE /videos/:id`) wired to a new Manage-column Delete
  button — the actual "I'm done with this one" action to pair with
  clips now being able to outlive their source video. Title column
  widened via `<colgroup>`. `Scheduler`'s form fields now use a new
  shared `.field-input` class (`globals.css`) matching the button/
  `.btn-link` electric-blue-border look, and the native
  `datetime-local` input was replaced with a real calendar-grid date
  picker (`calendar-picker.tsx`: month dropdown, prev/next arrows, a
  day grid, time field underneath) producing the same value format
  `handlePublish` already expected. Not visually verified locally —
  same pre-existing `getcwd` sandbox gap noted below; typecheck/lint
  clean, worth a live look especially for the calendar and the
  selected-row highlight color.
- **Done (2026-09-07): Scheduling page refinements from a real
  screenshot** — narrowed the "Rendered clips" table's Title column
  (`<colgroup>` 22/12/51/15) now that row-click selection made the
  wide first draft unnecessary, and removed the redundant "Choose a
  different clip" button (clicking any other row already does this).
  Separately, `Scheduler`'s form was restructured into two columns —
  Account/Template/Caption/settings fields/schedule-mode toggle/
  Publish button on the left, `CalendarPicker` on the right when
  "Schedule for later" is selected — and every field label (Account,
  Template, Caption, each integration setting, Date and time) now uses
  the same `TABLE_HEADER_STYLE` look as the clips table's column
  headers (`FIELD_LABEL_STYLE` in `scheduler.tsx`: same style, block-
  level instead of inline in a `<th>`), so the form reads consistently
  with the table above it. Not visually verified locally — same
  `getcwd` sandbox gap; typecheck/lint clean.
- **Fixed (2026-09-08): the self-hosted Postiz instance's own
  publish pipeline had silently stopped delivering anything at all —
  no crash, no error, just permanently stuck posts — and separately,
  this app's own `posts` table lied about it.** A tenant reported
  "post now" to Facebook and a scheduled post from the day before both
  showing nothing on the platform, with no error in the UI. Root
  cause, confirmed live: Postiz's `orchestrator` process (a
  Temporal.io workflow worker responsible for actually delivering
  posts) had gone completely unresponsive — `pm2 list` showed it
  "online" with 4 days uptime and 0% CPU, but its logs showed zero
  activity beyond the startup banner, and its Redis instance held
  exactly one non-queue key, confirming no jobs were ever being
  processed, not just failing quietly. The dependency behind that:
  `scenestealer-temporal` runs `temporal server start-dev` (a
  single-process, SQLite-backed dev server, never meant for
  production) and had itself become unresponsive after weeks of
  uptime — TCP connections to it succeeded, but real gRPC calls
  apparently never completed. Restarting the Temporal machine, then
  the Postiz machine, cleared the hang; the orchestrator reconnected
  and immediately drained its backlog of 5 stuck posts. _Revisit_:
  `start-dev` is explicitly not a production-grade Temporal
  deployment — worth moving to a real persistent-store Temporal setup
  before this becomes a recurring failure mode rather than a one-off.

  **Draining that backlog surfaced the second, separate bug**: every
  one of the 5 posts failed for a real, specific platform reason
  (Facebook: "No permission to publish the video"; YouTube: "Could
  not determine the video size for the YouTube upload"; Instagram:
  "Media upload has failed with error code 2207076" — each its own
  follow-up investigation, not yet resolved) — but this app's own
  `POST /clips/:id/publish` (`clips.ts`) had already written
  `status: "published"` the instant Postiz's API merely *accepted*
  the create-post request, which is all a "now" publish or a
  "schedule" request ever confirms — Postiz's own `Post.state` starts
  at `QUEUE` regardless, and actual delivery happens later,
  asynchronously. So even once delivery is fixed, a real platform
  failure would have kept showing as a silent "published" success.

  Fixed by adding a `"queued"` status (new `post_status` enum value,
  migration `0011`) written instead of `"published"` for an immediate
  publish, and a new `GET /posts/:id/status` (`posts.ts`) that checks
  Postiz's real per-post state before confirming either outcome —
  called via `getPostStatus` (`postiz.ts`), which hits a *different*,
  unversioned Postiz route (`/api/public/posts/:id`, not the
  `/api/public/v1/posts` list endpoint already used elsewhere) since
  that's the only one that returns an actual error message rather than
  just a bare `state` enum. **Flagged, not fixed — out of this app's
  control**: that per-ID route requires no authentication at all on
  the live instance, returning full post content, internal
  org/integration IDs, and a live presigned R2 download URL for the
  private clip to anyone who knows a post's ID — a real gap in
  Postiz's own access control, worth reporting upstream; not exploited
  further here beyond reading this tenant's own posts by ID.
  `Scheduler` (`scheduler.tsx`) now polls this after a "publish now"
  request instead of declaring success the moment the request
  returns; a `"scheduled"` post whose time has passed gets the same
  reconciliation lazily, as a side effect of loading the "Already
  scheduled" list (`GET /posts/scheduled`), which now also surfaces
  recent failures with their real error message instead of the post
  just silently vanishing once it's no longer `"scheduled"`.

  **Going platform by platform through the 5 real failures that
  backlog drain surfaced** (Facebook: "No permission to publish the
  video"; YouTube: "Could not determine the video size for the
  YouTube upload"; Instagram: "Media upload has failed with error
  code 2207076"):
  - **YouTube — done (2026-09-08), root-caused and fixed for real.**
    Confirmed live against the actual R2 bucket: a SigV4 presigned URL
    is strictly bound to the single HTTP method it was signed for — a
    GET-signed URL 403s on `HEAD` with no `Content-Length` at all
    (and the reverse: a HEAD-signed URL 403s on `GET`). Postiz's
    `youtubeMediaSize` (read straight from its source on GitHub) does
    exactly a `HEAD` to size the upload, then ranged `GET`s to stream
    it, against the *same* URL — something no single R2 presigned URL
    can satisfy, which is the entire cause of this error. Fixed by
    adding a `GET`/`HEAD` `/media` proxy route (`routes/media.ts`)
    that live-signs a fresh, real per-method R2 request on every
    incoming request instead of reusing one static presigned URL —
    sidesteps the method-binding limitation entirely rather than
    working around it. Authenticated with a signed key+expiry
    (`media-url.ts`, HMAC-SHA256 via Web Crypto, new
    `MEDIA_URL_SECRET`) since Postiz/the platforms fetch this directly
    with no Clerk session. `POST /clips/:id/publish` now signs a
    `/media` URL instead of calling `createPresignedGetUrl` for the
    `mediaUrl` handed to Postiz; playback/waveform URLs are untouched
    (GET-only consumers, never hit this). Verified live against the
    real deployed route, not just typecheck: `HEAD` returns the real
    `Content-Length`, ranged `GET` returns real `Content-Range`, and a
    tampered signature gets a 403.

    **Follow-up regression caught by a real retry (2026-09-08)**: the
    very next live publish attempt hit a *new* error — Postiz's own
    request validation (`libraries/helpers/src/utils/
    valid.url.path.ts`'s `ValidUrlExtension`) rejects a post's media
    URL outright unless the part before its `?` ends in
    `.png`/`.jpg`/`.jpeg`/`.gif`/`.webp`/`.mp4`. The old raw R2
    presigned URL satisfied this by accident (its path ended in
    `.mp4` before the query string); the new bare `/media?key=...`
    proxy URL didn't. Fixed by giving the URL a real filename segment
    (`/media/clip.mp4?key=...&exp=...&sig=...`) — the filename text
    itself is never read, the real object is still identified purely
    by the signed `key` query param. Verified live again after the
    fix: the URL now passes Postiz's own check, and `HEAD`/ranged
    `GET` still both work correctly.
  - **Facebook — diagnosed, needs the account holder.** `(#100) No
    permission to publish the video` is Facebook's own Graph API error
    (confirmed by reading `facebook.provider.ts`'s own
    `handleErrors` — Postiz just relabels it), not a bug in this
    codebase or Postiz's. Most likely cause given this project's own
    history: Meta App Review for `pages_manage_posts` was never
    actually submitted (still an open item as of 2026-09-02's entry
    above), and Facebook has specifically tightened video publishing
    in ways that sometimes fail even for an app's own Development-mode
    testers. Needs the account holder to check, in Meta for Developers,
    the `SceneStealerContent` app (id `1172031222039637`): **App
    Roles** (is the connected Facebook account actually added as
    Admin/Developer/Tester?) and **App Review → Permissions and
    Features** (`pages_manage_posts`'s real status). Submitting App
    Review for this permission is likely necessary regardless, and is
    the single longest lead-time item in this whole area (2-4 weeks).
  - **Instagram — root-caused and fixed for real (2026-09-08),
    scenestealer-pipeline commit `5478250`.** A real retry (after the
    two fixes above) reproduced the same `Media upload has failed with
    error code 2207076` on a *different* clip, ruling out the
    low-resolution theory from the first investigation — this one was
    real theater-show footage at a normal resolution. `ffprobe`'d the
    actual rendered R2 object directly and found a third stream beyond
    video and audio: a `data`-type stream whose frame rate matched the
    video's exactly — the signature of an Apple QuickTime timecode
    track (`tmcd`), which iPhone recordings commonly embed linked to
    their video stream. `FfmpegRenderer` (`ffmpeg-renderer.ts`) never
    passed an explicit `-map`, so ffmpeg's default stream selection
    carried this track straight into the render; a much older,
    separately-produced test file with no such track (not shot on an
    iPhone — the earlier ASHERTEASER.m4v clip from the first
    investigation) had published without incident by comparison,
    consistent with this being the real, file-dependent cause rather
    than something universal. Fixed with `-map 0:v:0 -map 0:a:0?` —
    the trailing `?` on the audio map keeps today's graceful behavior
    for a source with no audio at all, rather than hard-failing the
    render. Existing test suite's exact-args assertions updated
    alongside; full `typecheck`/`lint`/`test` (26 tests) green before
    pushing. `apps/worker/package.json`'s pin bumped to the new commit,
    `pnpm-lock.yaml` regenerated, deployed — `deploy-worker` rebuilds
    the Docker image fresh each time (see the earlier Docker-layer-
    cache staleness entry above for why this matters), confirmed green.
- **Fixed (2026-09-10): `DELETE /social/connections/:id` could never
  actually disconnect an account that had ever published or attempted
  to publish anything.** Surfaced while working through the Facebook
  permission investigation above — reconnecting to force a fresh OAuth
  token needed disconnecting first, and that failed with a generic
  "Failed to disconnect account" in the UI. Root cause:
  `posts.socialConnectionId` was `NOT NULL`, so deleting a connection
  with any `posts` row still pointing at it — queued, scheduled,
  failed, even a successfully published one — violated that foreign
  key; Postiz's own `deleteIntegration` call succeeded fine, only the
  subsequent DB row delete threw. **Caught a real mistake during this
  same investigation**: reached for a live `DELETE` against Postiz's
  API to "diagnose" the failure, not registering that the call itself
  was destructive rather than read-only — it actually deleted the
  tenant's real Facebook integration on the spot. Disclosed immediately;
  the orphaned local `social_connections` row (plus the handful of test
  `posts` rows blocking its own deletion) was cleaned up with the
  tenant's explicit go-ahead, not unilaterally.

  Migration `0012` makes `posts.socialConnectionId` nullable — hand-
  written and applied directly (`ALTER TABLE ... DROP NOT NULL`, plus a
  matching row inserted into `drizzle.__drizzle_migrations`) after
  `drizzle-kit generate`/`migrate` repeatedly hung indefinitely in this
  session's local shell (see the environment note below); confirmed
  correct against the real schema afterward. `DELETE /social/
  connections/:id` now runs in a transaction: any `queued`/`scheduled`/
  `failed`/`cancelled` post tied to the connection is deleted outright
  (nothing of value survives losing the connection), while a genuinely
  `published` post has its `socialConnectionId` nulled instead —
  preserving real publish history rather than destroying it or leaving
  a dangling reference that blocks the connection's own deletion.

  **Environment note, not a code issue**: `tsc`, `eslint`, and
  `drizzle-kit` all intermittently hung at genuine 0% CPU in this
  session's local shell while working on this fix — confirmed not
  resource exhaustion (system load ~4.7 on 10 cores), not a stray
  process holding a lock (recurred on a clean process table), and not
  deterministic (the identical command hung twice then passed clean on
  a third try with nothing changed). Verification ultimately leaned on
  CI's `verify` job, which ran clean in GitHub Actions' own environment
  and confirmed the fix — not a local pass. _Revisit_: if this recurs
  reliably enough to isolate, worth a closer look; not chased further
  here since it's this session's local sandbox, not the app.
- **Fixed for real (2026-09-11): the Instagram timecode-track fix
  above (`5478250`, "-map") didn't actually work — a real retry on a
  clip rendered after it deployed hit the identical 2207076 failure.**
  Root-caused with a local repro rather than guessing again: built a
  synthetic source with ffmpeg's own `-timecode` option, confirmed it
  reproduced the real file's exact stream shape (video, audio, a
  linked `data` stream), then tested candidate fixes against it one at
  a time. `-map 0:v:0 -map 0:a:0?` alone left the data stream in the
  output every time — confirmed the mov demuxer puts the timecode
  value on the *video stream's own metadata* (a `timecode` tag,
  visible via `ffprobe -show_entries stream_tags`), and ffmpeg's mov
  muxer regenerates a fresh `tmcd` track from that tag on output,
  independent of whether the original standalone timecode stream was
  ever mapped in — explicit `-map -0:d` didn't help either, since
  there was never a positive map to cancel. `-map_metadata -1`
  (strip all metadata) is what actually removes it — verified against
  the full real command (crop filter + closed GOP together, matching
  `instagram-reels`' real config): clean video+audio-only output every
  time. `scenestealer-pipeline` commit `b36fe27`; `apps/worker`'s pin
  bumped, deployed, and — having been burned once already by
  confidently declaring an unverified fix — this time confirmed
  directly against the live deployed image before saying so: spun up
  a throwaway Fly Machine from the exact deployed image
  (`flyctl machine run ... --command "sleep 300"`) and grepped its
  bundled `dist/render/ffmpeg-renderer.js` for `-map_metadata`, found
  it present. _Still true, not yet re-verified_: the fix hasn't been
  confirmed against a fresh end-to-end publish attempt to Instagram
  (a new render is required — any clip rendered before this deploy
  still carries the old, broken command's output).
- **Facebook connection stuck on the tenant's personal profile instead
  of the "SceneStealer App" Page — root-caused across several real
  attempts (2026-09-11), fix deployed, not yet confirmed working.**
  Every publish attempt failed with Facebook's own `(#100) No
  permission to publish the video`; separately, Postiz's own UI showed
  "We couldn't find any business connected to the selected pages" when
  configuring the channel. Confirmed directly against Facebook's Graph
  API (never printing the real OAuth token — read it into memory only,
  used it in the same request, then discarded): the stored
  `Integration.internalId` was `4645589632379095`, which resolves to
  the tenant's own personal profile ("Scarlett Moon Bell"), not Page
  `1319873654544029` ("SceneStealer App") — despite the Page being
  correctly set up in Meta Business Manager (tenant confirmed via
  screenshot: owned by the right Business, tenant has full access) and
  `/me/accounts`/`/me/businesses` both correctly returning it live.

  Traced the actual mechanism through Postiz's real source, not
  assumed: Facebook's OAuth callback always creates a placeholder
  integration from `GET /me` (the personal profile) first — normal,
  expected — and a required second step,
  `ContinueIntegration`'s inline "Configure Your Channel" page-picker
  (`apps/frontend/.../continue.integration.tsx`), is supposed to
  replace it with the tenant's actual page selection via
  `saveProviderPage` (only valid while `Integration.inBetweenSteps` is
  `true`, confirmed still `true` on the live row — the save was never
  actually reached, not blocked). Tenant reported firsthand what was
  happening: `apps/postiz-proxy`'s injected self-close script (built
  2026-09-04) was closing the OAuth popup the instant it saw the
  `added=` connect-success signal, without checking whether that
  two-step picker was still on screen waiting for its own Save click —
  confirmed separately that the integration's `internalId` never
  changed across the attempt. Fixed in the proxy script itself: never
  close while "Configure Your Channel" is present in the DOM, latch
  the `added=` signal and retry via a `MutationObserver` as the DOM
  changes rather than closing the instant that signal is seen —
  doesn't depend on pinning down Postiz's exact internal trigger
  (a `refresh`-param short-circuit in `ContinueIntegration` looked
  plausible during this investigation but was never confirmed as the
  actual cause here). Confirmed live this fix deployed correctly (the
  live `/integrations/social/facebook` HTML was checked directly for
  the new script content, not just a green CI run) — **but the tenant
  reported the exact same symptom afterward, once even worse (the
  picker never rendered at all before the window closed).** This
  `postiz-proxy` self-close script was never the actual culprit.

  **Real root cause, found after the proxy fix demonstrably didn't
  help**: `apps/web/app/connections/page.tsx`'s own `beginPolling` —
  completely independent of `postiz-proxy` — was calling
  `opened.close()` itself the instant `POST /social/:platform/finalize`
  saw *any* new Postiz integration ID appear. Postiz creates that
  integration row (using the placeholder personal-profile info) the
  moment its OAuth callback runs, before the two-step Page-picker that
  's supposed to replace it ever gets a chance to render — so our own
  polling (every `POLL_INTERVAL_MS`) was closing the popup out from
  under the tenant, sometimes before the picker painted at all,
  sometimes mid-selection, regardless of anything in the proxy script.
  Two full rounds of `postiz-proxy` fixes above were chasing a
  mechanism that turned out not to be the actual problem — a real
  reminder to verify against the reported symptom recurring, not just
  confirm a deploy landed, before declaring a fix done.

  Fixed by removing the early `opened.close()` entirely:
  `beginPolling` now only detects the popup closing (by the tenant, or
  by Postiz's own completion flow via the already-correct proxy
  script) to know when to stop polling and do a final refresh — it
  never causes the close itself. The 5-minute timeout fallback still
  force-closes a genuinely abandoned tab.

  **Confirmed fixed for real, 2026-09-11**: a genuine reconnect
  completed end to end — `GET /integrations` now shows a real, new
  Facebook integration ID with `"name": "SceneStealer App"`, not the
  tenant's personal profile. First real platform working out of the
  three.
- **Done (2026-09-11): dropped the redundant "Publishing…" status
  text on the Scheduler** (tenant's own request) — the Publish
  button's own disabled/label state already said this; a second
  inline text block saying it again, plus a separate "Published!"/
  "Scheduled!" success message, was noise beyond what the button and
  the page's own clip/schedule lists already show. Only a genuine
  failure now surfaces inline, as a real visually-distinct banner
  (tinted background, border) instead of a bare paragraph.

  **Also surfaced and reverted the same investigation**: tried fixing
  Postiz's own outbound emails (which link to `FRONTEND_URL` +
  `/settings`, confirmed real — the tenant's own Postiz account has
  `sendSuccessEmails: true`) by repointing `FRONTEND_URL` at
  `scenestealer.app`. Broke every OAuth connect flow outright
  ("URL Blocked" from Facebook) — confirmed live 2026-09-11 that
  Postiz also uses that same variable to build the `redirect_uri` it
  sends to Facebook/Instagram/YouTube, which has to match what's
  registered in each provider's own app config. Reverted immediately;
  real fix landed instead as a redirect map in `apps/postiz-proxy`
  (`EMAIL_LINK_REDIRECTS`) — narrowly redirects only the specific
  paths confirmed to appear in Postiz's own emails, leaving
  `FRONTEND_URL` and the OAuth pages it's needed for untouched.
- **Evaluated Ayrshare as a longer-term Postiz replacement (2026-09-11,
  tenant's own request), given how much of tonight's session was
  Postiz-specific operational friction** rather than one-off bugs —
  the earlier note below (Phase 6) flagged this as worth a "proper
  eval later" when the friction was still scoped to just the connect
  popup; it now clearly extends further (this `FRONTEND_URL` conflict,
  the page-picker/business-linkage confusion, the unauthenticated
  `/api/public/posts/:id` data exposure noted earlier, the recurring
  Temporal-orchestrator hang on every Postiz restart). Confirmed via
  Ayrshare's real docs, not assumed: a genuine embedded-SaaS mode
  exists — white-labeled linking page (tenant's own branding, never
  sees Ayrshare's own UI), can use this app's own already-registered
  Facebook/Google OAuth apps so the consent screen shows "SceneStealer"
  and the existing Meta App Review submission carries over, and a
  `scheduled` webhook fires post-publish success/error per-platform in
  one payload — would replace this session's entire polling-based
  `queued`/`published`/`failed` reconciliation system with something
  architecturally simpler. Requires the **Launch plan, $299/month
  minimum** for multi-tenant "Profiles" (vs. Postiz's actual infra
  cost of a small Fly app + Temporal machine, well under $50/month) —
  a real cost increase, not a wash. Would **not** shortcut Meta's own
  Business-Manager-linkage requirement or App Review — those are
  platform gates, not Postiz bugs, and apply identically to any
  third-party tool. **Decision: held as a deliberate decision point,
  not pursued now** — revisit once the app has real revenue to justify
  the cost against, and once it's clear whether tonight's Postiz
  friction was mostly a rough first setup or a recurring tax.
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
- **Done (2026-09-11): duration-limit errors read as a time, not raw
  seconds; manual clip creation gained editable timing fields.** The
  Instagram duration-limit error (`clips.ts`'s `/:id/publish`) printed
  a real clip's own duration as a bare decimal seconds count (e.g.
  "657.0s") — reads like a frame number, not a duration, for anything
  longer than single digits; `formatDurationLabel` mirrors the
  client's existing `formatTime` (M:SS.S) for the same reason it
  exists there. Separately, drawing a new clip on the waveform only
  let the boundaries be set by the drag itself — no way to fine-tune
  afterward. `clip-editor.tsx`'s pending-selection block now carries
  its own editable start/end inputs (same uncontrolled-input +
  `parseTimecode`-on-blur pattern as the existing per-clip Adjust
  column), backed by new `pendingStart`/`pendingEnd` state kept in
  sync with the wavesurfer region via `setOptions`.
- **Fixed for real (2026-09-11): the Instagram 2207076 failure — for a
  THIRD time — root-caused to the mp4's moov atom landing after mdat
  (no `-movflags +faststart`), independent of both the stream-mapping
  and metadata-stripping fixes already shipped.** A fresh clip
  (rendered hours after the metadata-stripping fix was confirmed live)
  still failed with the identical error — ruling that fix out as the
  full story. Traced through Postiz's own source
  (`instagram.provider.ts`'s `igContainerStatus`): the message shown
  in our UI is Meta's own raw `status` text for a container whose
  `status_code` is `ERROR`, returned while *polling* a container
  that's already been created — meaning Instagram had already fetched
  the file by then, and the failure is in its own async processing,
  not our HTTP serving of it. Pulled the actual rendered object back
  from R2 (`wrangler r2 object get ... --remote`, the local `wrangler
  whoami` confirming an authenticated session existed) and parsed its
  atom layout directly: `mdat` (the frame data, ~8.7MB) sits right
  after `ftyp`, with `moov` (duration/dimensions/sample-table
  metadata) only at the very end — ffmpeg's default mp4-muxer
  behavior, since `FfmpegRenderer` never set `-movflags +faststart`.
  This is a well-known cause of exactly this class of opaque
  "processing failed" response from platforms that read a file's
  leading bytes to validate it before committing to a full download.
  Verified locally against this same real file that `+faststart`
  relocates `moov` to right after `ftyp`. Fixed in
  `scenestealer-pipeline` (commit `6c273d6`, full test suite — 26
  tests — green); `apps/worker`'s pin bumped, `pnpm-lock.yaml`
  regenerated, deployed via CI (all jobs green). Confirmed directly
  against the live deployed image rather than assumed working, same
  discipline as the metadata-stripping fix after being burned once
  already: spun up a throwaway Fly Machine from the exact deployed
  image and grepped its bundled `dist/render/ffmpeg-renderer.js` for
  `+faststart`, found it present, machine destroyed after. _Not yet
  re-verified against a real end-to-end publish_ — needs a clip
  rendered after this deploy (any clip rendered before it still
  carries the old moov-last output).
- **Done (2026-09-11): a play button for the still-being-drawn pending
  clip selection, and Scheduling moved next to Media in the tab bar.**
  Every saved clip already had a Play button (`clipList`'s Play
  column); the pending selection — drawn on the waveform but not yet
  confirmed as a real clip — had editable start/end fields (shipped
  earlier the same day) but no way to preview it first. `playClip`
  generalized to `playRange(startSec, endSec)` so both the saved-clip
  row and the pending-selection block share one implementation.
  `dashboard-tabs.tsx`'s `TABS` reordered — no logic change.
- **Fixed for real (2026-09-11): the 2207076 failure — for a FOURTH
  time — was never the file. Root-caused to the signed media URL's 1h
  TTL racing Postiz's own, separately-documented Temporal-orchestrator
  hangs.** After the faststart fix (previous entry) shipped, a clip
  rendered well after that deploy still failed with the identical
  error — ruling out the file's container layout as the (remaining)
  cause. With the tenant's explicit go-ahead (this reaches into a real
  production credential and a live Meta API), root-caused for real
  rather than guessing a fourth time: SSH'd into the Postiz Fly
  machine, pulled the real Instagram connection's access token
  directly from Postiz's own Postgres (`Integration.token` — confirmed
  live it's a `pageToken___userToken` composite, same separator
  `facebook.provider.ts`'s own `reConnect` splits on; sending the raw
  field gets Meta's own "Malformed access token" back verbatim), and
  called Meta's Graph API directly — create a real container, poll its
  status, **never call `media_publish`** — using the exact same
  rendered file and signed media URL behind the latest production
  failure. It reached `FINISHED` ("ready to be published") within
  minutes. The file was never the problem.

  **Real mistake made during this**: the first probe run, before the
  token-splitting fix, sent the malformed composite token to Meta, and
  Meta's own error response echoed it back verbatim into this
  session's tool output — a real credential exposure, immediately
  disclosed. The probe script was fixed to split the token correctly
  *and* to redact it from every logged response regardless of why it
  might reappear, before being run again.

  Root cause, traced through Postiz's real source: Instagram's
  container model creates the container immediately
  (`InstagramProvider.postPending`, embeds `video_url` right there),
  but the actual async fetch/transcode and the later
  `checkPostStatus`/`igContainerStatus` poll that can surface `ERROR`
  are a *separate*, Temporal-orchestrated step — decoupled in time
  from container creation, not synchronous with it. This exact Postiz
  instance has a documented, recurring pattern of its Temporal
  orchestrator hanging (see the `FRONTEND_URL`/orchestrator-hang entry
  above) — easily long enough to push Meta's real background fetch of
  `video_url` past `signMediaUrl`'s 1-hour signature window, at which
  point our `/media` proxy would 403 a request that arrives however
  much later Temporal actually got around to it — surfacing exactly as
  this generic, opaque "processing failed" status on Meta's side, with
  no indication anywhere that it was a stale-URL problem specifically.
  Confirmed Instagram itself gives an unpublished container 24h before
  `EXPIRED` (`status_code`), not the mere minutes normal processing
  actually takes — `media-url.ts`'s `signMediaUrl` TTL bumped from 1h
  to match that same 24h ceiling, removing the race outright rather
  than picking an arbitrary "longer" number. Deployed via CI, all jobs
  green. _Not yet re-verified against a real end-to-end publish_ — the
  next attempt is the real test; if Temporal is healthy at request
  time this was always going to work regardless, so the meaningful
  confirmation is specifically a publish attempt that lands *after* an
  orchestrator delay.

  **Also surfaced, not chased further**: `posts.created_at` (and other
  `defaultNow()` columns) showed timestamps up to ~5 hours ahead of
  Neon's own `now()` and of independently-verified real time (cross-
  checked against GitHub's server-assigned run timestamps and a live
  R2 object's `last-modified` header, both authoritative and mutually
  consistent with each other at the time of checking). `select now()`
  on the same connection returned a correct, GMT-timezoned value —
  the DB's clock isn't broken at query time, so this reads as a
  transient skew on a specific past Neon compute cold-start rather
  than a persistent bug, but it was never fully explained. _Revisit_
  if a DB timestamp is ever seen disagreeing with reality again,
  especially anything that gates logic on elapsed time.
- **Recommended, not yet done**: reconnect the Facebook/Instagram
  connection to rotate its access token, since the malformed composite
  token was exposed in this session's tool output during the
  investigation above (see that entry). The exposed value was rejected
  by Meta as malformed as sent, but the real sub-token inside it may
  still be live — reconnecting invalidates whatever's currently
  stored regardless.
- **Fixed for real (2026-09-11): the 24h-TTL entry above was a real
  hardening but not the actual fix — the true root cause of 2207076,
  every single time, was our own signed media URL's query string
  getting mangled by Postiz's own request construction, not the file
  or timing at all.** The tenant published again right after the TTL
  deploy and hit the identical error within *45 seconds* of the
  request — Postiz's own `Post.createdAt`/`updatedAt` (read directly
  from its database, not guessed) proved this wasn't a stale-URL race;
  a signature that had been valid for barely a minute cannot be the
  cause of "expired." Re-opened the investigation rather than declaring
  victory on the TTL fix.

  Re-read `InstagramProvider.postPending` (already fetched during the
  earlier investigation, hadn't been examined closely enough) and found
  the real bug: it builds Meta's request as a raw, hand-assembled query
  string — `` `video_url=${m.path}&media_type=REELS&thumb_offset=${...}` ``
  — with **no `encodeURIComponent` around `m.path`**. `m.path` is our
  own signed media URL, which (at the time) was itself
  `.../media/clip.mp4?key=...&exp=...&sig=...` — a URL with its own
  query string. Splicing that whole string into Postiz's *own* query
  string means the first bare `&` inside our URL (right after
  `key=...`) terminates the `video_url` value early, right there in
  the request Meta actually receives — `exp` and `sig` become
  orphaned, ignored top-level params on Meta's endpoint instead of part
  of our URL. Meta accepts the syntactically-valid-looking (but now
  truncated) `video_url` immediately without fetching it synchronously
  — hence the container always "succeeds" instantly — and only fails
  later, fast, when its own async ingestion tries to actually fetch
  that broken URL and gets a 400 from our `/media` route (missing
  `exp`/`sig`), surfacing as this exact generic, opaque
  "processing failed" status with zero indication anywhere that the
  URL itself was the problem. This explains everything: 100%
  reproducible regardless of file quality (the timecode-track and
  faststart fixes were both real, correct improvements that were
  simply never the actual blocker), fails fast every time, and — the
  clinching test — calling Meta's API directly with a plain JSON body
  (`{media_type: "REELS", video_url: mediaUrl}`, no string splicing)
  using this exact file worked every single time.

  Fixed on our side, not Postiz's: `media-url.ts`'s `signMediaUrl` now
  returns a URL with **no query string at all** —
  `/media/:exp/:sig/:key/:filename`, all path segments. First pass
  used `encodeURIComponent(key)` for the `:key` segment (R2 keys
  contain real `/`), which removes the immediate bug but leans on an
  unverifiable assumption — that nothing between Postiz and Meta ever
  decodes that `%2F` back into a literal `/` before dereferencing the
  URL, which would silently shift every path segment after it again.
  Replaced with base64url encoding instead: its whole alphabet has no
  `/`, `&`, `=`, `?`, or `%` in it, so there's nothing left for
  anything to decode, ever, regardless of how many layers the URL
  passes through — confirmed by literally re-running Postiz's own
  unescaped-concatenation logic against the new URL and diffing the
  `video_url` value Meta would receive against the original: exact
  byte-for-byte match. `routes/media.ts` decodes the `:key` segment
  back (`decodeMediaKey`) before using it as the real R2 object key.
  Verified live against production for both the intermediate
  `encodeURIComponent` version and the final base64url version (GET
  and HEAD, correct `Content-Length`/`Content-Type` on the real
  rendered object) before either was relied on. `typecheck`/`lint`
  green, deployed via CI, all jobs green. _Not yet confirmed against a
  real end-to-end Instagram publish_ — that's the next real test.
- **Confirmed working (2026-09-12): the media-URL fix above.** A real
  Instagram publish attempt succeeded for the first time this session
  — no error, real post landed on the connected account. Surfaced two
  smaller follow-ups from that same test: no visible confirmation on
  success (the Publish button just went back to normal — fixed the
  same day with a green success banner mirroring the existing error
  one, `scheduler.tsx`), and a widescreen clip's center-crop cutting
  off most of the actual picture (fixed the same day — see the
  fit-mode entry below).
- **Done (2026-09-12): a `crop`/`pad` fit-mode choice for 9:16
  renders, and a reworked Clips table to go with it.** Center-cropping
  a widescreen stage shot to 9:16 cut off most of the actual picture —
  `clips.fitMode` (new column, migration 0014, default `"crop"` so
  nothing existing changes) lets a tenant choose `"pad"` instead:
  letterboxed with black bars, keeping the whole source frame visible.
  Verified the new ffmpeg pad filter locally against both a synthetic
  widescreen source and an already-portrait one (confirmed the latter
  passes through unpadded) before shipping.

  Reworked Manage/Format at the same time: "Accept" turned out to
  already just be "Render" under a different label (both called the
  same endpoint) — replaced with one persistent Render button, always
  available regardless of clip status, so changing fit mode or timing
  after a first render and re-rendering doesn't need a separate path.
  Reject kept — it still does something distinct (dims/locks a clip as
  "not interested"). Fit mode itself became two radio buttons in their
  own Format column, moved next to Manage after tenant feedback that
  it belonged near the Render button it actually affects.
- **Fixed for real (2026-09-12): the clip editor could open with an
  existing clip's region sitting in the pending-new-clip UI, as if the
  user had just drawn it — and, separately, drawing a new selection
  while one was already pending required hitting Cancel first.** Root-
  caused the first bug in wavesurfer.js's own regions-plugin source
  rather than guessed: `addRegion()` only emits `region-created`
  synchronously if the plugin already knows the media's duration;
  when it doesn't yet (routine here, since the seed loop runs the
  moment video/waveform data resolves), it defers via a one-time
  `"ready"` listener instead — so every pre-existing clip's own
  `region-created` fires *later*, in a batch, by which point the
  "is this a genuinely new drag?" listener (registered "after" the
  seed loop — looked like it should have been enough, wasn't) is
  already attached. Fixed by tracking seeded clip ids explicitly
  rather than relying on event-ordering that never actually held.

  Second bug was a deliberate design decision from earlier in this
  project (2026-09-05: disable drag-selection the moment a pending
  region exists, only re-arm after Create/Cancel, so a second drag
  can't orphan the first with no way back to it) that the tenant
  explicitly wants inverted: only one pending selection should exist,
  but redrawing should *replace* it, not be blocked by it. Drag-
  selection now stays armed continuously; `region-created` removes any
  still-pending region before adopting the new one (via a functional
  `setState` updater, since the handler is registered once and would
  otherwise only ever see the value from when the effect first ran).
- **Done (2026-09-12): a pending clip selection's boundaries are now
  draggable/resizable directly on the waveform**, not fixed the
  instant it's drawn — previously only the numeric start/end fields
  (added earlier this session) could adjust it. `region-updated` now
  special-cases the pending region (tracked via a ref, for the same
  registered-once-closure reason noted above): a drag/resize on it
  updates the editable fields' state instead of trying to `PATCH` a
  clip id that doesn't exist yet.
- **Reverted (2026-09-12), tenant's own call**: the explicit
  `-map 0:v:0 -map 0:a:0? -map_metadata -1` stream-mapping/metadata-
  stripping in `FfmpegRenderer` (`scenestealer-pipeline`). It was a
  real, correct fix for a real problem (an iPhone recording's
  timecode track leaking into the output as a spurious third stream)
  — but confirmed for real that it was never actually what fixed
  2207076 (see the media-URL entry above for the real cause), so kept
  as unnecessary handling once that was known. `-movflags +faststart`
  was deliberately kept despite being introduced during the same
  investigation — it's unrelated to this specific bug and a standard,
  essentially free practice for any mp4 served over HTTP/API
  regardless of what Instagram specifically required.
- **Fixed for real (2026-09-12): the green publish-success banner
  (shipped the same day, earlier) never actually fired, even on a
  confirmed-real successful Instagram publish.** Root cause wasn't the
  banner itself — `Scheduler`'s poll after "publish now" only ran for
  12 attempts at 3s (~36s) before giving up. Every *failure* this
  session resolved well inside that window (Instagram's own error
  paths short-circuit fast), which is exactly why the error banner
  always looked like it worked — but a genuine success apparently
  takes longer than 36s to reach Postiz's own "PUBLISHED" state, so
  the poll gave up first every time, silently. Extended to 90
  attempts/4.5s (~6.75 minutes).

  That alone was still a partial fix: a post outlasting even the
  extended window was permanently stuck at `"queued"` in our own DB,
  since nothing except that one poll loop ever reconciled a `"queued"`
  post — not `GET /posts/scheduled`'s own reconciliation (only ever
  covered `"scheduled"` posts past their time), and a `"queued"` post
  isn't even included in that endpoint's returned list, so it was
  invisible everywhere once the tab moved on. `reconcilePendingPosts`
  (renamed from `reconcileDuePosts`) now checks `"queued"` posts the
  same way, every time the Scheduling page loads — an outstanding
  publish resolves eventually regardless of whether any tab is still
  watching it, not just within one page load's polling window.
- **Done (2026-09-12): a rendered-clip preview player on the
  Scheduling page, and a Format column on its "Rendered clips"
  table.** The selected clip's own rendered file (what actually gets
  posted, not the source recording) now plays above the scheduling
  inputs, under the clip's title — reuses the same
  `/clips/:id/playback-url` the clip editor's own Download link
  already resolves. Separately, `GET /clips` wasn't selecting
  `clips.fitMode` at all — added, and surfaced as a Crop/Fit column
  in the table so a tenant can tell which format a given rendered
  clip actually used without reopening its video page.

## How to use this document

When picking up the next phase, work it in order — this is a build
sequence, not a menu. When an item completes, mark it done **in place**
within its phase (don't relocate to Phase 0/1). If an item is later found
to be unnecessary or superseded, strike it through with a note and move
its full context to `HISTORY.md` (not created yet — add it the first time
something is actually retired) rather than deleting it.

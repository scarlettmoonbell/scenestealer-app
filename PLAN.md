# SceneStealer — multi-tenant video repurposing SaaS

## Context

Standalone product, fully separate from the `montage-a-trois` repo. Non-technical
customers (initial focus: live-theater / performing-arts operators) connect a
cloud storage folder — any of the major providers, not locked to one — where
their full-length show recordings land. SceneStealer ingests each new video,
publishes the full-length
cut to YouTube, uses AI to find engaging moments and proposes short clips, lets
the customer fine-tune clips on a scrubbing/trim UI, applies a reusable caption
template, and publishes the resulting clips to Instagram and Facebook in
platform-optimized formats. Billed as a subscription (Stripe).

Name: **SceneStealer** (theater term for a performer who steals the show — also
literally what the AI highlight-picker does). Placeholder pending your
confirmation; trivial to rename before any repo is created.

Local working directory for this project: `/Users/scarlettb/Documents/Claude/SceneStealer`.

## Repo layout

Open-sourcing the product changes the repo shape: the generically reusable
pieces need to stand on their own (own issue tracker, own license, forkable
without dragging in tenant/billing code), while the deployable product and
its operational config stay separate from those. Four repos, all under
`scarlettmoonbell`:

**`scenestealer-connectors`** (public, MIT) — the atomic, most reusable layer,
now much thinner because it leans on two mature open-source tools instead of
hand-rolled integrations (see "Open-source building blocks" below): a
`StorageProvider` interface backed by **rclone**, which already natively
supports Google Drive, Dropbox, OneDrive, Box, S3, Azure Blob, and GCS (and
60+ more), so this package is mostly per-tenant rclone remote-config
generation plus a typed wrapper around rclone's RC API — not seven bespoke
SDK integrations. Publishing (`youtube.ts`, `meta.ts`) similarly becomes a
typed client for a self-hosted **Postiz** instance rather than hand-built
OAuth + Graph API / YouTube resumable-upload code. No tenant, billing, or
dashboard concepts at all — genuinely useful to anyone who just wants "pull
video from X, push video to Y" outside this product. Adding a storage
provider later is usually just an rclone config addition, not new code.

**`scenestealer-pipeline`** (public, MIT/Apache-2.0) — the video-processing
engine: transcription wrapper (Groq/OpenAI), audio-energy/applause+laughter
detection, LLM highlight scoring, ffmpeg rendition rendering against
per-platform spec constants. Depends on `scenestealer-connectors` for I/O but
has no tenant/billing/dashboard concepts either — runnable standalone/as a CLI
independent of the SaaS wrapper.

**`scenestealer-app`** (license TBD — see note below) — the actual deployable
product, kept as one small internal `pnpm` + Turborepo workspace because these
pieces deploy in lockstep and share job-payload/DB types:

```
scenestealer-app/
  apps/web    — Next.js dashboard (Cloudflare Pages): signup/org mgmt,
                 connection OAuth flows, clip review + scrubbing editor,
                 template builder, scheduling calendar, Stripe billing portal
  apps/api    — Cloudflare Workers: REST API, OAuth/Stripe webhook receivers,
                 enqueues jobs to Cloudflare Queues
  apps/worker — Fly.io Machines (Docker: Node + ffmpeg): storage polling,
                 transcription, highlight scoring, rendition rendering,
                 platform publishing, OAuth token refresh
  packages/db — Drizzle ORM schema/migrations (Neon Postgres) — app-specific
                 (Tenant/Clip/Post/etc.), not reusable outside this product
```

Consumes `scenestealer-connectors` and `scenestealer-pipeline` as dependencies
(pnpm workspace/git-ref initially; formal npm publishing is worth doing once
there's external demand to consume them independently, not before). Includes
the **direct-upload** ingestion path in `apps/web` — a drag-and-drop uploader
that streams straight to R2 and creates a `SourceVideo` row with no
`StorageConnection` at all, for tenants who don't want to connect a cloud
account. This is also the fastest path to a working demo since it skips OAuth
entirely.

**`scenestealer-infra`** (private) — Terraform/OpenTofu for Cloudflare
(Workers/Pages/R2/Queues), Fly.io app config, Neon project provisioning, DNS,
and CI/CD workflow definitions. Kept private even though the rest is open
source: it encodes account-specific operational topology (account IDs,
project slugs, deploy targets) that isn't meaningful to external contributors
— standard practice for open-source products with a hosted offering.

**License for `scenestealer-app`: Business Source License 1.1 (decided).**
Evaluated against MIT/Apache-2.0 (no commercial protection), AGPL-3.0 (doesn't
actually stop a competitor hosting unmodified code), and Elastic License v2
(never auto-converts to open source) — BSL is the only option that gives real
runway against copycat hosted competitors _and_ contractually guarantees
arrival at a fully OSI-approved license later, rather than staying permanently
source-available.

Checked compatibility against every other piece of the stack before settling
on this — no conflicts found. Postiz (AGPL-3.0) and ffmpeg (GPL if built with
libx264) are both consumed as external processes/services (subprocess exec,
network API), never linked or vendored into `scenestealer-app`'s own source —
the standard boundary that keeps their copyleft from propagating, confirmed
against the FSF's own guidance on separate programs. The SamurAIGPT reference
pipeline we're adapting code from is MIT, so no restriction flows from it
either. rclone, PySceneDetect, and wavesurfer.js are all permissive (MIT/BSD).

BSL parameters to set in the `LICENSE` file:

- **Change Date**: 4 years from each version's release
- **Additional Use Grant**: permits everything except offering SceneStealer
  (or a substantially similar product) as a hosted/managed service to third
  parties — self-hosting, internal use, and non-competing use stay free
- **Change License**: Apache-2.0 (OSI-approved)

**Why Workers + Fly.io split inside `scenestealer-app`:** Cloudflare Workers
can't run ffmpeg (no long-running CPU work), so the heavy video pipeline needs
a separate compute target. Everything else (auth-gated dashboard, API,
webhooks) fits Workers cheaply.

## Open-source building blocks (adopted, not reinvented)

Checked what already exists before designing custom integrations for each
feature. Four adoptions materially shrink the build:

- **[rclone](https://github.com/rclone/rclone)** (MIT) — "rsync for cloud
  storage," natively supports 70+ backends including every provider in this
  plan: Google Drive, Dropbox, OneDrive, Box, S3, Azure Blob, and GCS. It
  exposes a remote-control (RC) HTTP API, so the worker can drive it
  programmatically instead of us hand-writing OAuth + pagination + resumable-
  download logic per provider. **Replaces most of `scenestealer-connectors`'s
  storage layer.** We still register our own OAuth app per OAuth-consent
  provider (Drive/Dropbox/OneDrive/Box) and generate a per-tenant rclone
  remote config — rclone removes the SDK/protocol work, not the OAuth
  app-registration step.
- **[Postiz](https://github.com/gitroomhq/postiz-app)** (AGPL-3.0,
  self-hosted, 32k+ stars) — an open-source, self-hostable social scheduler
  already covering OAuth + publish flows for YouTube, Instagram, Facebook, and
  30+ other platforms at full parity with its hosted version. **Replaces
  hand-rolling the Meta Graph API container-publish flow and YouTube
  resumable-upload code.** Because it's AGPL-3.0, it's deployed as its own
  self-hosted service in `scenestealer-infra` and called over its network API
  — not vendored or linked into `scenestealer-app`'s source — which keeps our
  own code's license unaffected. Postiz doesn't remove the Meta App Review
  requirement (that's Meta's gate, not a code problem); it removes the
  engineering work of implementing the publish mechanics ourselves.
- **[PySceneDetect](https://github.com/Breakthrough/PySceneDetect)** (BSD) —
  used in `scenestealer-pipeline` to detect real scene/cut boundaries in the
  source video, so AI-suggested clip in/out points snap to actual cuts
  instead of arbitrary timestamps mid-scene.
- **[SamurAIGPT/AI-Youtube-Shorts-Generator](https://github.com/SamurAIGPT/AI-Youtube-Shorts-Generator)**
  (open source) — a working reference pipeline doing exactly the
  transcribe → LLM-highlight-detect → face-tracked vertical reframe sequence
  this product needs. Used as an adaptation reference for
  `scenestealer-pipeline`'s highlight-scoring and auto-reframe logic rather
  than designing that sequence from a blank page — meaningfully de-risks the
  "build, don't buy" call made below.
- **[wavesurfer.js](https://github.com/katspaugh/wavesurfer.js)** (BSD) — the
  waveform-rendering and region-selection library behind the manual
  scrubbing/trim editor in `apps/web`, instead of building waveform
  visualization and drag-to-select from scratch.

**Verify before committing:** confirm Postiz's current Meta container-flow
implementation actually satisfies the Reels-tab spec below (aspect
ratio/duration/codec), and re-read its AGPL-3.0 terms against the
service-boundary approach above, before wiring it in during Phase 6.

## Infra choices (cost-driven, not carried over from any other project)

| Concern           | Choice                                                | Why                                                                                                                                                                                                                                                                                             |
| ----------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dashboard + API   | Cloudflare Pages/Workers                              | Generous free tier, cheap at scale                                                                                                                                                                                                                                                              |
| Media storage     | Cloudflare R2                                         | **Zero egress fees** — matters a lot here, since publishing means repeatedly serving full video files out to Meta's and YouTube's fetchers                                                                                                                                                      |
| Video worker      | Fly.io Machines                                       | Pay-per-second, scales to zero between jobs — this workload is bursty (a show gets processed, then idles), so idle time costs nothing. Revisit self-managed Hetzner boxes (~$0.04/hr GPU, cheap dedicated CPU) once volume is high enough and steady enough that always-on beats pay-per-second |
| Relational DB     | Neon Postgres                                         | Serverless, scales to zero, cheap at low volume, real relational model for tenants/connections/clips/posts                                                                                                                                                                                      |
| Job handoff       | Cloudflare Queues                                     | Native to Workers, cheap; consumer triggers a Fly Machine per job                                                                                                                                                                                                                               |
| Auth              | Clerk (Organizations = tenants)                       | Generous free tier; ready-made signup/invite UI matters for a non-technical audience — building that from scratch is the more expensive option once engineering time counts                                                                                                                     |
| Billing           | Stripe                                                | Standard, no real alternative. Integration shape decided 2026-07-19 (Checkout + Managed Payments, flat-rate/one-Product-per-tier, card-on-file trial, Customer Portal, Smart Retries) — see `scenestealer-infra`'s ROADMAP.md Phase 2b. Actual tier pricing still deferred pending cost analysis. |
| Storage access    | rclone (self-hosted, called from the worker)          | Open source, already covers all 7 storage backends — see "Open-source building blocks" below                                                                                                                                                                                                    |
| Social publishing | Postiz (self-hosted, its own small always-on service) | Open source, already covers YouTube/IG/FB OAuth + publish mechanics — lightweight and steady-state, so it doesn't fit the bursty Fly Machines pattern; a small always-on container (Fly or the cheapest Hetzner box) suits it better                                                            |

## AI highlight detection: build, don't buy

Priced this out rather than assuming:

- Transcription: Groq Whisper Turbo ≈ $0.04/hr (~$0.0007/min), or OpenAI
  `gpt-4o-mini-transcribe` ≈ $0.003/min. A 2-hour show costs pennies to
  transcribe.
- Highlight scoring: feed the transcript + a cheap audio-energy/applause &
  laughter signal (plain DSP, no vendor, runs on the same worker) to an LLM
  (Claude Haiku) to score candidate moments — a few cents per show.
- Estimated total marginal AI cost per show: **well under $1**.
- Compare to buying: Klap's public pricing is consumer/creator tiers
  ($29–189/mo with hard caps on uploads and clips per month); no confirmed
  low per-minute reseller/API rate surfaced in research. Hard caps don't map
  cleanly onto a white-label multi-tenant reseller model — you'd either hit
  caps or need one Klap account per tenant.
- You need an ffmpeg rendering worker regardless (platform-spec
  encoding/branding), so highlight detection is incremental cost on infra
  you're already running either way.
- Bonus: building it lets the applause/laughter "audience reaction" signal
  become a differentiator specifically suited to live recordings — generic
  clipping tools don't specialize in this.
- "Build" here means adapt, not design from scratch: SamurAIGPT's
  open-source Shorts-generator pipeline and PySceneDetect (both above) cover
  the transcribe/score/reframe/cut-boundary mechanics already, which further
  lowers the effort side of this comparison.

**Open assumption to sanity-check before fully committing:** Klap/Reap's exact
API-tier reseller pricing wasn't fully visible in research (their docs didn't
expose per-minute API rates). Worth a 30-minute check against their docs/sales
before Phase 3, but the cost math already strongly favors build.

## Video pipeline

1. **Ingest** — either the worker drives rclone (via its RC API) against the
   tenant's connected storage remote to list/download new files into R2, or
   the tenant uploads a file directly through the dashboard straight into
   R2. Either path ends in the same place: a new `SourceVideo` row.
2. **Analyze** — transcribe (Groq) → PySceneDetect scene-boundary pass →
   audio-energy/applause scan → LLM scores candidate highlight windows,
   snapped to real cut points → stored as suggested `Clip` rows.
3. **Review** — tenant opens the dashboard, sees AI suggestions on a
   scrubbable timeline (wavesurfer.js waveform + region selection),
   accepts/adjusts in/out points, or draws a fully manual clip.
4. **Template** — tenant picks/edits a caption template with variables
   (`{{show_title}}`, `{{venue}}`, `{{date}}`), per platform.
5. **Render** — worker produces platform-specific files (ffmpeg crop/encode,
   face-tracked vertical reframe, optional caption burn-in) into R2.
6. **Schedule** — `Post` row created, immediate or scheduled.
7. **Publish** — worker hands the rendered file + metadata to the self-hosted
   Postiz instance, which performs the actual YouTube upload / Meta container
   publish; worker records the external post IDs/status Postiz returns and
   retries on failure.

## Core data model

`Tenant`, `Membership(user, tenant, role)`, `StorageConnection`,
`SocialConnection`, `SourceVideo`, `Clip`, `Template`, `Post`, `Job`,
`Subscription`. `SourceVideo.storageConnectionId` is nullable — direct uploads
have no `StorageConnection` at all.

## Platform constraints (confirmed via research, not assumed)

- **Instagram**: Reels-tab eligibility needs 9:16, 5–90s, MP4 H.264 (HEVC also
  OK), closed GOP, 4:2:0 chroma, 23–60fps. Publish = 2-step Graph API call
  (`POST /{ig-user-id}/media` → `POST /{ig-user-id}/media_publish}`). Requires
  a Meta Business account + linked FB Page + IG Professional account + a Meta
  developer app with **approved `instagram_business_content_publish`
  permission** — App Review, 2–4 weeks per submission, needs a demo screencast.
- **YouTube**: `videos.insert` now costs ~100 quota units (down from 1600) and,
  as of a June 2026 change, draws from its own ~100-calls/day bucket separate
  from the shared 10k pool — default free tier supports ~100 full uploads/day
  with no extension request needed. Apply for Google's Audit & Quota Extension
  form only once tenant volume approaches that ceiling.

**Sequencing implication:** Meta App Review is the single longest lead-time,
hardest-gated dependency in this whole project — start that submission early
and in parallel with build, not after. YouTube has no equivalent gate.

## Build sequence

1. Name confirmation + license decision (see open question above), then
   create all four repos; `scenestealer-app` wires Clerk, Stripe, Neon, R2,
   and an empty dashboard shell, with `scenestealer-connectors` and
   `scenestealer-pipeline` scaffolded but empty.
2. Ingestion — stand up rclone (with our own OAuth app registered for Google
   Drive first), build the thin `StorageProvider` wrapper around its RC API
   in `scenestealer-connectors`, plus direct upload (dashboard → R2, no
   rclone needed) in `scenestealer-app`, since together those two prove the
   pipe end-to-end fastest. Then add Dropbox, OneDrive/SharePoint, and Box
   remotes (OAuth-consent group), then S3, Azure Blob, and GCS remotes
   (credential-based group, aimed at larger/technical customers) — all just
   rclone config plus our per-tenant wrapper, before any publishing exists.
3. Deploy self-hosted Postiz, verify a manual YouTube full-video publish
   through it — lowest integration friction, no App Review gate, delivers
   real value early and de-risks the Postiz integration before Meta is in
   the picture.
4. AI auto-clip pipeline (transcribe → PySceneDetect → score → suggest,
   adapting the SamurAIGPT reference pipeline) + manual scrubbing editor UI
   (wavesurfer.js).
5. Templating engine + platform-spec rendering worker.
6. **Submit Meta App Review** (should actually kick off in parallel with step
   2, not wait until here) + wire IG/FB publish through Postiz once approved.
7. Scheduling, usage-based billing tiers, onboarding polish for a
   non-technical audience.

## Verification (this is a 0-to-1 plan, so "verification" = de-risking before build starts)

- ~~Confirm the chosen name is available as a domain~~ — done: `scenestealer.app`
  purchased via Namecheap (2026-07-19). DNS zone config lives in
  `scenestealer-infra`'s `opentofu/cloudflare-dns.tf`; nameserver delegation
  at Namecheap is still a manual, unapplied step — see that repo's README.md
  Known Gaps. Trademark conflict was not separately checked — worth a quick
  search before any public launch/marketing push, not blocking build.
- Quick direct check of Klap/Reap reseller API pricing as a sanity check on
  the build-vs-buy call (see open assumption above).
- Confirm Postiz's current Meta publish flow meets the Reels-tab spec and
  re-read its AGPL-3.0 terms against the self-hosted-service boundary
  described above, before Phase 6.
- After Phase 1 scaffolding exists, first real proof point: a test tenant
  signs up via Clerk, connects a storage folder (Google Drive first, as the
  first rclone remote wired up) via OAuth, drops a test video in it, and
  that video shows up in the dashboard as a `SourceVideo` row — confirms the
  ingestion pipe works end-to-end before any AI or publishing code is
  written. Repeat the same check for each additional storage remote as it's
  added.

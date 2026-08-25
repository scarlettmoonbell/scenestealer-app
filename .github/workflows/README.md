# GitHub Actions Workflows

What each workflow in this directory does, when it runs, and why.

## checks.yml

**Triggers:** `pull_request` (no path filter — every PR, since this is a
monorepo and most changes touch more than one package).

- **checks** — `pnpm install --frozen-lockfile` (across the whole
  workspace, resolving the two sibling git dependencies —
  `@scenestealer/connectors` and `@scenestealer/pipeline` — via their own
  `prepare` build hooks), then `pnpm typecheck` / `pnpm lint` / `pnpm
  format` / `pnpm build`, each via `turbo run <task>` so only affected
  packages actually re-run.
- **security-scan** — Trivy filesystem scan (`CRITICAL,HIGH`, fails the
  job on a hit; documented exceptions live in `.trivyignore`).
- **secret-scan** — gitleaks over the full PR history.

All third-party actions are SHA-pinned (with a `# vX.Y.Z` comment noting
the tag it corresponds to), matching the sibling repos' convention.

## deploy.yml

**Triggers:** `push` to `main`.

Deploys all three runtime targets in parallel, each in its own job behind
a shared **verify** job (the same typecheck/lint/build `checks.yml` runs
on a PR — a direct push to `main` skips PR review, so this re-checks
rather than trusting it already happened):

- **deploy-web** — `pnpm --filter @scenestealer/web run pages:build`
  (the `@cloudflare/next-on-pages` conversion, not part of turbo's
  `build` task), then `wrangler pages deploy` via
  `cloudflare/wrangler-action`.
- **deploy-api** — `wrangler deploy` via `cloudflare/wrangler-action`.
- **deploy-worker** — builds `apps/worker/dist` and `packages/db/dist`
  (the Dockerfile only `COPY`s them in, it doesn't run `tsc` itself),
  then `flyctl deploy` via `superfly/flyctl-actions/setup-flyctl`.

`deploy-web` and `deploy-api` both build `packages/db` first — a
workspace package whose `package.json` "main" points at its `dist/`
output, which neither Next.js's build nor wrangler's bundler produces on
their own.

Needs `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` / `FLY_API_TOKEN`
repo secrets (already configured — see `scenestealer-infra`).

**Known gap this closes**: for a while, nothing deployed `apps/web` at
all — it had been pushed live manually once, early on, and every change
since then just... didn't go out, silently, until someone actually
looked at the live site. See `ROADMAP.md`'s Accepted Gaps section for
the incident that surfaced it.

## actionlint.yml

**Triggers:** `push`/`pull_request` on changes under
`.github/workflows/**`. Static-checks the workflow YAML itself (typo'd
`secrets.`/`steps.` references, wrong `permissions:` scopes, shellcheck
over `run:` blocks) via `reviewdog/action-actionlint`.

## docs.yml

**Triggers:** `pull_request` on `**/*.md` changes — deliberately not
path-filtered the same way `checks.yml` is, so a docs-only PR
(`README.md`/`ROADMAP.md`/`PLAN.md`) still has something to wait on.
Runs `markdownlint-cli2` over every Markdown file.

## dependabot.yml

Weekly version-update PRs for the `npm` ecosystem (root, covering the whole
pnpm workspace) and the `github-actions` ecosystem (root). Dependabot
**security alerts** should also be enabled at the repo-settings level
(Settings → Security).

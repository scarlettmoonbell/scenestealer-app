# GitHub Actions Workflows

What each workflow in this directory does, when it runs, and why.

## checks.yml

**Triggers:** `pull_request` (no path filter — every PR, since this is a
monorepo and most changes touch more than one package).

- **checks** — `pnpm install --frozen-lockfile` (across the whole
  workspace, resolving the two sibling git dependencies —
  `@scenestealer/connectors` and `@scenestealer/pipeline` — via their own
  `prepare` build hooks), then `pnpm typecheck` / `pnpm lint` / `pnpm
format` / `pnpm build`, each via `turbo run <task>` so only
  affected packages actually re-run.

**Not yet added, tracked as a known gap** (see `ROADMAP.md`): SHA-pinning,
Trivy, gitleaks — same reasoning as the sibling repos' workflows/README.md.
Also not yet added: an actual **deploy** workflow (`apps/web` → Cloudflare
Pages, `apps/api` → `wrangler deploy`, `apps/worker`'s image → Fly.io) —
there's nothing to deploy to yet, since `scenestealer-infra` hasn't
provisioned those targets. This is the next thing to add once it does.

## dependabot.yml

Weekly version-update PRs for the `npm` ecosystem (root, covering the whole
pnpm workspace) and the `github-actions` ecosystem (root). Dependabot
**security alerts** should also be enabled at the repo-settings level
(Settings → Security).

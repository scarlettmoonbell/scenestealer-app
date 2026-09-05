# Fly.io Machine image — Node worker + the CLI tools scenestealer-pipeline
# shells out to as subprocesses (ffmpeg, scenedetect). See that package's
# README.md for why these are subprocess dependencies, not linked libraries.
#
# Build context is the *repo root*, not this directory — this image needs
# packages/db (a workspace:* dependency plain npm can't resolve) alongside
# apps/worker itself. Deploy with:
#   flyctl deploy --config apps/worker/fly.toml --dockerfile apps/worker/Dockerfile
# run from the repo root. Both apps/worker/dist and packages/db/dist must
# already exist locally (pnpm --filter <pkg> build) before this runs —
# nothing here builds TypeScript, matching this image's existing pattern.
FROM node:22.12-bookworm-slim AS base

# ffmpeg built with openh264 (not libx264) — sidesteps the GPL question
# entirely rather than relying on the subprocess-boundary argument alone.
# See ../../PLAN.md's license-compatibility section.
# unzip: rclone's own install.sh needs it to extract its release archive
# — confirmed the hard way, the script fails outright without it
# ("None of the supported tools for extracting zip archives... were
# found") and node:*-bookworm-slim doesn't include it by default.
# git: npm needs it to resolve @scenestealer/connectors' and
# @scenestealer/pipeline's github:owner/repo#ref specifiers — also
# confirmed the hard way (npm error enoent, spawn git ENOENT), also
# missing from this base image by default.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    python3 \
    python3-pip \
    curl \
    unzip \
    git \
    ca-certificates \
    && pip3 install --no-cache-dir --break-system-packages scenedetect[opencv] \
    && curl https://rclone.org/install.sh | bash \
    && rm -rf /var/lib/apt/lists/*

# npm resolves @scenestealer/connectors' and @scenestealer/pipeline's
# github:owner/repo#ref specifiers to a full ssh://git@github.com/...
# URL here, and this image has no SSH key (or ssh binary at all) to
# authenticate with — confirmed the hard way, `npm install` failing
# with "ssh: not found" in Fly's remote builder. Both repos are public,
# so rewriting to anonymous HTTPS is enough; no credentials needed.
# Two rules, not one: git's url.insteadOf matches on exact string
# prefix, and this ssh:// form is a different string from the
# git@github.com: SCP-like form the CI workflow's own equivalent
# rewrite (.github/workflows/deploy.yml) already handles for the
# separate, unrelated `pnpm install` step that runs on the Actions
# runner itself, outside this Docker build entirely. ca-certificates
# is explicit (not just pulled in transitively via curl) since git's
# own HTTPS backend fails closed with "server certificate verification
# failed. CAfile: none" without it — confirmed the hard way in an
# isolated repro that installed only git.
#
# scenestealer-connectors also carries its own git submodule (the
# shared .conventions repo, same pattern as scenestealer-infra), on a
# bare SSH URL that this same insteadOf rewrite does NOT reach — git
# doesn't apply url.insteadOf to .gitmodules-sourced submodule URLs the
# way it does for a plain clone/fetch target, confirmed by watching the
# rewrite work for the top-level clone but not the nested submodule
# fetch. That submodule is AI-agent conventions docs, irrelevant to the
# actual runtime package code, so telling git to activate no
# submodules at all sidesteps the problem entirely rather than fighting
# the rewrite further.
RUN git config --global url."https://github.com/".insteadOf "git@github.com:" \
    && git config --global url."https://github.com/".insteadOf "ssh://git@github.com/" \
    && git config --global submodule.active ":(exclude)*"

WORKDIR /app

# @scenestealer/db is workspace:* — not something plain `npm install`
# understands (it's a pnpm-only protocol) — stripped here and placed
# directly instead, since it's a local, already-built package with
# nothing to actually "install". The two remaining git-ref dependencies
# (@scenestealer/connectors, @scenestealer/pipeline) resolve fine via
# plain npm — a real `github:owner/repo#ref` git dependency, unlike the
# workspace protocol.
COPY apps/worker/package.json ./
RUN npm pkg delete dependencies.@scenestealer/db && npm install --omit=dev
COPY packages/db/package.json packages/db/dist ./node_modules/@scenestealer/db/

COPY apps/worker/dist ./dist

# server.ts's always-on HTTP mode — the deployed target for this app's
# Fly deployment (fly.toml), scaled to zero via Fly's own auto-stop/
# auto-start rather than the per-job dynamic Machine-spawn model
# PLAN.md eventually calls for (not built yet — see fly.toml's comment).
# index.ts's one-shot CLI mode (dist/index.js) is what that future model
# will actually invoke, and stays available for local testing today.
CMD ["node", "dist/server.js"]

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
    && pip3 install --no-cache-dir --break-system-packages scenedetect[opencv] \
    && curl https://rclone.org/install.sh | bash \
    && rm -rf /var/lib/apt/lists/*

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

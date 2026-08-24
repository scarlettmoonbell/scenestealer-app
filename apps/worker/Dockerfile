# Fly.io Machine image — Node worker + the CLI tools scenestealer-pipeline
# shells out to as subprocesses (ffmpeg, scenedetect). See that package's
# README.md for why these are subprocess dependencies, not linked libraries.
FROM node:22.12-bookworm-slim AS base

# ffmpeg built with openh264 (not libx264) — sidesteps the GPL question
# entirely rather than relying on the subprocess-boundary argument alone.
# See ../../PLAN.md's license-compatibility section.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    python3 \
    python3-pip \
    curl \
    && pip3 install --no-cache-dir --break-system-packages scenedetect[opencv] \
    && curl https://rclone.org/install.sh | bash \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev

COPY dist ./dist

# server.ts's always-on HTTP mode — the deployed target for this app's
# Fly deployment (fly.toml), scaled to zero via Fly's own auto-stop/
# auto-start rather than the per-job dynamic Machine-spawn model
# PLAN.md eventually calls for (not built yet — see fly.toml's comment).
# index.ts's one-shot CLI mode (dist/index.js) is what that future model
# will actually invoke, and stays available for local testing today.
CMD ["node", "dist/server.js"]

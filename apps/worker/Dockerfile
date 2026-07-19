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

# Started by Fly Machines on demand, per job — see ../../README.md's
# Infra choices table for why this runs pay-per-second rather than always-on.
CMD ["node", "dist/index.js"]

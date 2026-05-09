# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim AS base
WORKDIR /worker

FROM base AS deps
COPY lib/package.json lib/package-lock.json* ./lib/
RUN cd lib && npm ci

FROM base AS build
COPY --from=deps /worker/lib/node_modules ./lib/node_modules
COPY lib ./lib
RUN cd lib && npm run build

FROM base AS runtime
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates curl jq \
 && rm -rf /var/lib/apt/lists/*

# Phase 1 installs sandcastle CLI, claude-code, and the superpowers plugin here.
COPY --from=build /worker/lib/dist ./lib/dist
COPY --from=build /worker/lib/node_modules ./lib/node_modules
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

WORKDIR /workspace
ENTRYPOINT ["/entrypoint.sh"]

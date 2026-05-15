# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim AS base
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates curl jq gh \
 && rm -rf /var/lib/apt/lists/*

FROM base AS lib-build
WORKDIR /worker/lib
COPY lib/package.json lib/package-lock.json* ./
RUN npm ci
COPY lib/ ./
RUN npm run build

FROM base AS runtime
WORKDIR /opt/worker
COPY --from=lib-build /worker/lib/dist ./lib/dist
COPY --from=lib-build /worker/lib/node_modules ./lib/node_modules
COPY --from=lib-build /worker/lib/package.json ./lib/package.json

# Bake the gitmoji-commits skill into a known path the prompt references.
COPY lib/src/skills/gitmoji-commits/SKILL.md /opt/arandano/skills/gitmoji-commits/SKILL.md

# Vendor the commitlint rule pack so `npx commitlint` resolves it without npm install.
COPY lib/src/commitlint-rules /opt/arandano/commitlint-rules

# Claude Code CLI
RUN npm install -g @anthropic-ai/claude-code

# non-root user (node:22 already has 'node' at UID 1000 — use 1001)
RUN useradd -m -u 1001 worker

# superpowers plugin (baked in)
RUN mkdir -p /home/worker/.claude/plugins \
 && git clone --depth=1 https://github.com/obra/superpowers.git /home/worker/.claude/plugins/superpowers \
 && chown -R worker:worker /home/worker
USER worker

COPY --chown=worker:worker entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

WORKDIR /workspace
ENTRYPOINT ["/entrypoint.sh"]

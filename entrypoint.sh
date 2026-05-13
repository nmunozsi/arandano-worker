#!/usr/bin/env sh
set -eu

: "${ARANDANO_TASK_ID:?ARANDANO_TASK_ID required}"

# Configure git to use GH_TOKEN for HTTPS pushes
if [ -n "${GH_TOKEN:-}" ]; then
  gh auth setup-git
fi

exec node /opt/worker/lib/dist/start.js

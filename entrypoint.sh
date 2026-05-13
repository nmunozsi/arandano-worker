#!/usr/bin/env sh
set -eu

: "${ARANDANO_TASK_ID:?ARANDANO_TASK_ID required}"

# Configure git to use GH_TOKEN for HTTPS pushes, rewrite SSH remotes to HTTPS
if [ -n "${GH_TOKEN:-}" ]; then
  gh auth setup-git
  git config --global url."https://github.com/".insteadOf "git@github.com:"
fi

exec node /opt/worker/lib/dist/start.js

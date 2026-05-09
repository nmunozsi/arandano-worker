#!/usr/bin/env sh
set -eu

echo "arandano-worker: placeholder entrypoint (Phase 0)"
echo "  ARANDANO_TASK_ID=${ARANDANO_TASK_ID:-<unset>}"
echo "  workdir=$(pwd)"

# Phase 1 will replace this with the real task driver.
exit 0

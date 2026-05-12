#!/usr/bin/env sh
set -eu

: "${ARANDANO_TASK_ID:?ARANDANO_TASK_ID required}"
exec node /opt/worker/lib/dist/start.js

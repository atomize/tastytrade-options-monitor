#!/usr/bin/env bash
set -euo pipefail

export SERVE_DASHBOARD="${SERVE_DASHBOARD:-true}"
export WS_PORT="${WS_PORT:-3001}"

echo "[monitor] Starting tastytrade options monitor"
echo "[monitor] SERVE_DASHBOARD=${SERVE_DASHBOARD}"
echo "[monitor] WS_PORT=${WS_PORT}"
echo "[monitor] TASTYTRADE_ENV=${TASTYTRADE_ENV:-sandbox}"

exec node /app/packages/monitor/dist/main.js "$@"

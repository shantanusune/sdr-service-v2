#!/usr/bin/env bash
set -euo pipefail

WORKSPACE_DIR="${WORKSPACE_DIR:-/workspace/sdr-services-v2}"
UI_DIR="${WORKSPACE_DIR}/ui"

for _ in $(seq 1 60); do
  if [[ -d "${UI_DIR}" ]]; then
    break
  fi
  sleep 1
done

if [[ ! -d "${UI_DIR}" ]]; then
  echo "ui directory not found at ${UI_DIR}" >&2
  exit 1
fi

cd "${UI_DIR}"

export VITE_API_BASE_URL="${VITE_API_BASE_URL:-http://localhost:8090}"
export VITE_WS_BASE_URL="${VITE_WS_BASE_URL:-ws://localhost:8090}"
export VITE_MOCK_AUTH="${VITE_MOCK_AUTH:-true}"
export VITE_MOCK_API="${VITE_MOCK_API:-false}"

if [[ "${UI_NPM_INSTALL:-auto}" == "always" ]] || [[ ! -x node_modules/.bin/vite ]]; then
  npm install --no-audit --no-fund
fi

UI_MODE="${UI_MODE:-dev}"
UI_PORT="${UI_PORT:-5173}"

if [[ "${UI_MODE}" == "build" ]]; then
  npm run build
  exec npm run preview -- --host 0.0.0.0 --port "${UI_PORT}"
fi

exec npm run dev -- --host 0.0.0.0 --port "${UI_PORT}"
